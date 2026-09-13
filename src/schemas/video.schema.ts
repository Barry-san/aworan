import { t, type UnwrapSchema } from "elysia";

export const uploadVideoSchema = t.Object({
  video: t.File({
    maxSize: "300m",
    type : "video/*"
  })
})

export type UploadVideoBody = UnwrapSchema<typeof uploadVideoSchema>
