import { and, eq, sql } from "drizzle-orm"
import type { Database } from "@/db"
import { ffmpegJobs, videos, type FfmpegJob } from "@/db/schema"

export const LEASE_SECONDS = 60
export const MAX_ATTEMPTS = 3
export type ClaimedJob = FfmpegJob & { lease_token: string }

export function createQueue(db: Database) {
  return {
    async claim(): Promise<ClaimedJob | undefined> {
      return db.transaction(async (tx) => {
        // Claim one available job atomically. Database time avoids host clock skew.
        const result = await tx.execute(sql`
          WITH candidate AS (
            SELECT job_id FROM ffmpeg_jobs
            WHERE attempt < ${MAX_ATTEMPTS} AND (
              status = 'pending' OR (status = 'transcoding' AND
                (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()))
            )
            ORDER BY created_at, job_id
            FOR UPDATE SKIP LOCKED LIMIT 1
          )
          UPDATE ffmpeg_jobs AS job SET
            status = 'transcoding', attempt = attempt + 1,
            lease_token = ${crypto.randomUUID()}::uuid,
            lease_expires_at = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
            started_at = clock_timestamp(), finished_at = NULL,
            progress = 0, error_message = NULL
          FROM candidate WHERE job.job_id = candidate.job_id RETURNING job.*
        `)
        const job = result.rows[0] as ClaimedJob | undefined
        if (job) await tx.update(videos).set({ status: "processing", updated_at: new Date() })
          .where(eq(videos.video_id, job.video_id))
        return job
      })
    },
    async renew(job: ClaimedJob) {
      const result = await db.update(ffmpegJobs).set({
        lease_expires_at: sql`clock_timestamp() + ${LEASE_SECONDS} * interval '1 second'`,
      }).where(owns(job)).returning({ id: ffmpegJobs.job_id })
      return result.length === 1
    },
    async finish(job: ClaimedJob, outcome: { streamUrl: string; heights: number[]; thumbnailUrl?: string | null } | { error: string }) {
      return db.transaction(async (tx) => {
        const success = "streamUrl" in outcome
        // Lock and fence the attempt before publishing its video in this transaction.
        const rows = await tx.update(ffmpegJobs).set({
          status: success ? "done" : "failed", progress: success ? 100 : 0,
          error_message: success ? null : outcome.error,
          finished_at: new Date(), lease_expires_at: null,
        }).where(owns(job)).returning({ id: ffmpegJobs.job_id })
        if (!rows.length) return false
        await tx.update(videos).set(success ? {
          status: "ready", stream_url: outcome.streamUrl, thumbnail_url: outcome.thumbnailUrl ?? null,
          renditions: outcome.heights.map((h) => `${h}p`), updated_at: new Date(),
        } : { status: "failed", updated_at: new Date() })
          .where(eq(videos.video_id, job.video_id))
        return true
      })
    },
    async failExhausted() {
      await db.transaction(async (tx) => {
        const result = await tx.execute(sql`
          WITH exhausted AS (
            SELECT job_id FROM ffmpeg_jobs WHERE attempt >= ${MAX_ATTEMPTS}
              AND (status = 'pending' OR (status = 'transcoding' AND
                (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())))
            FOR UPDATE SKIP LOCKED
          )
          UPDATE ffmpeg_jobs AS job SET status = 'failed',
            error_message = 'Worker lease expired; retry limit reached',
            finished_at = clock_timestamp(), lease_expires_at = NULL
          FROM exhausted WHERE job.job_id = exhausted.job_id RETURNING job.video_id
        `)
        for (const row of result.rows) await tx.update(videos)
          .set({ status: "failed", updated_at: new Date() })
          .where(eq(videos.video_id, row.video_id as string))
      })
    },
  }
}

function owns(job: ClaimedJob) {
  return and(eq(ffmpegJobs.job_id, job.job_id), eq(ffmpegJobs.status, "transcoding"),
    eq(ffmpegJobs.lease_token, job.lease_token),
    sql`${ffmpegJobs.lease_expires_at} > clock_timestamp()`)
}
