import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),

  MONGODB_URI: z.string().min(1).regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
  MONGODB_DB: z.string().min(1).max(38),
  REDIS_URL: z.string().url(),
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(500),
  APP_ENV: z.enum(["dev", "prod"]),

  SENTRY_DSN: z.string().url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  MOCK_OTP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  MESSAGE_FROM: z.string().min(1).optional(),
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
