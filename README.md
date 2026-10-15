# Elysia with Bun runtime

## Getting Started
To get started with this template, simply paste this command into your terminal:
```bash
bun create elysia ./elysia-example
```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.
## Video test page

Run the API with `bun run dev` and the video processor in another terminal with
`bun run worker`, then open http://localhost:3000/. The configured PostgreSQL
database must be running with the project migrations applied. FFmpeg and ffprobe
must be installed for uploads and processing.

Create an account or sign in on the page, choose a video (up to 300 MiB), and click
**Upload video**. The page shows upload progress, polls the processing job, and
loads the finished HLS stream into the player. Press play to test playback. You
can also browse existing videos with the library's pagination and refresh controls.

The API serves generated playlists and segments locally; nginx is optional for
this test page. Safari supports HLS natively; other supported browsers use HLS.js
loaded from jsDelivr, which requires an internet connection. Authentication uses
the existing same-origin session cookies.

## Generated thumbnails

New processing jobs generate a JPEG thumbnail (up to 640 pixels wide, without
upscaling) alongside the HLS output. The worker tries a frame at one second,
falling back to the first frame for short clips. `THUMBNAIL_TIMEOUT_MS` sets the
combined extraction deadline (default: 15000 ms). A failed thumbnail does not
fail a successfully encoded video; its `thumbnail_url` remains null.

Apply migrations, including `20261014000000_video_thumbnails`, before starting
the updated API and worker. The feed and library responses include the nullable
`thumbnail_url`, a relative media URL. Existing videos remain unchanged; no
backfill runs automatically. Attempt-scoped images follow the same publication,
lease fencing, deletion, and orphan cleanup rules as their HLS streams.
