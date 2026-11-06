import { describe, expect, it } from "vitest";

import { API_VERSION } from "../src/index.js";

describe("@isv/shared smoke", () => {
  it("exposes the API version used in every route", () => {
    expect(API_VERSION).toBe("v1");
  });
});
