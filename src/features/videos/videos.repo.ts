import type {  Database } from "@/db";
import {ffmpeg_jobs, type NewFfmpegJob, type NewVideo,  videos } from "@/db/schema";


export async function createVideoEntry(db: Database, createVideoData: NewVideo) {
  return db.insert(videos).values(createVideoData).returning();
}

export async function fetchVideos(db: Database) {
  return db.select().from(videos)
}

export async function createVideo(db: Database, videoData: NewVideo) {
  return db.insert(videos).values(videoData).returning();
}

export async function createFfmpegJob(db: Database, jobData: NewFfmpegJob) {
  return db.insert(ffmpeg_jobs).values(jobData).returning();
}
