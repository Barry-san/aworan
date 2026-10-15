import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateThumbnail } from "../workers/video/thumbnail";
import { runMediaCommand, MediaTimeoutError } from "../src/lib/media-process";

for (const sample of [
	{
		name: "landscape with audio",
		size: "1280x720",
		duration: "2",
		audio: true,
		width: 640,
		height: 360,
	},
	{
		name: "portrait without audio",
		size: "360x640",
		duration: "2",
		audio: false,
		width: 360,
		height: 640,
	},
	{
		name: "short clip falls back to first frame without upscaling",
		size: "160x90",
		duration: "0.2",
		audio: false,
		width: 160,
		height: 90,
	},
]) {
	test(`thumbnail: ${sample.name}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "yt-thumbnail-"));
		try {
			const input = join(root, "source.mp4");
			const output = join(root, "thumbnail.jpg");
			await runMediaCommand(
				[
					"ffmpeg",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					`testsrc2=s=${sample.size}:r=24`,
					...(sample.audio ? ["-f", "lavfi", "-i", "sine=frequency=440"] : []),
					"-t",
					sample.duration,
					"-c:v",
					"libx264",
					...(sample.audio ? ["-c:a", "aac"] : []),
					input,
				],
				{ timeoutMs: 10000 },
			);
			await generateThumbnail(input, output);
			const { stdout } = await runMediaCommand(
				[
					"ffprobe",
					"-v",
					"error",
					"-show_entries",
					"stream=codec_name,width,height",
					"-of",
					"json",
					output,
				],
				{ timeoutMs: 5000 },
			);
			expect(JSON.parse(stdout).streams[0]).toMatchObject({
				codec_name: "mjpeg",
				width: sample.width,
				height: sample.height,
			});
			expect(Bun.file(output).size).toBeGreaterThan(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 20000);
}

test("failed extraction removes partial output", async () => {
	const root = await mkdtemp(join(tmpdir(), "yt-thumbnail-invalid-"));
	try {
		const input = join(root, "source");
		const output = join(root, "thumbnail.jpg");
		await Bun.write(input, "invalid media");
		await Bun.write(output, "partial thumbnail");
		await expect(generateThumbnail(input, output)).rejects.toThrow();
		expect(await Bun.file(output).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("thumbnail deadline and cancellation do not leave partial output", async () => {
	const root = await mkdtemp(join(tmpdir(), "yt-thumbnail-deadline-"));
	try {
		const output = join(root, "thumbnail.jpg");
		await expect(
			generateThumbnail("unused", output, undefined, 0),
		).rejects.toBeInstanceOf(MediaTimeoutError);
		const abort = new AbortController();
		abort.abort();
		await expect(
			generateThumbnail("unused", output, abort.signal),
		).rejects.toThrow();
		expect(await Bun.file(output).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("thumbnail failure does not fail a playable video; uncertain publication preserves output", async () => {
	const proc = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"run",
			`${import.meta.dir}/fixtures/thumbnail-worker.ts`,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [exit, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	expect(exit).toBe(0);
	expect(stderr).toContain("Thumbnail generation failed");
	expect(JSON.parse(stdout)).toEqual({
		thumbnailUrl: null,
		sourceCleaned: true,
		publishedOutput: true,
		uncertainOutput: true,
		uncertainSourceCleaned: false,
		uncertainFinishCalls: 1,
	});
}, 10000);
