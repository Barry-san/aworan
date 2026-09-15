import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "@/db";
import { AppError } from "@/lib/error";
import { createFfmpegJob, fetchVideos } from "./videos.repo";

export async function getVideos(db: Database) {
  const videos = await fetchVideos(db)
  return videos;
}

export async function handleUploadVideo(db: Database, { video }: { video: File }) {
  const videoPath = resolve(process.cwd(), `uploads/${video.name}`)
  await Bun.write(resolve(videoPath, `uploads/${video.name}`), video);
  try {
   await createFfmpegJob(db, {job_details: {videoPath}})
  }
  catch {
    rmSync(videoPath, {recursive : true, force: true})

    throw new AppError({
      message: "failed to create video processing job",
      status: 400
    })
  }
  return { videoPath, sizeInBytes: video.size, fileName: video.name }
}
