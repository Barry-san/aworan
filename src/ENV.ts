import { getSchemaValidator, t} from "elysia"

export const envSchema = t.Object({
  DB_PORT: t.Number(),
  DB_USER: t.String(),
  DB_PASSWORD: t.String(),
  DB_HOST: t.String(),
  DB_NAME: t.String()
})

export const ENV = getSchemaValidator(envSchema)?.parse(process.env)
