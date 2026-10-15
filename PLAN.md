# Mini YouTube - Project Plan

## Overview

A video hosting platform where users upload videos and the system generates adaptive HLS streams for playback with automatic quality switching.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Database:** PostgreSQL
- **Web server:** nginx (serves HLS static files)
- **API server:** Elysia (Bun native HTTP framework)
- **Transcoding:** ffmpeg (via worker pool, Bun.spawn)
- **Frontend player:** hls.js (Safari plays natively)

## How HLS Works

Instead of serving a single `.mp4` file, HLS chops the video into small `.ts` segment files (6 seconds each) and creates `.m3u8` playlist files that list them.

**Two-level playlist structure:**

```
master.m3u8                    <- "menu" of all qualities
├── 1080p/playlist.m3u8        <- lists 1080p .ts segments
│   ├── segment_000.ts
│   ├── segment_001.ts
│   └── ...
├── 720p/playlist.m3u8
│   ├── segment_000.ts
│   └── ...
└── 360p/playlist.m3u8
    ├── segment_000.ts
    └── ...
```

**Master playlist example:**

```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"
360p/playlist.m3u8
```

**Adaptive switching:** Player measures download speed, picks best variant, switches at segment boundaries seamlessly.

## Upload Flow

1. User uploads video file
2. Store original on disk
3. Detect source resolution via `ffprobe`
4. Decide rendition ladder based on source height
5. Spawn ffmpeg in worker pool to generate HLS output
6. Store metadata in Postgres (status, duration, renditions, etc.)
7. Generate thumbnail
8. Mark video as `ready`

## Rendition Logic

Generate only renditions that are <= source resolution (never upscale):

| Source Height | Renditions Generated    |
|---------------|-------------------------|
| <= 360        | 360p only               |
| <= 480        | 480p, 360p              |
| <= 720        | 720p, 480p, 360p        |
| > 720         | 1080p, 720p, 360p       |

## ffmpeg Commands

### Detect source resolution

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 input.mp4
```

### Single rendition

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset medium -crf 21 \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "output/segment_%03d.ts" \
  output/playlist.m3u8
```

### Multi-rendition (full ladder)

```bash
ffmpeg -i input.mp4 \
  -filter_complex "[0:v]split=3[v1][v2][v3]; \
    [v1]scale=w=1920:h=1080[v1out]; \
    [v2]scale=w=1280:h=720[v2out]; \
    [v3]scale=w=640:h=360[v3out]" \
  -map "[v1out]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5500k -bufsize:v:0 10000k \
  -map "[v2out]" -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 3000k -bufsize:v:1 5600k \
  -map "[v3out]" -c:v:2 libx264 -b:v:2 800k  -maxrate:v:2 856k  -bufsize:v:2 1200k \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -map a:0 -map a:0 -map a:0 -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments \
  -hls_segment_filename "videos/%v/segment_%03d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  "videos/%v/playlist.m3u8"
```

### Thumbnail generation

```bash
ffmpeg -i input.mp4 -ss 00:00:05 -vframes 1 -q:v 2 thumbnail.jpg
```

Or at 10% of duration:

```bash
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 input.mp4)
SS=$(echo "$DURATION * 0.1" | bc)
ffmpeg -i input.mp4 -ss $SS -vframes 1 -q:v 2 thumbnail.jpg
```

## Directory Structure (per video)

```
videos/
└── {video_id}/
    ├── original.mp4
    ├── thumbnail.jpg
    ├── master.m3u8
    ├── 1080p/
    │   ├── playlist.m3u8
    │   ├── segment_000.ts
    │   ├── segment_001.ts
    │   └── ...
    ├── 720p/
    │   ├── playlist.m3u8
    │   └── ...
    └── 360p/
        ├── playlist.m3u8
        └── ...
```

## Database Schema (Postgres)

### videos table

```sql
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | transcoding | ready | failed
    original_filename TEXT NOT NULL,
    duration_seconds FLOAT,
    source_height INT,
    renditions TEXT[],                        -- array of available renditions e.g. {"1080p","720p","360p"}
    file_size_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## API Endpoints (draft)

| Method | Path                  | Description                        |
|--------|-----------------------|------------------------------------|
| POST   | /api/videos/upload    | Upload video file, start transcode |
| GET    | /api/videos           | List videos                        |
| POST   | /api/videos           | Create Video Record                |
| GET    | /api/videos/:id       | Get video metadata                 |
| DELETE | /api/videos/:id       | Delete video + all files           |
| GET    | /videos/:id/master.m3u8 | Serve HLS master playlist (nginx) |

## nginx Configuration

```nginx
server {
    listen 80;
    server_name videos.example.com;

    # HLS MIME types
    types {
        application/vnd.apple.mpegurl m3u8;
        video/mp2t ts;
        video/mp4 mp4;
        image/jpeg jpg;
    }

    location /videos/ {
        alias /path/to/videos/;
        add_header Access-Control-Allow-Origin *;

        # Segments are immutable once written
        location ~ \.ts$ {
            add_header Cache-Control "public, max-age=31536000, immutable";
        }
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;  # Elysia API server (Bun)
    }
}
```

## Key ffmpeg Flags Reference

| Flag | Purpose |
|------|---------|
| `-g 48` | Keyframe every 48 frames (~2s at 30fps) |
| `-keyint_min 48` | Force minimum keyframe interval |
| `-sc_threshold 0` | Disable scene-change keyframe insertion |
| `-hls_time 6` | 6-second segments (Apple recommended) |
| `-hls_playlist_type vod` | Complete playlist with #EXT-X-ENDLIST |
| `-hls_flags independent_segments` | Each segment decodable standalone |
| `-maxrate` / `-bufsize` | VBV compliance for accurate bandwidth estimation |
| `-crf 21` | Quality target (lower = better, 18-28 typical range) |
| `-preset medium` | Encoding speed vs compression tradeoff |
| `-vf scale=-2:720` | Scale height to 720, width auto-calculated (even number) |

## Important Considerations

### Transcoding

- Worker pool for ffmpeg with configurable concurrency (e.g., max 2 concurrent transcodes)
- Use `Bun.spawn` to run ffmpeg subprocesses asynchronously
- Encode audio once at highest quality, then `-c:a copy` to each rendition
- Use `-preset medium` as default (balance of speed and quality)
- `-threads 0` for auto-detecting CPU cores
- Track transcode status: `pending → transcoding → ready → failed`

### Source Resolution Handling

- Videos can have non-standard resolutions (532p, 1178p, etc.)
- Always detect via `ffprobe` before deciding rendition ladder
- Never upscale — skip renditions taller than source
- Use `scale=-2:HEIGHT` to handle odd source dimensions (rounds width to even)

### Storage

- HLS creates hundreds of small files per video (~300 .ts files for 10min video)
- Total storage is ~1.5-2x the original MP4
- Plan deletion logic — recursive directory delete
- TODO: implement max upload size

### Edge Cases

- Short videos (<6s): fewer segments, works fine
- Already low quality: don't upscale
- Audio-only or no audio: handle missing audio stream
- Variable frame rate (phone screen recordings): force CFR with `-vsync cfr`

### Thumbnail

- Generate at 10% of video duration or fixed timestamp
- Consider sprite sheet for hover-preview (future enhancement)

### Security / Limits

- Max upload size (TODO)
- Per-user upload limits (TODO)
- Authentication (later concern)

## Project Structure

```
src/
├── index.ts              # Entry point, start Elysia server
├── routes/
│   ├── videos.ts         # Video upload, list, get, delete endpoints
│   └── hls.ts            # Serve HLS playlists (if not using nginx)
├── services/
│   ├── transcode.ts      # ffmpeg worker pool & transcoding logic
│   ├── storage.ts        # File storage operations
│   └── database.ts       # PostgreSQL queries (using Bun's native pg driver)
├── db/
│   └── schema.sql        # Database schema
└── utils/
    └── ffmpeg.ts         # ffmpeg command builders
```

## Elysia Server (Bun)

```typescript
import { Elysia } from 'elysia'
import { videoRoutes } from './routes/videos'

const app = new Elysia()
  .use(videoRoutes)
  .listen(3000)

console.log(`Server running at http://localhost:${app.server?.port}`)
```

### Key Bun Features Used

- **Bun.spawn** — Run ffmpeg subprocesses with stream piping
- **Bun.file** — Efficient file reading for uploads
- **Bun.write** — Write transcoded segments to disk
- **Bun postgres driver** — Native PostgreSQL connections (no npm dependency needed)
- **Bun.serve** — Underlying HTTP server (used by Elysia)

### Performance

- `sendfile on` in nginx for efficient static file serving
- Segment caching: immutable .ts files can have aggressive cache headers
- Concurrent uploads competing for CPU — job queue with concurrency limit
- Bun's native TypeScript execution — no compile step needed
