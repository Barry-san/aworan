import { expect, test } from "bun:test";
import { testSite } from "../src/lib/test-site";

test("serves the video test page as HTML", async () => {
  const response = await testSite.handle(new Request("http://localhost/"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(await response.text()).toContain('id="upload-form"');
});

test("does not expose arbitrary files through the media route", async () => {
  for (const path of ["/videos/not-a-video/master.m3u8", "/videos/00000000-0000-0000-0000-000000000000/source", "/videos/00000000-0000-0000-0000-000000000000/%2e%2e%2f%2e%2e%2f.env"]) {
    const response = await testSite.handle(new Request(`http://localhost${path}`));
    expect(response.status).toBe(404);
  }
});


test("serves attempt thumbnails as JPEG and rejects unrelated images and symlinks", async () => {
  const { mkdir, rm, symlink } = await import("node:fs/promises")
  const { resolve } = await import("node:path")
  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  const directory = resolve(import.meta.dir, "../videos", id, token)
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  try {
    await mkdir(directory, { recursive: true })
    await Bun.write(`${directory}/thumbnail.jpg`, image)
    const url = `http://localhost/videos/${id}/${token}/thumbnail.jpg`
    const response = await testSite.handle(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image)
    expect((await testSite.handle(new Request(url.replace("thumbnail.jpg", "other.jpg")))).status).toBe(404)
    await rm(`${directory}/thumbnail.jpg`)
    await symlink(resolve(import.meta.dir, "../package.json"), `${directory}/thumbnail.jpg`)
    expect((await testSite.handle(new Request(url))).status).toBe(404)
  } finally { await rm(resolve(directory, ".."), { recursive: true, force: true }) }
})
