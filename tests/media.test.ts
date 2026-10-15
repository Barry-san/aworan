import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProbe, probeVideo } from "../src/lib/probe";
import { runMediaCommand, MediaTimeoutError } from "../src/lib/media-process";
import { createUploadSlots } from "../src/lib/upload-slots";

test("probe rejects missing video, invalid duration, and malformed output", () => {
	for (const value of [
		"{}",
		"not json",
		JSON.stringify({
			streams: [{ codec_type: "audio" }],
			format: { duration: "2" },
		}),
		JSON.stringify({
			streams: [{ codec_type: "video", height: 360 }],
			format: { duration: "NaN" },
		}),
		JSON.stringify({
			streams: [{ codec_type: "video", height: 0 }],
			format: { duration: "2" },
		}),
	]) {
		expect(() => parseProbe(value)).toThrow();
	}
	expect(
		parseProbe(
			JSON.stringify({
				streams: [{ codec_type: "video", height: 720 }],
				format: { duration: "0.2" },
			}),
		),
	).toEqual({ height: 720, durationSeconds: 1, hasAudio: false });
});

test("invalid media is rejected by the real ffprobe process", async () => {
	const root = await mkdtemp(join(tmpdir(), "yt-probe-test-"));
	try {
		const path = join(root, "fake.mp4");
		await Bun.write(path, "not a video");
		expect(probeVideo(path)).rejects.toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("media subprocess deadline kills and reaps a hung process", async () => {
	const start = Date.now();
	await expect(
		runMediaCommand(
			[process.execPath, "--no-env-file", "-e", "setInterval(()=>{},1000)"],
			{ timeoutMs: 100 },
		),
	).rejects.toBeInstanceOf(MediaTimeoutError);
	expect(Date.now() - start).toBeLessThan(3000);
});

test("cancellation stops a running subprocess", async () => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 100);
	try {
		await expect(
			runMediaCommand(
				[process.execPath, "--no-env-file", "-e", "setInterval(()=>{},1000)"],
				{ timeoutMs: 5000, signal: controller.signal },
			),
		).rejects.toThrow();
	} finally {
		clearTimeout(timer);
	}
});

test("stdout is capped while stderr is drained without deadlock", async () => {
	await expect(
		runMediaCommand(
			[
				process.execPath,
				"--no-env-file",
				"-e",
				'process.stdout.write("x".repeat(1000000))',
			],
			{ timeoutMs: 3000, maxStdoutBytes: 1000 },
		),
	).rejects.toThrow("exceeded limit");
	const result = await runMediaCommand(
		[
			process.execPath,
			"--no-env-file",
			"-e",
			'process.stderr.write("x".repeat(1000000));process.stdout.write("ok")',
		],
		{ timeoutMs: 3000 },
	);
	expect(result.stdout).toBe("ok");
	expect(result.stderr.length).toBe(16 * 1024);
});

test("upload slots reject overload and release capacity after errors", async () => {
	const withSlot = createUploadSlots(1);
	let release!: () => void;
	const pending = withSlot(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	await expect(withSlot(async () => 1)).rejects.toMatchObject({ status: 429 });
	release();
	await pending;
	await expect(
		withSlot(async () => {
			throw Error("probe failed");
		}),
	).rejects.toThrow("probe failed");
	expect(await withSlot(async () => 2)).toBe(2);
});
