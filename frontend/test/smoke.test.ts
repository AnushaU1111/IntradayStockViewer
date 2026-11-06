import { describe, expect, it } from "vitest";

import { API_VERSION } from "@isv/shared";

describe("frontend smoke", () => {
  it("resolves the shared workspace package from source", () => {
    expect(API_VERSION).toBe("v1");
  });
});
