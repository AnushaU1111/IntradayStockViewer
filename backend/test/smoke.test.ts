import { afterEach, describe, expect, it } from "vitest";

import { API_VERSION } from "@isv/shared";

import { buildApp } from "../src/app.js";

describe("backend smoke", () => {
  const app = buildApp();

  afterEach(async () => {
    await app.close();
  });

  it("answers the liveness check", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("resolves the shared workspace package", () => {
    expect(API_VERSION).toBe("v1");
  });
});
