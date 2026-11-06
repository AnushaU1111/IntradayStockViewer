import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { API_VERSION } from "@isv/shared";

import { renderApp } from "./support/render";

describe("frontend smoke", () => {
  it("resolves the shared workspace package from source", () => {
    expect(API_VERSION).toBe("v1");
  });

  it("renders the app with one h1", () => {
    renderApp();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
