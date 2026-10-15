import { runMediaCommand } from "./media-process";
import { PROBE_TIMEOUT_MS } from "./media-config";

export async function probeVideo(path: string, signal?: AbortSignal) {
	const { stdout } = await runMediaCommand(
		[
			"ffprobe",
			"-v",
			"error",
			"-protocol_whitelist",
			"file,pipe",
			"-show_entries",
			"stream=codec_type,height:format=duration",
			"-of",
			"json",
			path,
		],
		{ timeoutMs: PROBE_TIMEOUT_MS, signal },
	);
	return parseProbe(stdout);
}

export function parseProbe(output: string) {
	const data = JSON.parse(output) as {
		streams?: { codec_type?: string; height?: number }[];
		format?: { duration?: string };
	};
	const video = data.streams?.find((stream) => stream.codec_type === "video");
	const height = video?.height;
	const duration = Number(data.format?.duration);
	if (
		!Number.isInteger(height) ||
		!height ||
		height <= 0 ||
		!Number.isFinite(duration) ||
		duration <= 0 ||
		duration > 2_147_483_647
	) {
		throw new Error(
			"File must contain a video stream with valid dimensions and duration",
		);
	}
	return {
		height,
		durationSeconds: Math.max(1, Math.round(duration)),
		hasAudio: data.streams!.some((stream) => stream.codec_type === "audio"),
	};
}
