import { expect, test } from "bun:test";

test("status route and empty metadata patch validation", async () => {
	// Keep mocks in a separate process so integration tests use the actual services.
	const proc = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"run",
			`${import.meta.dir}/fixtures/routes.ts`,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [exit, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const [status, empty, update] = JSON.parse(stdout);
	expect(status).toEqual({
		status: 200,
		body: { jobId: 1, authorId: "owner" },
	});
	expect(empty.status).toBe(422);
	expect(update.status).toBe(200);
});

test("production logger initializes without the development transport", async () => {
	const proc = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"-e",
			'import {mock} from "bun:test";mock.module("pino-pretty",()=>{throw Error("development dependency unavailable")});const {logger}=await import("./src/lib/logger");logger.info("production test")',
		],
		{
			cwd: `${import.meta.dir}/..`,
			env: { ...process.env, NODE_ENV: "production" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exit, stdout] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	expect(exit).toBe(0);
	expect(JSON.parse(stdout).msg).toBe("production test");
});

test("invalid uploads never reach the database and discard the source", async () => {
	const proc = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"run",
			`${import.meta.dir}/fixtures/invalid-upload.ts`,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [exit, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	expect(JSON.parse(stdout)).toEqual({ status: 422, inserts: 0, files: [] });
});
