import { runMediaCommand } from "@/lib/media-process";
import { TRANSCODE_TIMEOUT_MS } from "@/lib/media-config";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { generateThumbnail } from "./thumbnail";
import { buildFiltersAndArgs, detectHasAudio } from "./utils";
import { type createQueue, LEASE_SECONDS, type ClaimedJob } from "./queue";

export async function execute(
	job: ClaimedJob,
	queue: ReturnType<typeof createQueue>,
	root = process.cwd(),
	cleanupSource?: (path: string) => Promise<void>,
) {
	const outputDir = resolve(root, "videos", job.video_id, job.lease_token);
	const abort = new AbortController();
	let published = false;
	let publicationUncertain = false;
	let renewing = false;
	let settled = false;
	let watchdog = setTimeout(() => abort.abort(), LEASE_SECONDS * 1000);
	const heartbeat = setInterval(() => {
		if (renewing || abort.signal.aborted) return;
		renewing = true;
		const started = performance.now();
		void queue
			.renew(job)
			.then((owned) => {
				if (settled) return;
				if (!owned) abort.abort();
				else {
					clearTimeout(watchdog);
					// Count request latency against the lease; a hung renewal must not keep
					// FFmpeg alive indefinitely while another worker has reclaimed the job.
					watchdog = setTimeout(
						() => abort.abort(),
						Math.max(0, LEASE_SECONDS * 1000 - (performance.now() - started)),
					);
				}
			})
			.catch((error) => {
				console.error("Lease renewal failed", error);
				abort.abort();
			})
			.finally(() => {
				renewing = false;
			});
	}, 20_000);
	try {
		const heights = Array.isArray(job.ladder)
			? (job.ladder as number[])
			: [360];
		await mkdir(outputDir, { recursive: true });
		for (const height of heights)
			await mkdir(`${outputDir}/${height}p`, { recursive: true });
		const hasAudio = await detectHasAudio(job.source_path, abort.signal);
		abort.signal.throwIfAborted();
		const { argv } = buildFiltersAndArgs({
			inputPath: job.source_path,
			outputDir,
			heights,
			hasAudio,
		});
		await runMediaCommand(argv, {
			timeoutMs: TRANSCODE_TIMEOUT_MS,
			signal: abort.signal,
		});

		let thumbnailUrl: string | null = null;
		try {
			await generateThumbnail(
				job.source_path,
				resolve(outputDir, "thumbnail.jpg"),
				abort.signal,
			);
			thumbnailUrl = `/videos/${job.video_id}/${job.lease_token}/thumbnail.jpg`;
		} catch (error) {
			// Losing ownership must never become a successful publication.
			abort.signal.throwIfAborted();
			console.error(`Thumbnail generation failed for job ${job.job_id}`, error);
		}
		abort.signal.throwIfAborted();

		// A commit may succeed even when its acknowledgement is lost. Preserve output
		// if publication is uncertain, rather than deleting a potentially live stream.
		publicationUncertain = true;
		published = await queue.finish(job, {
			streamUrl: `/videos/${job.video_id}/${job.lease_token}/master.m3u8`,
			heights,
			thumbnailUrl,
		});
		publicationUncertain = false;
		if (published) {
			// New uploads own their directory. Legacy shared sources must be retained.
			await cleanupSource?.(job.source_path).catch((error) =>
				console.error("Source cleanup failed", error),
			);
		}
	} catch (error) {
		console.error(`Job ${job.job_id} failed`, error);
		if (!abort.signal.aborted && !publicationUncertain) {
			const finished = await queue.finish(job, {
				error: String(error).slice(-4000),
			});
			if (finished) await cleanupSource?.(job.source_path);
		}
	} finally {
		settled = true;
		clearInterval(heartbeat);
		clearTimeout(watchdog);
		if (!published && !publicationUncertain)
			await rm(outputDir, { recursive: true, force: true });
	}
}
