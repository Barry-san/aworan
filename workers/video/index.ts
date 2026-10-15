import { SQL } from "bun";
import { db } from "@/db";
import { ENV } from "@/ENV";
import { createQueue } from "./queue";
import { execute } from "./execute";
import { createMediaCleanup } from "@/lib/media-cleanup";

const MAX_CONCURRENCY = 2;
const queue = createQueue(db);
const cleanup = createMediaCleanup(db);
let cleaning = false;
async function cleanMedia() {
	if (cleaning) return;
	cleaning = true;
	try {
		await cleanup.sweep();
	} catch (error) {
		console.error("Media cleanup failed; will retry", error);
	} finally {
		cleaning = false;
	}
}
let running = 0;
let sweeping = false;
let stopping = false;
const pg = new SQL({
	adapter: "postgres",
	username: ENV.DB_USER,
	password: ENV.DB_PASSWORD,
	port: ENV.DB_PORT,
	database: ENV.DB_NAME,
	hostname: ENV.DB_HOST,
});

async function sweep() {
	if (sweeping || stopping) return;
	sweeping = true;
	try {
		await queue.failExhausted();
		while (!stopping && running < MAX_CONCURRENCY) {
			const job = await queue.claim();
			if (!job) break;
			running++;
			void execute(job, queue, process.cwd(), (path) => cleanup.source(path))
				.catch((error) => console.error("Job execution failed", error))
				.finally(() => {
					running--;
					void sweep();
				});
		}
	} catch (error) {
		console.error("Queue sweep failed", error);
	} finally {
		sweeping = false;
	}
}

async function startWorker() {
	// Notifications are wakeups; polling also recovers expired leases.
	const poll = setInterval(() => void sweep(), 5000);
	const cleanupPoll = setInterval(() => void cleanMedia(), 60_000);
	void cleanMedia();
	const subscription = await pg
		.listen(
			"ffmpeg_queue",
			() => void sweep(),
			() => void sweep(),
		)
		.catch((error) => {
			console.error("Queue listener unavailable; polling", error);
			return undefined;
		});
	const stop = () => {
		stopping = true;
		clearInterval(poll);
		clearInterval(cleanupPoll);
		void subscription?.unlisten().catch(console.error);
		// Existing jobs continue heartbeating until completion.
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	await sweep();
}

void startWorker().catch(console.error);
