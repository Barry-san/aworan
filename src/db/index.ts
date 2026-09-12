import { defineRelationsPart } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "@/db/schema"
import { ENV } from "@/ENV"

const pool = new Pool({
  database: ENV.DB_NAME,
  user: ENV.DB_USER,
  password: ENV.DB_PASSWORD,
  host: ENV.DB_HOST,
  port: ENV.DB_PORT,
  ssl: false,
})

const relations = defineRelationsPart(schema)

export const db = drizzle({ client: pool, relations })

export type Database = typeof db
