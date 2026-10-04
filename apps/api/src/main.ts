import "#libs/sentry/index.js";
import { connectMongo } from "#libs/mongo/index.js";
import { createIndexes } from "#libs/mongo/indexes.js";
import { env } from "#env.js";
import { waitForRedisReady } from "#libs/redis/index.js";
import { buildApp } from "#app.js";

async function main(): Promise<void> {
  await connectMongo();
  await createIndexes();

  try {
    await waitForRedisReady();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "redis_not_ready_at_boot",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const app = buildApp();
  app.listen(env.PORT, () => {
    console.log(`api listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal error during boot:", err);
  process.exit(1);
});
