import { randomUUIDv7 } from "bun"
import { integer, pgTable, text, timestamp, uuid,varchar} from "drizzle-orm/pg-core"


export const videos = pgTable("videos", {
  video_id: uuid().primaryKey().$default(()=>randomUUIDv7()),
  title: varchar({ length: 255 }).notNull(),
  description: text(),
  status: text().notNull(),
  duration_seconds: integer().notNull(),
  source_height: integer(),
  file_size_bytes: integer().notNull(),
  created_at: timestamp().notNull().defaultNow(),
}
)

export const job = pgTable("", {
  job_id: integer().generatedByDefaultAsIdentity(),

})

export type NewVideo = typeof videos.$inferInsert
export type Video = typeof videos.$inferSelect
