import { integer, jsonb, pgTable, text, timestamp, uuid,varchar} from "drizzle-orm/pg-core"


export const videos = pgTable("videos", {
  video_id: uuid().primaryKey(),
  title: varchar({ length: 255 }).notNull(),
  description: text(),
  status: text().notNull(),
  duration_seconds: integer().notNull(),
  source_height: integer(),
  file_size_bytes: integer().notNull(),
  created_at: timestamp().notNull().defaultNow(),
}
)

export const ffmpeg_jobs = pgTable("ffmpeg_jobs", {
	job_id: integer().generatedByDefaultAsIdentity(),
	status: varchar().notNull().default("pending"),
	job_details: jsonb().notNull(),
  created_at: timestamp().notNull().defaultNow(),
});

export type NewVideo = typeof videos.$inferInsert
export type Video = typeof videos.$inferSelect

export type FfmpegJob = typeof ffmpeg_jobs.$inferSelect
export type NewFfmpegJob = typeof ffmpeg_jobs.$inferInsert
