import { connectMongo } from "#libs/mongo/index.js";
import { createIndexes } from "#libs/mongo/indexes.js";
import { env } from "#env.js";
import { waitForRedisReady } from "#libs/redis/index.js";
import { buildApp } from "#app.js";

async function main(): Promise<void> {
  // Index creation runs before the HTTP listener starts. A running API
  // without uniq_slot_claim is a correctness hazard, so a failure here
  // exits the process rather than serving traffic against an unsafe schema.
  await connectMongo();
  await createIndexes();

  // Redis holds are advisory UX, never truth (section 4), so an unreachable
  // Redis at boot degrades rather than blocking startup.
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
