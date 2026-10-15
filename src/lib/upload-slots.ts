import { AppError } from "./error";

// Do not let authenticated uploads spawn unbounded concurrent ffprobe processes.
export function createUploadSlots(limit: number) {
	let active = 0;
	return async function withSlot<T>(operation: () => Promise<T>): Promise<T> {
		if (active >= limit)
			throw new AppError({
				status: 429,
				message: "Upload processing is busy; retry shortly",
			});
		active++;
		try {
			return await operation();
		} finally {
			active--;
		}
	};
}

export const withUploadSlot = createUploadSlots(2);
