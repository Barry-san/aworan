import { rm, stat } from "node:fs/promises";
import { runMediaCommand, MediaTimeoutError } from "@/lib/media-process";
import { THUMBNAIL_TIMEOUT_MS } from "@/lib/media-config";

// A single deadline covers both extraction attempts. A short clip may contain
// no frames after one second, even when FFmpeg exits successfully.
export async function generateThumbnail(
	inputPath: string,
	outputPath: string,
	signal?: AbortSignal,
	timeoutMs = THUMBNAIL_TIMEOUT_MS,
) {
	const deadline = performance.now() + timeoutMs;
	try {
		for (const seconds of [1, 0]) {
			signal?.throwIfAborted();
			await rm(outputPath, { force: true });
			try {
				const remaining = Math.ceil(deadline - performance.now());
				if (remaining <= 0) throw new MediaTimeoutError();
				await runMediaCommand(
					[
						"ffmpeg",
						"-nostdin",
						"-v",
						"error",
						"-y",
						"-protocol_whitelist",
						"file,pipe",
						"-ss",
						String(seconds),
						"-i",
						inputPath,
						"-map",
						"0:v:0",
						"-frames:v",
						"1",
						"-an",
						"-vf",
						"scale=w='min(640,iw)':h=-2,setsar=1",
						"-q:v",
						"3",
						"-f",
						"image2",
						"-update",
						"1",
						outputPath,
					],
					{ timeoutMs: remaining, signal },
				);
				if (!(await stat(outputPath)).size)
					throw new Error("Thumbnail output is empty");
				return;
			} catch (error) {
				signal?.throwIfAborted();
				if (error instanceof MediaTimeoutError || seconds === 0) throw error;
			}
		}
	} catch (error) {
		await rm(outputPath, { force: true });
		throw error;
	}
}
