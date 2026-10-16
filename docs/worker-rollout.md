# Upload and worker ownership changes

Uploads now use `uploads/upload-<random>/source`; the original filename is display
metadata only. The video and its processing job are inserted in one transaction.
Workers claim only available execution slots with `FOR UPDATE SKIP LOCKED`.

Each claim receives a fresh token and a 60-second lease, renewed every 20 seconds
using database time. Polling every five seconds recovers expired leases. At most
three claims are allowed before an expired job becomes failed. Encoding errors
remain terminal failures. Starting a worker never resets live leases.

Output is written under `videos/<video-id>/<lease-token>/`. The token and unexpired
lease must match before the worker can publish a stream URL or record failure.
Publication and job completion share a transaction. Clients should use `stream_url`
from the API rather than construct a master playlist path. Existing stream URLs
and the nginx location rule continue to work.

A worker stops its subprocess when lease renewal fails or ownership is lost.
Separate output directories also protect against an old worker that is paused or
cannot reach the database. Unpublished output is removed when that attempt exits.
Output is preserved when a publication commit has an uncertain result, so a lost
acknowledgement cannot cause deletion of a live stream. A cleanup sweep runs at
worker startup and every minute. It preserves active sources, current attempts,
and published stream URLs. Orphan uploads, deleted-video directories, and abandoned
attempts are removed after a 24-hour grace period to protect in-progress uploads.
Unpublished failed video output (including the legacy layout) is removed as well.

Successful and failed jobs remove their sources after checking for other unfinished
jobs referencing the same path. Shared legacy paths remain until all such jobs are
finished. Deletion invalidates job ownership in a transaction before removing files;
a running worker stops on its next heartbeat (normally within 20 seconds). A local
60-second watchdog also stops processing if renewal hangs. File removal failures
are retried by the sweeper. The worker must be running for scheduled cleanup.

## Migration history

The existing enum migration was repaired to rename `transcoding` to `processing`,
preserving populated rows and defaults. The author migration now creates the auth
tables before its foreign key. These repairs are for databases that have not yet
applied those migrations. Do not replay them on a database where they are recorded
as applied, and do not delete or rewrite the migration journal.

The new `20260929000000_job_leases` migration adds leases and a claim index. It also
creates missing auth tables with `IF NOT EXISTS`, so already-migrated databases
receive that repair without replaying the historical author migration. Existing
auth table definitions are not overwritten; databases set up manually must be
checked for schema drift before migrating. The latest snapshot matches the schema
so subsequent generated migrations do not recreate the auth tables or lease fields.

## Deployment

1. Back up the database and stop uploads and all old workers. Ensure their FFmpeg
   processes have exited. Old workers do not honor leases and must not overlap
   with the new implementation.
2. Inspect `drizzle.__drizzle_migrations` and the actual schema to identify which
   migrations are outstanding. A database created with `drizzle-kit push` needs
   its migration baseline reconciled before running the migration chain.
3. Check outstanding legacy sources for collisions before restarting processing:

   ```sql
   SELECT source_path, array_agg(job_id), count(*)
   FROM ffmpeg_jobs
   WHERE status IN ('pending', 'transcoding')
   GROUP BY source_path HAVING count(*) > 1;
   ```

   Resolve duplicates manually: the code cannot recover source bytes already
   overwritten by an earlier upload. Do not copy one unknown source to every job
   and assume each original has been recovered.
4. Apply outstanding migrations with the installed CLI:
   `bun run drizzle-kit migrate` (uses `drizzle.config.ts` and your configured DB).
5. Start the API and workers (`bun run worker`). Legacy transcoding jobs with no
   lease are eligible for recovery, which is safe only after old workers stop.
6. Verify a new upload reaches `ready`, its returned `stream_url` plays, and a
   second worker does not duplicate a live job.

The lease migration was applied to the configured `yt` database on 2026-09-29.
The three earlier migrations were baselined after verifying their schema changes
were already present. A pre-migration backup is in `/Users/Mubarak/backups/yt/`.

## Tests

`bun test` runs upload tests and skips database integration tests unless
`TEST_DATABASE_URL` is explicitly supplied. `bun run typecheck` includes tests.

To run the full integration suite, point `TEST_DATABASE_URL` at a disposable
PostgreSQL database and run `bun test`. The role needs schema creation privileges.
Tests create and drop isolated schemas and temporary media directories. They cover
fresh and populated migrations, concurrent workers, expired and live leases,
stale publication/failure rejection, retry limits, transactional publication, and
real FFmpeg output. FFmpeg and ffprobe must be installed for that suite.

## API and media limits

- Job status: `POST /videos/status/:jobId`.
- Empty metadata patches are rejected; supply a title or description.
- Files are limited to 300 MiB, with 1 MiB additional HTTP multipart allowance.
  Any reverse proxy must allow at least 301 MiB request bodies as well.
- At most two uploads per API process are inspected concurrently; excess requests
  receive 429 and can retry. Failed inspection returns 422; a probe deadline
  returns 408. Files without a video stream, dimensions, or finite positive
  duration are rejected before any video/job rows are inserted.
- `PROBE_TIMEOUT_MS` defaults to 30,000 and `TRANSCODE_TIMEOUT_MS` to 3,600,000.
  Values must be positive integers. Expired transcodes become failed and are
  cleaned up; tune the limit for the maximum video duration and machine speed.
- Media subprocesses drain stdout/stderr concurrently and bound retained output.
  Uploaded media is restricted to file/pipe protocols during probing/transcoding.
- Logging uses Pino JSON output and works without development dependencies.

No additional database migration is required for these API and cleanup changes.
Restart API/worker processes to load them. A worker startup now performs cleanup;
back up any failed upload media you intentionally want to keep for debugging.
