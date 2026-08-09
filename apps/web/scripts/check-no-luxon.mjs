#!/usr/bin/env node
// Grepping the bundle for the string "luxon" is worthless: bundling erases
// module specifiers, so a bundle that imports generateSlotGrid (which pulls
// luxon into the engine) shows zero hits on the package name while still
// containing luxon's actual code. Grep for internals luxon's own source
// uses (and that nothing else in this app would plausibly emit) instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dirname, "..", "dist");
// Strings taken from luxon's own source (Zone class names, its DateTime
// invalid-state message, IANA's zero-offset zone id) -- present only if
// luxon's code, not just its package name, made it into the bundle.
const LUXON_MARKERS = ["IANAZone", "Invalid DateTime", "Etc/GMT"];

function listFilesRecursive(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

let distFiles;
try {
  distFiles = listFilesRecursive(DIST_DIR).filter((f) => /\.(js|mjs|cjs)$/.test(f));
} catch (err) {
  console.error(`check-no-luxon: could not read ${DIST_DIR} -- run the build first`);
  throw err;
}

const hits = [];
for (const file of distFiles) {
  const contents = readFileSync(file, "utf8");
  for (const marker of LUXON_MARKERS) {
    if (contents.includes(marker)) hits.push({ file, marker });
  }
}

if (hits.length > 0) {
  console.error("check-no-luxon: found luxon internals in the web bundle:");
  for (const { file, marker } of hits) console.error(`  ${file}: "${marker}"`);
  console.error("luxon must stay engine-side; apps/web has no use for it.");
  process.exit(1);
}

console.log(`check-no-luxon: clean, no luxon internals in ${distFiles.length} bundle file(s).`);
