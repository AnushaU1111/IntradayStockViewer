import { readFileSync } from "node:fs";

import type { FixtureFile } from "./sliceFixture.js";

/** Reads a captured Yahoo fixture from backend/test/fixtures/yahoo. */
export function loadFixture(name: string): FixtureFile {
  const url = new URL(`../fixtures/yahoo/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as FixtureFile;
}

/** A deep copy of a fixture body, for tests that alter one field. */
export function fixtureBody(name: string): Record<string, unknown> {
  return structuredClone(loadFixture(name).response.body) as Record<string, unknown>;
}

const DAY = 86_400;

/** The request window the provider uses for a given clock. */
export function requestWindow(clock: Date): { period1: number; period2: number } {
  const period2 = Math.floor(clock.getTime() / 1000);
  return { period1: period2 - 35 * DAY, period2 };
}
