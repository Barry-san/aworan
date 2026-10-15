import { t, type UnwrapSchema } from "elysia";
import { MAX_UPLOAD_BYTES } from "@/lib/media-config";

export const uploadVideoSchema = t.Object({
	video: t.File({
		maxSize: MAX_UPLOAD_BYTES,
		type: "video/*",
	}),
});

export const getVideoStatusSchema = t.Object({
	jobId: t.Integer({ minimum: 1 }),
});

export const getVideoQuerySchema = t.Object({
	page: t.Optional(t.Number({ minimum: 1 })),
});

export const updateVideoSchema = t.Object(
	{
		title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
		description: t.Optional(t.String({ maxLength: 500 })),
	},
	{ minProperties: 1, additionalProperties: false },
);

export const updateVideoParams = t.Object({
	id: t.String({ format: "uuid" }),
});

export const deleteVideoParams = t.Object({
	id: t.String({ format: "uuid" }),
});

export type UploadVideoBody = UnwrapSchema<typeof uploadVideoSchema>;
export type GetVideoStatusBody = UnwrapSchema<typeof getVideoStatusSchema>;
export type GetVideosQuery = UnwrapSchema<typeof getVideoQuerySchema>;
export type UpdateVideoBody = UnwrapSchema<typeof updateVideoSchema>;
export type UpdateVideoParams = UnwrapSchema<typeof updateVideoParams>;
export type DeleteVideoParams = UnwrapSchema<typeof deleteVideoParams>;
