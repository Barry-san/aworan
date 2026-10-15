import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { storeUpload, discardOwnedSource } from "../src/lib/uploads"

test("same filenames are isolated, and cleanup cannot remove another upload", async () => {
  const root = await mkdtemp(join(tmpdir(), "yt-uploads-test-"))
  try {
    const [a, b] = await Promise.all([
      storeUpload(new File(["first"], "video.mp4"), root),
      storeUpload(new File(["second"], "video.mp4"), root),
    ])
    expect(a.path).not.toBe(b.path)
    expect(await Bun.file(a.path).text()).toBe("first")
    expect(await Bun.file(b.path).text()).toBe("second")
    await a.discard()
    expect(await Bun.file(b.path).text()).toBe("second")
    await discardOwnedSource(b.path, root)
    expect(await Bun.file(b.path).exists()).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("untrusted filenames do not affect storage, and legacy sources are retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "yt-uploads-test-"))
  try {
    const stored = await storeUpload(new File(["data"], "../../video.mp4"), root)
    expect(stored.path.startsWith(root + "/upload-")).toBe(true)
    const legacy = join(root, "video.mp4")
    await Bun.write(legacy, "legacy")
    await discardOwnedSource(legacy, root)
    expect(await Bun.file(legacy).text()).toBe("legacy")
    await stored.discard()
  } finally { await rm(root, { recursive: true, force: true }) }
})
