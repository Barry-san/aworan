import {  gt } from "drizzle-orm";
import type {  Database } from "@/db";
import { type NewVideo, videos } from "@/db/schema";

export async function createVideoEntry(db: Database, createVideoData: NewVideo) {
  const res = await db.insert(videos).values(createVideoData).returning();
  return res;
}

export async function fetchVideos(db: Database) {
  const res =  db.select().from(videos)
  return res;
}

export async function createVideo(db: Database, videoData: NewVideo) {
  const res = db.insert(videos).values(videoData)
}
