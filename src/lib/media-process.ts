export class MediaTimeoutError extends Error {
	constructor() {
		super("Media processing deadline exceeded");
	}
}

// Drain both pipes while the process runs. Keep probe output and FFmpeg error
// messages bounded even for malformed input or very long encodes.
export async function runMediaCommand(
	cmd: string[],
	options: {
		timeoutMs: number;
		signal?: AbortSignal;
		maxStdoutBytes?: number;
	},
) {
	options.signal?.throwIfAborted();
	const proc = Bun.spawn({
		cmd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	let overflow = false;
	const kill = () => {
		if (proc.exitCode === null) proc.kill("SIGKILL");
	};
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, options.timeoutMs);
	options.signal?.addEventListener("abort", kill, { once: true });
	const collect = async (
		stream: ReadableStream<Uint8Array>,
		limit: number,
		tail: boolean,
	) => {
		let output = new Uint8Array(0);
		const reader = stream.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!tail && output.length + value.length > limit) {
					overflow = true;
					kill();
					continue;
				}
				const combined = new Uint8Array(output.length + value.length);
				combined.set(output);
				combined.set(value, output.length);
				output = combined.length > limit ? combined.slice(-limit) : combined;
			}
		} finally {
			reader.releaseLock();
		}
		return new TextDecoder().decode(output);
	};
	try {
		const [exit, stdout, stderr] = await Promise.all([
			proc.exited,
			collect(proc.stdout, options.maxStdoutBytes ?? 1024 * 1024, false),
			collect(proc.stderr, 16 * 1024, true),
		]);
		options.signal?.throwIfAborted();
		if (timedOut) throw new MediaTimeoutError();
		if (overflow) throw new Error("Media probe output exceeded limit");
		if (exit !== 0)
			throw new Error(stderr || `Media process exited with code ${exit}`);
		return { stdout, stderr };
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", kill);
		kill();
		await proc.exited;
	}
}
