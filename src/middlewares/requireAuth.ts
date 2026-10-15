import Elysia from "elysia";
import { StatusCodes } from "http-status-codes";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/error";

type SessionUser = { id: string; email: string; name: string };

export const requireAuth = new Elysia({ name: "requireAuth" })
	.derive(async ({ request }) => {
		const session = await auth.api.getSession({ headers: request.headers });
		if (!session?.user) {
			throw new AppError({
				status: StatusCodes.UNAUTHORIZED,
				message: "Unauthorized",
			});
		}
		return { user: session.user as SessionUser };
	})
	.as("scoped");
