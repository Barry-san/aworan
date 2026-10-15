import { Elysia } from "elysia";
import { db } from "@/db";
import { requireAuth } from "@/middlewares/requireAuth";
import {
	deleteVideoParams,
	getVideoQuerySchema,
	getVideoStatusSchema,
	updateVideoParams,
	updateVideoSchema,
	uploadVideoSchema,
} from "@/schemas/video.schema";
import {
	handleDeleteVideo,
	handleGetMyVideos,
	handleGetVideoStatus,
	handleGetVideos,
	handleUpdateVideoData,
	handleUploadVideo,
} from "./videos.handlers";

export const videoRoutes = new Elysia({ prefix: "/videos" }).decorate("db", db);

videoRoutes
	.get("/", handleGetVideos, { query: getVideoQuerySchema })
	.use(requireAuth)
	.get("/mine", handleGetMyVideos, { query: getVideoQuerySchema })
	.post("/upload", handleUploadVideo, { body: uploadVideoSchema })
	.post("/status/:jobId", handleGetVideoStatus, {
		params: getVideoStatusSchema,
	})
	.patch("/:id", handleUpdateVideoData, {
		body: updateVideoSchema,
		params: updateVideoParams,
	})
	.delete("/:id", handleDeleteVideo, { params: deleteVideoParams });
