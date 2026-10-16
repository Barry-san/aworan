import { mock } from "bun:test";
mock.module("../../src/db", () => ({ db: {} }));
mock.module("../../src/lib/auth", () => ({
	auth: { api: { getSession: async () => ({ user: { id: "owner" } }) } },
}));
mock.module("../../src/features/videos/videos.services", () => ({
	getVideoStatus: async (_db: unknown, args: unknown) => args,
	updateVideoData: async (_db: unknown, args: unknown) => args,
	getVideos: async () => [],
	getMyVideos: async () => [],
	uploadVideo: async () => ({}),
	deleteVideo: async (_db: unknown, args: unknown) => args,
}));
const { videoRoutes } = await import("../../src/features/videos");
const { Elysia } = await import("elysia");
const app = new Elysia().use(videoRoutes);
const result = [];
for (const [path, method, body] of [
	["/videos/status/1", "POST", undefined],
	["/videos/00000000-0000-4000-8000-000000000000", "PATCH", "{}"],
	[
		"/videos/00000000-0000-4000-8000-000000000000",
		"PATCH",
		'{"title":"Updated"}',
	],
	["/videos/00000000-0000-4000-8000-000000000000", "DELETE", undefined],
] as const) {
	const response = await app.handle(
		new Request("http://localhost" + path, {
			method,
			body,
			headers: body ? { "content-type": "application/json" } : {},
		}),
	);
	result.push({ status: response.status, body: await response.json() });
}
console.log(JSON.stringify(result));
