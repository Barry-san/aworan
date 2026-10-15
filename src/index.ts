import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { Elysia } from "elysia";
import { authRoutes } from "./features/auth";
import { videoRoutes } from "./features/videos";
import { logger } from "./lib/logger";
import { MAX_REQUEST_BYTES } from "./lib/media-config";
import { testSite } from "./lib/test-site";

const app = new Elysia({
	serve: { maxRequestBodySize: MAX_REQUEST_BYTES },
}).use(testSite);

app.use(openapi());
app.use(
	cors({
		origin: ["http://localhost:5173"],
		credentials: true,
		methods: ["DELETE", "GET", "PATCH", "POST", "PUT"],
	}),
);
app.use(videoRoutes);
app.use(authRoutes);

app.onError(({ error, request }) => {
	logger.error({ err: error, path: request.url });
});

app.onAfterResponse(({ request: { method, url }, set: { status } }) => {
	logger.info({
		method,
		url,
		status,
	});
});

app.listen(3000);
