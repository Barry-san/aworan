import {Elysia} from "elysia"
import { db } from "@/db";
import { uploadVideoSchema } from "@/schemas/video.schema";
import { handleGetVideos, uploadVideo } from "./videos.handlers";

export const videoRoutes = new Elysia({ prefix: "/videos" }).decorate("db", db);

videoRoutes.get("/", handleGetVideos)
videoRoutes.post("/upload", uploadVideo, {body: uploadVideoSchema})
