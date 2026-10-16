import { and, eq, desc } from "drizzle-orm";
import type { Database } from "@/db";
import {
	ffmpegJobs,
	type NewFfmpegJob,
	type NewVideo,
	videos,
} from "@/db/schema";
import { ENV } from "@/ENV";

export async function createVideoEntry(
	db: Pick<Database, "insert">,
	createVideoData: NewVideo,
) {
	return db.insert(videos).values(createVideoData).returning();
}

export async function fetchVideos(db: Database, offset: number) {
	return db
		.select()
		.from(videos)
		.offset(offset)
		.limit(ENV.PAGE_LIMIT)
		.orderBy(desc(videos.created_at));
}

export async function fetchVideosByAuthor(
	db: Database,
	offset: number,
	authorId: string,
) {
	return db
		.select()
		.from(videos)
		.where(eq(videos.author_id, authorId))
		.offset(offset)
		.limit(ENV.PAGE_LIMIT)
		.orderBy(videos.created_at);
}

export async function fetchVideo(
	db: Pick<Database, "select">,
	{ video_id, author_id }: { video_id: string; author_id?: string },
) {
	const conditions = [eq(videos.video_id, video_id)];
	if (author_id !== undefined) conditions.push(eq(videos.author_id, author_id));
	const [row] = await db
		.select()
		.from(videos)
		.where(and(...conditions))
		.limit(1);
	return row;
}

export async function createVideo(db: Database, videoData: NewVideo) {
	return db.insert(videos).values(videoData).returning();
}

export async function updateVideo(
	db: Database,
	video_id: string,
	videoData: Partial<NewVideo>,
) {
	return db
		.update(videos)
		.set(videoData)
		.where(eq(videos.video_id, video_id))
		.returning();
}

export async function deleteVideoRow(
	db: Pick<Database, "delete">,
	{ id, authorId }: { id: string; authorId: string },
) {
	return db
		.delete(videos)
		.where(and(eq(videos.video_id, id), eq(videos.author_id, authorId)))
		.returning({ id: videos.video_id });
}

export async function cancelVideoJobs(
	db: Pick<Database, "update">,
	videoId: string,
) {
	return db
		.update(ffmpegJobs)
		.set({
			status: "cancelled",
			lease_token: null,
			lease_expires_at: null,
			finished_at: new Date(),
		})
		.where(eq(ffmpegJobs.video_id, videoId))
		.returning({ source: ffmpegJobs.source_path });
}

export async function createFfmpegJob(
	db: Pick<Database, "insert">,
	jobData: NewFfmpegJob,
) {
	return db.insert(ffmpegJobs).values(jobData).returning({
		job_id: ffmpegJobs.job_id,
	});
}

export async function fetchVideoStatus(
	db: Database,
	jobId: number,
	authorId?: string,
) {
	const where = authorId
		? { job_id: jobId, video: { author_id: authorId } }
		: { job_id: jobId };
	return db.query.ffmpegJobs.findFirst({
		where,
		columns: {
			job_id: true,
			video_id: true,
			status: true,
			progress: true,
			error_message: true,
		},
	});
}
