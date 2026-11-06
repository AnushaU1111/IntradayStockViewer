import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./support/server";

// Browser APIs jsdom does not implement. The app uses them only for layout
// and motion, so inert stand-ins are enough.
Element.prototype.scrollIntoView = function scrollIntoView() {
  // no layout in jsdom
};
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
class InertObserver {
  observe(): void {
    // nothing to observe without layout
  }
  unobserve(): void {
    // nothing to observe without layout
  }
  disconnect(): void {
    // nothing to observe without layout
  }
  takeRecords(): [] {
    return [];
  }
}
globalThis.ResizeObserver = InertObserver;
globalThis.IntersectionObserver = InertObserver as unknown as typeof IntersectionObserver;

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
