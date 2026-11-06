// Trims a captured fixture to a time window through sliceFixture, so arrays stay
// aligned, and records the trim inside the file. Never trim fixtures by hand.
//   node scripts/trim-fixture.mjs <fixture.json> <fromISO> <toISO>

import { readFile, writeFile } from "node:fs/promises";

import { sliceFixture } from "../backend/test/support/sliceFixture.ts";

const [file, from, to] = process.argv.slice(2);
if (file === undefined || from === undefined || to === undefined) {
  console.error("usage: node scripts/trim-fixture.mjs <fixture.json> <fromISO> <toISO>");
  process.exit(1);
}

const toSeconds = (iso) => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`not an ISO date: ${iso}`);
  return Math.floor(ms / 1000);
};

const period1 = toSeconds(from);
const period2 = toSeconds(to);
const fixture = JSON.parse(await readFile(file, "utf8"));
const trimmed = sliceFixture(fixture, period1, period2);
trimmed.capture.trimmed = { period1, period2, by: "scripts/trim-fixture.mjs" };

await writeFile(file, JSON.stringify(trimmed, null, 2) + "\n");
const count = trimmed.response.body?.chart?.result?.[0]?.timestamp?.length ?? 0;
console.log(`${file}: kept ${count} bars in [${from}, ${to})`);
