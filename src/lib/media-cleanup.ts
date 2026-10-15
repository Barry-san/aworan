import { readdir, lstat, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { ffmpegJobs, videos } from "@/db/schema";

const UPLOAD_DIRECTORY = /^upload-[A-Za-z0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(["pending", "probing", "transcoding"]);
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

async function entries(path: string) {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export function createMediaCleanup(db: Database, root = process.cwd()) {
	const uploadRoot = resolve(root, "uploads");
	const videoRoot = resolve(root, "videos");
	return {
		async source(path: string) {
			const resolved = resolve(path);
			const local = relative(uploadRoot, resolved);
			const managed =
				UPLOAD_DIRECTORY.test(dirname(local)) && basename(local) === "source";
			const legacy =
				local.length > 0 &&
				dirname(local) === "." &&
				local !== "." &&
				local !== "..";
			if (!managed && !legacy) return; // Never remove paths outside this media root.
			const references = await db
				.select({ status: ffmpegJobs.status })
				.from(ffmpegJobs)
				.where(eq(ffmpegJobs.source_path, path));
			if (references.some((job) => ACTIVE.has(job.status))) return;
			await rm(managed ? dirname(resolved) : resolved, {
				recursive: managed,
				force: true,
			});
		},

		async deletedVideo(id: string, sources: string[]) {
			// Called only after the row deletion commits, so workers cannot publish.
			if (!UUID.test(id)) throw new Error("Invalid video directory");
			if (
				(
					await db
						.select({ id: videos.video_id })
						.from(videos)
						.where(eq(videos.video_id, id))
				).length
			)
				return;
			await rm(join(videoRoot, id), { recursive: true, force: true });
			for (const source of new Set(sources)) await this.source(source);
		},

		async sweep(now = Date.now()) {
			const [jobs, videoRows] = await Promise.all([
				db.select().from(ffmpegJobs),
				db.select().from(videos),
			]);
			// Finished and failed sources can be removed immediately, unless a legacy
			// filename is also referenced by an unfinished job.
			for (const source of new Set(
				jobs
					.filter((job) => !ACTIVE.has(job.status))
					.map((job) => job.source_path),
			)) {
				await this.source(source);
			}
			const activeSources = new Set(
				jobs
					.filter((job) => ACTIVE.has(job.status))
					.map((job) => resolve(job.source_path)),
			);
			const old = async (path: string) => {
				try {
					return now - (await lstat(path)).mtimeMs >= ORPHAN_GRACE_MS;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
					throw error;
				}
			};
			for (const entry of await entries(uploadRoot)) {
				if (entry.isSymbolicLink()) continue;
				const path = join(uploadRoot, entry.name);
				const source =
					entry.isDirectory() && UPLOAD_DIRECTORY.test(entry.name)
						? join(path, "source")
						: path;
				if (
					!entry.isFile() &&
					!(entry.isDirectory() && UPLOAD_DIRECTORY.test(entry.name))
				)
					continue;
				if (!activeSources.has(source) && (await old(path)))
					await this.source(source);
			}
			const byId = new Map(videoRows.map((video) => [video.video_id, video]));
			for (const entry of await entries(videoRoot)) {
				if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
				const directory = join(videoRoot, entry.name);
				const video = byId.get(entry.name);
				if (!video) {
					if (await old(directory)) await this.deletedVideo(entry.name, []);
					continue;
				}
				if (
					video.status === "failed" &&
					!video.stream_url &&
					!jobs.some(
						(job) => job.video_id === video.video_id && ACTIVE.has(job.status),
					)
				) {
					// Also remove partial output from the pre-lease directory layout.
					await rm(directory, { recursive: true, force: true });
					continue;
				}
				for (const attempt of await entries(directory)) {
					if (!attempt.isDirectory() || !UUID.test(attempt.name)) continue;
					const path = join(directory, attempt.name);
					const published =
						video.stream_url ===
						`/videos/${video.video_id}/${attempt.name}/master.m3u8`;
					const active = jobs.some(
						(job) =>
							job.video_id === video.video_id &&
							job.lease_token === attempt.name &&
							ACTIVE.has(job.status),
					);
					if (!published && !active && (await old(path)))
						await rm(path, { recursive: true, force: true });
				}
			}
		},
	};
}
