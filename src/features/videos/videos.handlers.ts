import type { Database } from "@/db";
import type { UploadVideoBody } from "@/schemas/video.schema";
import { getVideos, handleUploadVideo } from "./videos.services";



export async function handleGetVideos({ db }: { db: Database }) {
  const videos = await getVideos(db)
  return videos
}

export async function uploadVideo({ db, body }: { db: Database, body: UploadVideoBody }) {
  const { video } = body
  const res = await handleUploadVideo(db, { video })
  return res

}
