import Elysia, { t } from "elysia";
import { StatusCodes } from "http-status-codes";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/error";

const email = t.String({ format: "email" });
const password = t.String({ minLength: 8 });

function toAuthRequest(c: { request: Request; body?: unknown }) {
	const { request, body } = c;
	const hasBody =
		body !== undefined &&
		(request.headers.get("content-type") ?? "").includes("application/json");
	const headers = new Headers(request.headers);
	headers.delete("content-length");
	return new Request(request.url, {
		method: request.method,
		headers,
		body: hasBody ? JSON.stringify(body) : undefined,
	});
}

export const authRoutes = new Elysia({ prefix: "/auth" })
	.post("/sign-up/email", (c) => auth.handler(toAuthRequest(c)), {
		body: t.Object(
			{ name: t.String({ minLength: 1 }), email, password },
			{ additionalProperties: false },
		),
		response: t.Any(),
		detail: { tags: ["auth"] },
	})
	.post("/sign-in/email", (c) => auth.handler(toAuthRequest(c)), {
		body: t.Object(
			{ email, password, callbackURL: t.Optional(t.String()) },
			{ additionalProperties: false },
		),
		response: t.Any(),
		detail: { tags: ["auth"] },
	})
	.post("/sign-out", (c) => auth.handler(toAuthRequest(c)), {
		response: t.Any(),
		detail: { tags: ["auth"] },
	})
	.get("/get-session", (c) => auth.handler(c.request), {
		response: t.Any(),
		detail: { tags: ["auth"] },
	})
	.get("/list-sessions", (c) => auth.handler(c.request), {
		response: t.Any(),
		detail: { tags: ["auth"] },
	})
	.post("/revoke-session", (c) => auth.handler(toAuthRequest(c)), {
		body: t.Object(
			{ token: t.String(), id: t.Optional(t.String()) },
			{ additionalProperties: false },
		),
		response: t.Any(),
		detail: { tags: ["auth"] },
	})
	.all(
		"/*",
		(c) => {
			const BETTER_AUTH_ACCEPT_METHODS = ["POST", "GET"];
			if (BETTER_AUTH_ACCEPT_METHODS.includes(c.request.method)) {
				return auth.handler(c.request);
			} else {
				throw new AppError({
					status: StatusCodes.METHOD_NOT_ALLOWED,
					message: "Invalid request method",
				});
			}
		},
		{ detail: { hide: true } },
	);
