import "dotenv/config"

import { defineConfig } from "drizzle-kit"
import { ENV } from "./src/ENV";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		user: ENV.DB_USER,
		password: ENV.DB_PASSWORD,
		port: ENV.DB_PORT,
		database: ENV.DB_NAME,
		host: ENV.DB_HOST,
	},
});
