import type { Database } from "@/db";
import type {
	DeleteVideoParams,
	GetVideosQuery,
	GetVideoStatusBody,
	UpdateVideoBody,
	UpdateVideoParams,
	UploadVideoBody,
} from "@/schemas/video.schema";
import {
	getVideos,
	getMyVideos,
	uploadVideo,
	getVideoStatus,
	updateVideoData,
	deleteVideo,
} from "./videos.services";

type SessionUser = { id: string; email: string; name: string };

export async function handleGetVideos({
	db,
	query,
}: {
	db: Database;
	query: GetVideosQuery;
}) {
	const { page } = query;
	const videos = await getVideos(db, { page });
	return videos;
}

export async function handleGetMyVideos({
	db,
	query,
	user,
}: {
	db: Database;
	query: GetVideosQuery;
	user: SessionUser;
}) {
	const { page } = query;
	return getMyVideos(db, { page, authorId: user.id });
}

export async function handleUploadVideo({
	db,
	body,
	user,
}: {
	db: Database;
	body: UploadVideoBody;
	user: SessionUser;
}) {
	const { video } = body;
	const res = await uploadVideo(db, { video, authorId: user.id });
	return res;
}

export async function handleGetVideoStatus({
	db,
	params,
	user,
}: {
	db: Database;
	params: GetVideoStatusBody;
	user: SessionUser;
}) {
	const { jobId } = params;
	const res = await getVideoStatus(db, { jobId, authorId: user.id });
	return res;
}

export async function handleUpdateVideoData({
	db,
	body,
	params,
	user,
}: {
	db: Database;
	body: UpdateVideoBody;
	params: UpdateVideoParams;
	user: SessionUser;
}) {
	const { id } = params;
	const res = await updateVideoData(db, { data: body, id, authorId: user.id });
	return res;
}

export async function handleDeleteVideo({
	db,
	params,
	user,
}: {
	db: Database;
	params: DeleteVideoParams;
	user: SessionUser;
}) {
	const { id } = params;
	return deleteVideo(db, { id, authorId: user.id });
}
