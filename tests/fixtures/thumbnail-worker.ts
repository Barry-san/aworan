import { mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimedJob, createQueue } from "../../workers/video/queue";

const root = await mkdtemp(join(tmpdir(), "yt-thumbnail-worker-"));
const videoId = crypto.randomUUID();
let token = crypto.randomUUID();
mock.module("../../src/lib/media-process", () => ({
	runMediaCommand: async () => {
		await Bun.write(
			join(root, "videos", videoId, token, "master.m3u8"),
			"playlist",
		);
	},
}));
mock.module("../../workers/video/utils", () => ({
	detectHasAudio: async () => false,
	buildFiltersAndArgs: () => ({ argv: [] }),
}));
mock.module("../../workers/video/thumbnail", () => ({
	generateThumbnail: async () => {
		throw new Error("thumbnail unavailable");
	},
}));
const { execute } = await import("../../workers/video/execute");
try {
	let thumbnailUrl: string | null | undefined;
	let sourceCleaned = false;
	const job = {
		job_id: 1,
		video_id: videoId,
		lease_token: token,
		source_path: "unused",
		ladder: [360],
	} as ClaimedJob;
	const queue = {
		renew: async () => true,
		finish: async (_job: unknown, result: { thumbnailUrl?: string | null }) => {
			thumbnailUrl = result.thumbnailUrl;
			return true;
		},
	} as unknown as ReturnType<typeof createQueue>;
	await execute(job, queue, root, async () => {
		sourceCleaned = true;
	});
	const publishedOutput = await Bun.file(
		join(root, "videos", videoId, token, "master.m3u8"),
	).exists();
	token = crypto.randomUUID();
	let uncertainFinishCalls = 0;
	let uncertainSourceCleaned = false;
	const uncertainQueue = {
		renew: async () => true,
		finish: async () => {
			uncertainFinishCalls++;
			throw new Error("commit acknowledgement lost");
		},
	} as unknown as ReturnType<typeof createQueue>;
	await execute(
		{ ...job, lease_token: token },
		uncertainQueue,
		root,
		async () => {
			uncertainSourceCleaned = true;
		},
	);
	const uncertainOutput = await Bun.file(
		join(root, "videos", videoId, token, "master.m3u8"),
	).exists();
	console.log(
		JSON.stringify({
			thumbnailUrl,
			sourceCleaned,
			publishedOutput,
			uncertainOutput,
			uncertainSourceCleaned,
			uncertainFinishCalls,
		}),
	);
} finally {
	await rm(root, { recursive: true, force: true });
}
