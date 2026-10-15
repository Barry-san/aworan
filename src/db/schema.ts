import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm";

export const videoStatusEnum = pgEnum("video_status", [
	"pending",
	"processing",
	"ready",
	"failed",
]);
export const jobStatusEnum = pgEnum("job_status", [
	"pending",
	"probing",
	"transcoding",
	"done",
	"failed",
	"cancelled",
]);

export type VideoStatus = (typeof videoStatusEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];

export const videos = pgTable(
	"videos",
	{
		video_id: uuid()
			.primaryKey()
			.$default(() => crypto.randomUUID()),
		title: varchar({ length: 255 }).notNull(),
		description: text(),
		status: videoStatusEnum().notNull().default("pending"),
		duration_seconds: integer(),
		source_height: integer(),
		file_size_bytes: integer().notNull(),
		renditions: text().array(),
		stream_url: text(),
		thumbnail_url: text(),
		author_id: text("author_id").references(() => user.id, {
			onDelete: "cascade",
		}),
		created_at: timestamp().notNull().defaultNow(),
		updated_at: timestamp().notNull().defaultNow(),
	},
	(table) => [index("videos_author_id_idx").on(table.author_id)],
);

export const ffmpegJobs = pgTable(
	"ffmpeg_jobs",
	{
		job_id: integer().generatedByDefaultAsIdentity().primaryKey(),
		video_id: uuid()
			.notNull()
			.references(() => videos.video_id, { onDelete: "cascade" }),
		status: jobStatusEnum().notNull().default("pending"),
		source_path: text().notNull(),
		progress: integer().notNull().default(0),
		ladder: jsonb(),
		error_message: text(),
		attempt: integer().notNull().default(0),
		lease_token: uuid(),
		lease_expires_at: timestamp({ withTimezone: true }),
		started_at: timestamp(),
		finished_at: timestamp(),
		created_at: timestamp().notNull().defaultNow(),
	},
	(table) => [
		index("ffmpeg_jobs_claim_idx").on(table.status, table.lease_expires_at),
	],
);

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const relations = defineRelations(
	{ videos, ffmpegJobs, user, session, account, verification },
	(helpers) => ({
		videos: {
			jobs: helpers.many.ffmpegJobs(),
			author: helpers.one.user({
				from: helpers.videos.author_id,
				to: helpers.user.id,
			}),
		},
		ffmpegJobs: {
			video: helpers.one.videos({
				from: helpers.ffmpegJobs.video_id,
				to: helpers.videos.video_id,
			}),
		},
		user: {
			sessions: helpers.many.session(),
			accounts: helpers.many.account(),
			videos: helpers.many.videos(),
		},
		session: {
			user: helpers.one.user({
				from: helpers.session.userId,
				to: helpers.user.id,
			}),
		},
		account: {
			user: helpers.one.user({
				from: helpers.account.userId,
				to: helpers.user.id,
			}),
		},
	}),
);

export type NewVideo = typeof videos.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewFfmpegJob = typeof ffmpegJobs.$inferInsert;
export type FfmpegJob = typeof ffmpegJobs.$inferSelect;
