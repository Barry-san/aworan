import { basename } from "node:path";
import { StatusCodes } from "http-status-codes";
import type { Database } from "@/db";
import { ENV } from "@/ENV";
import { AppError } from "@/lib/error";
import { ladderFor } from "@/lib/ffmpeg";
import { logger } from "@/lib/logger";
import { createMediaCleanup } from "@/lib/media-cleanup";
import { storeUpload } from "@/lib/uploads";
import { probeVideo } from "@/lib/probe";
import { withUploadSlot } from "@/lib/upload-slots";
import { MediaTimeoutError } from "@/lib/media-process";
import type { UpdateVideoBody } from "@/schemas/video.schema";
import {
	cancelVideoJobs,
	createFfmpegJob,
	createVideoEntry,
	deleteVideoRow,
	fetchVideo,
	fetchVideoStatus,
	fetchVideos,
	fetchVideosByAuthor,
	updateVideo,
} from "./videos.repo";

export async function getVideos(db: Database, { page }: { page?: number }) {
	const offset = page ? ENV.PAGE_LIMIT * (page - 1) : 0;
	const videos = await fetchVideos(db, offset);
	return videos;
}

export async function getMyVideos(
	db: Database,
	{ page, authorId }: { page?: number; authorId: string },
) {
	const offset = page ? ENV.PAGE_LIMIT * (page - 1) : 0;
	return fetchVideosByAuthor(db, offset, authorId);
}
export async function getVideo(
	db: Database,
	{ video_id }: { video_id: string },
) {
	return fetchVideo(db, { video_id });
}

export async function uploadVideo(
	db: Database,
	{ video, authorId }: { video: File; authorId: string },
) {
	return withUploadSlot(async () => {
		const fileName = basename(video.name);
		const stored = await storeUpload(video);
		const uploadPath = stored.path;
		try {
			const { height, durationSeconds } = await probeVideo(uploadPath).catch(
				(error) => {
					throw new AppError({
						status: error instanceof MediaTimeoutError ? 408 : 422,
						message:
							error instanceof MediaTimeoutError
								? "Video inspection timed out"
								: "Invalid or unsupported video",
					});
				},
			);

			const { videoRow, job } = await db.transaction(async (tx) => {
				const [videoRow] = await createVideoEntry(tx, {
					title: fileName.slice(0, 255),
					file_size_bytes: video.size,
					status: "pending",
					source_height: height,
					duration_seconds: durationSeconds,
					author_id: authorId,
				});

				const [job] = await createFfmpegJob(tx, {
					video_id: videoRow.video_id,
					source_path: uploadPath,
					ladder: height ? ladderFor(height) : [360],
				});
				return { videoRow, job };
			});

			return {
				videoId: videoRow.video_id,
				jobId: job.job_id,
				fileName,
				sizeInBytes: video.size,
				sourceHeight: height,
				durationSeconds,
			};
		} catch (e) {
			await stored.discard();
			logger.info(e);
			if (e instanceof AppError) throw e;
			throw new AppError({
				message: "failed to create video processing job",
				status: 500,
			});
		}
	});
}

export async function updateVideoData(
	db: Database,
	{
		data,
		id,
		authorId,
	}: { data: UpdateVideoBody; id: string; authorId: string },
) {
	const video = await fetchVideo(db, { video_id: id, author_id: authorId });
	if (!video)
		throw new AppError({
			status: StatusCodes.NOT_FOUND,
			message: "video not found",
		});
	if (data.title === undefined && data.description === undefined) {
		throw new AppError({
			status: StatusCodes.BAD_REQUEST,
			message: "Provide a title or description",
		});
	}
	const updateData = { ...data, updated_at: new Date() };
	return updateVideo(db, id, updateData);
}

export async function deleteVideo(
	db: Database,
	{ id, authorId }: { id: string; authorId: string },
	root = process.cwd(),
) {
	const sources = await db.transaction(async (tx) => {
		const video = await fetchVideo(tx, { video_id: id, author_id: authorId });
		if (!video)
			throw new AppError({
				status: StatusCodes.NOT_FOUND,
				message: "video not found",
			});
		// Lock jobs first, matching the worker's publication lock order. Clearing
		// ownership before deleting rows fences every in-flight processing attempt.
		const jobs = await cancelVideoJobs(tx, id);
		const deleted = await deleteVideoRow(tx, { id, authorId });
		if (!deleted.length)
			throw new AppError({
				status: StatusCodes.NOT_FOUND,
				message: "video not found",
			});
		return jobs.map((job) => job.source);
	});
	// A file-system failure must not undo a committed deletion. The scheduled
	// sweeper retries orphan cleanup, including output recreated by a dying worker.
	await createMediaCleanup(db, root)
		.deletedVideo(id, sources)
		.catch((error) => {
			logger.error({ err: error, videoId: id }, "Media cleanup deferred");
		});
}

export async function getVideoStatus(
	db: Database,
	{ jobId, authorId }: { jobId: number; authorId: string },
) {
	const job = await fetchVideoStatus(db, jobId, authorId);
	if (!job)
		throw new AppError({
			status: StatusCodes.NOT_FOUND,
			message: "job not found",
		});
	return job;
}
