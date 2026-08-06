import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),

  // No defaults on MONGODB_URI or REDIS_URL: an API that silently boots
  // against nothing is worse than one that refuses to start.
  //
  // NOT z.string().url(): section 0a documents the Windows SRV-DNS
  // workaround, a long-form multi-host connection string
  // (mongodb://host1,host2,host3/?replicaSet=...). The WHATWG URL parser
  // that z.string().url() delegates to rejects comma-separated hosts in
  // the authority section, even though it is a valid, driver-documented
  // Mongo connection string. Verified against the real .env on this
  // machine: new URL() throws "Invalid URL" on exactly that string. The
  // driver validates the string on connect; this only guards against an
  // empty or obviously-wrong scheme.
  MONGODB_URI: z.string().min(1).regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
  MONGODB_DB: z.string().min(1).max(38), // Atlas caps database names at 38 bytes
  REDIS_URL: z.string().url(),
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Default 500ms for production (single-digit-ms Redis round trips in
  // Singapore). Dev machines outside Singapore measure a ~357ms p99 to
  // Upstash, so a hardcoded 500 would leave local dev permanently on the
  // edge of degraded mode; set this to 2000 in a local .env instead.
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(500),
  // Drives the Redis key prefix (section 4). Separate from NODE_ENV, which
  // describes the process mode, not which data environment it talks to.
  APP_ENV: z.enum(["dev", "prod"]),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
