import { setupServer } from "msw/node";

/** One MSW server for every frontend test; handlers are set per test. */
export const server = setupServer();
