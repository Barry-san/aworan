import { mock } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
mock.module("../../src/ENV", () => ({ ENV: { PAGE_LIMIT: 10 } }))
mock.module("../../src/lib/logger", () => ({ logger: { info() {}, error() {} } }))
const { uploadVideo } = await import("../../src/features/videos/videos.services")
const root = await mkdtemp(join(tmpdir(), "yt-invalid-upload-"))
const previous = process.cwd()
let inserts = 0
try {
  process.chdir(root)
  const db = { transaction: async () => { inserts++; throw Error("unexpected database write") } }
  try {
    await uploadVideo(db as never, { video: new File(["not a video"], "fake.mp4", { type: "video/mp4" }), authorId: "owner" })
    throw Error("Invalid upload unexpectedly accepted")
  } catch (error) {
    console.log(JSON.stringify({ status: (error as { status?: number }).status, inserts, files: await readdir(join(root, "uploads")) }))
  }
} finally {
  process.chdir(previous)
  await rm(root, { recursive: true, force: true })
}
