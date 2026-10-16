import "./fixtures/env";
import { createMediaCleanup, ORPHAN_GRACE_MS } from "../src/lib/media-cleanup";
import { deleteVideo } from "../src/features/videos/videos.services";
import { MAX_UPLOAD_BYTES, MAX_REQUEST_BYTES } from "../src/lib/media-config";
import {
	beforeAll,
	afterAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { mkdtemp, rm, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as schema from "../src/db/schema";
import { createQueue, MAX_ATTEMPTS } from "../workers/video/queue";
import { execute } from "../workers/video/execute";
import { storeUpload } from "../src/lib/uploads";

// Explicit opt-in only. Each suite creates and drops its own isolated schema.
const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const migrationFolder = resolve(import.meta.dir, "../drizzle");
const migrations = readMigrationFiles({ migrationsFolder: migrationFolder });

integration("PostgreSQL migrations and job ownership", () => {
	const namespace = `yt_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const admin = new Pool({ connectionString });
	const pool = new Pool({
		connectionString,
		options: `-c search_path=${namespace}`,
		max: 10,
	});
	const db = drizzle({ client: pool, relations: schema.relations });
	const queue = createQueue(db);

	beforeAll(async () => {
		await admin.query(`CREATE SCHEMA "${namespace}"`);
		await migrate(db, {
			migrationsFolder: migrationFolder,
			migrationsSchema: namespace,
		});
	});
	afterAll(async () => {
		await pool.end();
		await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
		await admin.end();
	});
	beforeEach(async () => {
		await pool.query('TRUNCATE videos, "user" CASCADE');
	});

	async function seed(sourcePath = "/unused/source") {
		const id = crypto.randomUUID();
		await pool.query(
			"INSERT INTO videos(video_id,title,file_size_bytes) VALUES ($1,'test',1)",
			[id],
		);
		const { rows } = await pool.query(
			"INSERT INTO ffmpeg_jobs(video_id,source_path,ladder) VALUES ($1,$2,'[360]') RETURNING job_id",
			[id, sourcePath],
		);
		return { id, jobId: rows[0].job_id };
	}
	async function expire(jobId: number) {
		await pool.query(
			"UPDATE ffmpeg_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id=$1",
			[jobId],
		);
	}

	async function seedOwned(sourcePath?: string) {
		await pool.query(
			"INSERT INTO \"user\"(id,name,email) VALUES ('owner','Owner','owner@example.com')",
		);
		const seeded = await seed(sourcePath);
		await pool.query("UPDATE videos SET author_id='owner' WHERE video_id=$1", [
			seeded.id,
		]);
		return seeded;
	}

	test("fresh migrations create auth tables and enforce author references", async () => {
		for (const table of ["user", "session", "account", "verification"]) {
			expect(
				(
					await pool.query("SELECT to_regclass($1) AS name", [
						`${namespace}.${table}`,
					])
				).rows[0].name,
			).toBeTruthy();
		}
		await pool.query(
			"INSERT INTO \"user\"(id,name,email) VALUES ('owner','Owner','owner@example.com')",
		);
		const { id } = await seed();
		await pool.query("UPDATE videos SET author_id='owner' WHERE video_id=$1", [
			id,
		]);
		await pool.query("DELETE FROM \"user\" WHERE id='owner'");
		expect(
			(await pool.query("SELECT * FROM videos WHERE video_id=$1", [id]))
				.rowCount,
		).toBe(0);
	});

	test("concurrent workers and repeated polling claim each job only once", async () => {
		const jobs = await Promise.all(Array.from({ length: 4 }, () => seed()));
		const claims = (
			await Promise.all(
				Array.from({ length: 12 }, () => createQueue(db).claim()),
			)
		).filter(Boolean);
		expect(claims.length).toBe(jobs.length);
		expect(new Set(claims.map((job) => job!.job_id)).size).toBe(jobs.length);
		expect(await queue.claim()).toBeUndefined();
		expect(claims.every((job) => job!.attempt === 1)).toBe(true);
	});

	test("a new worker leaves live leases alone, renews ownership, and reclaims only expiry", async () => {
		const { jobId, id } = await seed();
		const first = (await queue.claim())!;
		expect(await createQueue(db).claim()).toBeUndefined();
		expect(await queue.renew(first)).toBe(true);
		await expire(jobId);
		expect(await queue.renew(first)).toBe(false);
		const second = (await createQueue(db).claim())!;
		expect(second.lease_token).not.toBe(first.lease_token);
		expect(second.attempt).toBe(2);
		expect(
			await queue.finish(first, {
				streamUrl: "/stale",
				heights: [360],
				thumbnailUrl: "/stale.jpg",
			}),
		).toBe(false);
		expect(await queue.finish(first, { error: "stale failure" })).toBe(false);
		expect(await queue.renew(first)).toBe(false);
		expect(
			await queue.finish(second, {
				streamUrl: "/winner",
				heights: [360],
				thumbnailUrl: "/winner.jpg",
			}),
		).toBe(true);
		const row = (
			await pool.query(
				"SELECT status,stream_url,thumbnail_url FROM videos WHERE video_id=$1",
				[id],
			)
		).rows[0];
		expect(row).toEqual({
			status: "ready",
			stream_url: "/winner",
			thumbnail_url: "/winner.jpg",
		});
		expect(await queue.finish(first, { error: "late failure" })).toBe(false);
	});

	test("expired final attempts become failed without failing a live final attempt", async () => {
		const { jobId, id } = await seed();
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			expect((await queue.claim())!.attempt).toBe(attempt);
			await queue.failExhausted();
			expect(
				(
					await pool.query("SELECT status FROM ffmpeg_jobs WHERE job_id=$1", [
						jobId,
					])
				).rows[0].status,
			).toBe("transcoding");
			await expire(jobId);
		}
		expect(await queue.claim()).toBeUndefined();
		await queue.failExhausted();
		expect(
			(await pool.query("SELECT status FROM videos WHERE video_id=$1", [id]))
				.rows[0].status,
		).toBe("failed");
	});

	test("publication rolls back job completion if the video update fails", async () => {
		await seed();
		const job = (await queue.claim())!;
		await pool.query(
			"ALTER TABLE videos ADD CONSTRAINT reject_test_ready CHECK (status <> 'ready')",
		);
		try {
			await expect(
				queue.finish(job, { streamUrl: "/test", heights: [360] }),
			).rejects.toThrow();
			expect(
				(
					await pool.query("SELECT status FROM ffmpeg_jobs WHERE job_id=$1", [
						job.job_id,
					])
				).rows[0].status,
			).toBe("transcoding");
		} finally {
			await pool.query("ALTER TABLE videos DROP CONSTRAINT reject_test_ready");
		}
	});

	test("deletion fences active attempts and removes sources and output", async () => {
		const root = await mkdtemp(join(tmpdir(), "yt-delete-test-"));
		try {
			await pool.query(
				"INSERT INTO \"user\"(id,name,email) VALUES ('owner','Owner','owner@example.com')",
			);
			const stored = await storeUpload(
				new File(["media"], "video.mp4"),
				join(root, "uploads"),
			);
			const { id } = await seed(stored.path);
			await pool.query(
				"UPDATE videos SET author_id='owner' WHERE video_id=$1",
				[id],
			);
			const job = (await queue.claim())!;
			const output = join(root, "videos", id, job.lease_token, "master.m3u8");
			await Bun.write(output, "partial");
			const thumbnail = join(
				root,
				"videos",
				id,
				job.lease_token,
				"thumbnail.jpg",
			);
			await Bun.write(thumbnail, "thumbnail");
			await expect(
				deleteVideo(db, { id, authorId: "other" }, root),
			).rejects.toMatchObject({ status: 404 });
			expect(await Bun.file(stored.path).exists()).toBe(true);
			await deleteVideo(db, { id, authorId: "owner" }, root);
			expect(await queue.renew(job)).toBe(false);
			expect(
				await queue.finish(job, { streamUrl: "/deleted", heights: [360] }),
			).toBe(false);
			expect(await Bun.file(output).exists()).toBe(false);
			expect(await Bun.file(thumbnail).exists()).toBe(false);
			expect(await Bun.file(stored.path).exists()).toBe(false);
			expect(
				(await pool.query("SELECT * FROM ffmpeg_jobs WHERE video_id=$1", [id]))
					.rowCount,
			).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("missing and repeated deletion return not found", async () => {
		await expect(
			deleteVideo(db, { id: crypto.randomUUID(), authorId: "owner" }),
		).rejects.toMatchObject({ status: 404 });
		const { id } = await seedOwned();
		await deleteVideo(db, { id, authorId: "owner" });
		await expect(
			deleteVideo(db, { id, authorId: "owner" }),
		).rejects.toMatchObject({
			status: 404,
		});
	});

	test("a deletion that removes no row rolls back job cancellation and preserves media", async () => {
		const root = await mkdtemp(join(tmpdir(), "yt-delete-rollback-"));
		await pool.query(`CREATE FUNCTION prevent_video_delete() RETURNS trigger
			LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
		await pool.query(`CREATE TRIGGER prevent_video_delete BEFORE DELETE ON videos
			FOR EACH ROW EXECUTE FUNCTION prevent_video_delete()`);
		try {
			const stored = await storeUpload(
				new File(["media"], "video.mp4"),
				join(root, "uploads"),
			);
			const { id } = await seedOwned(stored.path);
			const job = (await queue.claim())!;
			const output = join(root, "videos", id, job.lease_token, "master.m3u8");
			await Bun.write(output, "partial");
			await expect(
				deleteVideo(db, { id, authorId: "owner" }, root),
			).rejects.toMatchObject({ status: 404 });
			expect(await queue.renew(job)).toBe(true);
			expect(
				(
					await pool.query("SELECT video_id FROM videos WHERE video_id=$1", [
						id,
					])
				).rowCount,
			).toBe(1);
			expect(await Bun.file(stored.path).exists()).toBe(true);
			expect(await Bun.file(output).exists()).toBe(true);
		} finally {
			await pool.query("DROP TRIGGER prevent_video_delete ON videos");
			await pool.query("DROP FUNCTION prevent_video_delete()");
			await rm(root, { recursive: true, force: true });
		}
	});

	test("cleanup failure leaves deletion committed for the sweeper to retry", async () => {
		const root = await mkdtemp(join(tmpdir(), "yt-delete-cleanup-"));
		try {
			const { id } = await seedOwned();
			// A file where the video directory should be makes cleanup fail with ENOTDIR.
			await Bun.write(join(root, "videos"), "blocked directory");
			await expect(
				deleteVideo(db, { id, authorId: "owner" }, root),
			).resolves.toBeUndefined();
			expect(
				(
					await pool.query("SELECT video_id FROM videos WHERE video_id=$1", [
						id,
					])
				).rowCount,
			).toBe(0);
			expect(
				(
					await pool.query("SELECT job_id FROM ffmpeg_jobs WHERE video_id=$1", [
						id,
					])
				).rowCount,
			).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("cleanup removes failed and orphan files but preserves active/shared and published media", async () => {
		const root = await mkdtemp(join(tmpdir(), "yt-cleanup-test-"));
		const cleanup = createMediaCleanup(db, root);
		try {
			const shared = join(root, "uploads", "legacy.mp4");
			await Bun.write(shared, "shared");
			const failed = await seed(shared);
			await pool.query(
				"UPDATE ffmpeg_jobs SET status='failed' WHERE job_id=$1",
				[failed.jobId],
			);
			const active = await seed(shared);
			const orphan = await storeUpload(
				new File(["orphan"], "a.mp4"),
				join(root, "uploads"),
			);
			const recent = await storeUpload(
				new File(["recent"], "b.mp4"),
				join(root, "uploads"),
			);
			const orphanDir = resolve(orphan.path, "..");
			const old = new Date(Date.now() - ORPHAN_GRACE_MS - 1000);
			await utimes(orphanDir, old, old);
			const job = (await queue.claim())!;
			const publishedToken = crypto.randomUUID();
			const abandonedToken = crypto.randomUUID();
			const published = join(root, "videos", failed.id, publishedToken);
			const abandoned = join(root, "videos", failed.id, abandonedToken);
			const live = join(root, "videos", active.id, job.lease_token);
			const legacyFailed = await seed(join(root, "uploads", "failed.mp4"));
			await pool.query(
				"UPDATE ffmpeg_jobs SET status='failed' WHERE job_id=$1",
				[legacyFailed.jobId],
			);
			await pool.query("UPDATE videos SET status='failed' WHERE video_id=$1", [
				legacyFailed.id,
			]);
			const legacyPartial = join(
				root,
				"videos",
				legacyFailed.id,
				"360p",
				"segment_000.ts",
			);
			await Bun.write(legacyPartial, "partial");
			for (const dir of [published, abandoned, live]) {
				await mkdir(dir, { recursive: true });
				await Bun.write(join(dir, "master.m3u8"), "playlist");
				await Bun.write(join(dir, "thumbnail.jpg"), "thumbnail");
				await utimes(dir, old, old);
			}
			await pool.query(
				"UPDATE videos SET status='ready',stream_url=$1 WHERE video_id=$2",
				[`/videos/${failed.id}/${publishedToken}/master.m3u8`, failed.id],
			);
			await cleanup.sweep();
			expect(await Bun.file(shared).exists()).toBe(true);
			expect(await Bun.file(orphan.path).exists()).toBe(false);
			expect(await Bun.file(recent.path).exists()).toBe(true);
			expect(await Bun.file(join(abandoned, "master.m3u8")).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(published, "master.m3u8")).exists()).toBe(
				true,
			);
			expect(await Bun.file(join(published, "thumbnail.jpg")).exists()).toBe(
				true,
			);
			expect(await Bun.file(join(abandoned, "thumbnail.jpg")).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(live, "master.m3u8")).exists()).toBe(true);
			expect(await Bun.file(legacyPartial).exists()).toBe(false);
			await queue.finish(job, { error: "failed" });
			await cleanup.sweep();
			expect(await Bun.file(shared).exists()).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("HTTP body limit permits the advertised file size plus multipart overhead", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			maxRequestBodySize: MAX_REQUEST_BYTES,
			async fetch(request) {
				// Use Bun's buffered parser, as multipart parsing does in the API.
				const body = await request.arrayBuffer();
				return new Response(String(body.byteLength));
			},
		});
		const body = (size: number) => {
			let remaining = size;
			return new ReadableStream<Uint8Array>({
				pull(controller) {
					if (!remaining) {
						controller.close();
						return;
					}
					const length = Math.min(remaining, 1024 * 1024);
					controller.enqueue(new Uint8Array(length));
					remaining -= length;
				},
			});
		};
		try {
			const accepted = await fetch(server.url, {
				method: "POST",
				body: body(MAX_UPLOAD_BYTES + 512),
			});
			expect(accepted.status).toBe(200);
			expect(await accepted.text()).toBe(String(MAX_UPLOAD_BYTES + 512));
			const rejected = await fetch(server.url, {
				method: "POST",
				body: body(MAX_REQUEST_BYTES + 1),
			});
			expect(rejected.status).toBe(413);
			await rejected.text();
		} finally {
			await server.stop(true);
		}
	}, 30_000);

	test("real ffmpeg execution publishes attempt output and cleans only its source", async () => {
		const root = await mkdtemp(join(tmpdir(), "yt-transcode-test-"));
		try {
			const proc = Bun.spawn(
				[
					"ffmpeg",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"testsrc2=s=640x360:r=24",
					"-t",
					"2",
					"-c:v",
					"libx264",
					"-f",
					"mpegts",
					"pipe:1",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const [exit, source, stderr] = await Promise.all([
				proc.exited,
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).text(),
			]);
			expect(stderr).toBe("");
			expect(exit).toBe(0);
			const stored = await storeUpload(
				new File([source], "same.mp4"),
				join(root, "uploads"),
			);
			const other = await storeUpload(
				new File([source], "same.mp4"),
				join(root, "uploads"),
			);
			const { id } = await seed(stored.path);
			const stale = (await queue.claim())!;
			await expire(stale.job_id);
			const job = (await queue.claim())!;
			await execute(stale, queue, root, (path) =>
				createMediaCleanup(db, root).source(path),
			);
			expect(
				await Bun.file(
					join(root, "videos", id, stale.lease_token, "master.m3u8"),
				).exists(),
			).toBe(false);
			expect(await Bun.file(stored.path).exists()).toBe(true);
			await execute(job, queue, root, (path) =>
				createMediaCleanup(db, root).source(path),
			);
			const video = (
				await pool.query(
					"SELECT status,stream_url,thumbnail_url FROM videos WHERE video_id=$1",
					[id],
				)
			).rows[0];
			expect(video.status).toBe("ready");
			expect(video.stream_url).toBe(
				`/videos/${id}/${job.lease_token}/master.m3u8`,
			);
			expect(video.thumbnail_url).toBe(
				`/videos/${id}/${job.lease_token}/thumbnail.jpg`,
			);
			expect(Bun.file(join(root, video.thumbnail_url)).size).toBeGreaterThan(0);
			expect(
				await Bun.file(
					join(root, "videos", id, stale.lease_token, "thumbnail.jpg"),
				).exists(),
			).toBe(false);
			expect(await Bun.file(join(root, video.stream_url)).text()).toContain(
				"360p/playlist.m3u8",
			);
			expect(await Bun.file(stored.path).exists()).toBe(false);
			expect(await Bun.file(other.path).exists()).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);
});

integration("upgrade populated databases", () => {
	test("databases with recorded auth migrations keep users and sessions when adding leases", async () => {
		const namespace = `yt_existing_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new Pool({ connectionString });
		const pool = new Pool({
			connectionString,
			options: `-c search_path=${namespace}`,
		});
		try {
			await admin.query(`CREATE SCHEMA "${namespace}"`);
			for (const migration of migrations.slice(0, -1)) {
				for (const statement of migration.sql) await pool.query(statement);
			}
			await pool.query(
				"INSERT INTO \"user\"(id,name,email) VALUES ('existing','Owner','existing@example.com')",
			);
			await pool.query(`INSERT INTO session(id,expires_at,token,updated_at,user_id)
        VALUES ('session', now() + interval '1 day', 'token', now(), 'existing')`);
			await pool.query(
				"CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint, name text, applied_at timestamp DEFAULT now())",
			);
			for (const migration of migrations.slice(0, -1)) {
				await pool.query(
					"INSERT INTO __drizzle_migrations(hash,created_at,name) VALUES ($1,$2,$3)",
					[migration.hash, migration.folderMillis, migration.name],
				);
			}
			const oldVideo = crypto.randomUUID();
			await pool.query(
				"INSERT INTO videos(video_id,title,file_size_bytes) VALUES ($1,'existing',1)",
				[oldVideo],
			);
			await migrate(drizzle({ client: pool }), {
				migrationsFolder: migrationFolder,
				migrationsSchema: namespace,
			});
			expect(
				(
					await pool.query(
						"SELECT thumbnail_url FROM videos WHERE video_id=$1",
						[oldVideo],
					)
				).rows[0].thumbnail_url,
			).toBeNull();
			expect(
				(await pool.query("SELECT email FROM \"user\" WHERE id='existing'"))
					.rows[0].email,
			).toBe("existing@example.com");
			expect(
				(await pool.query("SELECT token FROM session WHERE id='session'"))
					.rows[0].token,
			).toBe("token");
			expect(
				(
					await pool.query(
						"SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='ffmpeg_jobs' AND column_name LIKE 'lease_%'",
						[namespace],
					)
				).rowCount,
			).toBe(2);
		} finally {
			await pool.end();
			await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
			await admin.end();
		}
	});

	test("old transcoding rows survive migration and migrations rerun safely", async () => {
		const namespace = `yt_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new Pool({ connectionString });
		const pool = new Pool({
			connectionString,
			options: `-c search_path=${namespace}`,
		});
		try {
			await admin.query(`CREATE SCHEMA "${namespace}"`);
			// Apply the historical baseline, then seed a row that broke the old enum cast.
			for (const statement of migrations[0].sql) await pool.query(statement);
			const id = crypto.randomUUID();
			await pool.query(
				"INSERT INTO videos(video_id,title,status,file_size_bytes) VALUES ($1,'old','transcoding',123)",
				[id],
			);
			await pool.query(
				"INSERT INTO ffmpeg_jobs(video_id,source_path,status) VALUES ($1,'/legacy/source','transcoding')",
				[id],
			);
			// Seed the migrator journal as it would exist after the baseline deployment.
			await pool.query(
				"CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint, name text, applied_at timestamp DEFAULT now())",
			);
			await pool.query(
				"INSERT INTO __drizzle_migrations(hash,created_at,name) VALUES ($1,$2,$3)",
				[migrations[0].hash, migrations[0].folderMillis, migrations[0].name],
			);
			const db = drizzle({ client: pool, relations: schema.relations });
			await migrate(db, {
				migrationsFolder: migrationFolder,
				migrationsSchema: namespace,
			});
			await migrate(db, {
				migrationsFolder: migrationFolder,
				migrationsSchema: namespace,
			});
			expect(
				(
					await pool.query(
						"SELECT status,file_size_bytes FROM videos WHERE video_id=$1",
						[id],
					)
				).rows[0],
			).toEqual({ status: "processing", file_size_bytes: 123 });
			const job = await createQueue(db).claim();
			expect(job?.video_id).toBe(id);
			expect(job?.lease_token).toBeTruthy();
		} finally {
			await pool.end();
			await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
			await admin.end();
		}
	});
});
