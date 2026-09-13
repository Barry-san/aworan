// export function uploadVideo(video: File) {
//   const { name, size } = video;
//   const VIDEO_SIZE_LIMIT =
//   if(size > )
// }

import { resolve } from "node:path";
import type { Database } from "@/db";
import { fetchVideos } from "./videos.repo";

export async function getVideos(db: Database) {
  const videos = await fetchVideos(db)
  return videos;
}

export async function handleUploadVideo(db: Database, { video }: { video: File }) {
  const res = await Bun.write(resolve(process.cwd(), `uploads/${video.name}`), video);
  return res
}
