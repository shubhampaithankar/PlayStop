// Gates CI (and the step 0 Atlas provisioning check) before any test runs.
// A replica set existing is not the same claim as "transactions work on it",
// see docs/milestone-2-spec.md section 0 item 2 and section 9. This script
// proves the second claim directly instead of assuming it from the first,
// against whichever MONGODB_URI it is pointed at.
//
// Usage: MONGODB_URI=mongodb://localhost:27017/?replicaSet=rs0 node scripts/assert-replica-set.mjs
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("assert-replica-set: MONGODB_URI is not set");
  process.exit(1);
}

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 500;

async function waitForWritablePrimary(client) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const hello = await client.db("admin").command({ hello: 1 });
    if (hello.isWritablePrimary) return hello;
    if (Date.now() > deadline) {
      throw new Error(
        `no writable primary after ${READY_TIMEOUT_MS}ms (last hello: ${JSON.stringify(hello)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();

    console.log("assert-replica-set: waiting for a writable primary...");
    const hello = await waitForWritablePrimary(client);
    if (!hello.setName) {
      throw new Error(`hello response has no setName; this is not a replica set: ${JSON.stringify(hello)}`);
    }
    console.log(`assert-replica-set: writable primary confirmed, setName=${hello.setName}`);

    const db = client.db("assert_replica_set_probe");
    const t1 = db.collection("t1");
    const t2 = db.collection("t2");

    console.log("assert-replica-set: committing a two-collection transaction...");
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await t1.insertOne({ probe: true }, { session });
        await t2.insertOne({ probe: true }, { session });
      });
    } finally {
      await session.endSession();
    }
    const committedCount = (await t1.countDocuments()) + (await t2.countDocuments());
    if (committedCount !== 2) {
      throw new Error(`expected 2 documents after commit, found ${committedCount}`);
    }
    console.log("assert-replica-set: commit verified, both documents landed");

    console.log("assert-replica-set: verifying an aborted transaction leaves nothing...");
    const abortSession = client.startSession();
    try {
      await abortSession.withTransaction(async () => {
        await t1.insertOne({ probe: "should not persist" }, { session: abortSession });
        throw new Error("deliberate abort");
      });
    } catch (err) {
      if (err.message !== "deliberate abort") throw err;
    } finally {
      await abortSession.endSession();
    }
    const afterAbortCount = await t1.countDocuments();
    if (afterAbortCount !== 1) {
      throw new Error(`expected the abort to leave t1 at 1 document, found ${afterAbortCount}`);
    }
    console.log("assert-replica-set: abort verified, nothing extra was written");

    await t1.drop();
    await t2.drop();

    console.log("assert-replica-set: PASS. Transactions work on this Mongo.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("assert-replica-set: FAIL.", err instanceof Error ? err.message : err);
  console.error(
    "This means the Mongo at MONGODB_URI does not support multi-document transactions " +
      "(or is not reachable / not a replica set). See docs/milestone-2-spec.md section 0 item 2.",
  );
  process.exit(1);
});
