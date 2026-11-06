import { afterEach, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { API_VERSION } from "@isv/shared";

import { testApp } from "./support/app.js";

describe("backend smoke", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("answers the liveness check", async () => {
    app = await testApp();
    const res = await app.inject({ method: "GET", url: "/health/live" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("resolves the shared workspace package", () => {
    expect(API_VERSION).toBe("v1");
  });
});
