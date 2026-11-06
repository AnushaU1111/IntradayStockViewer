import Fastify, { type FastifyInstance } from "fastify";

export interface AppOptions {
  logger?: boolean;
}

/**
 * Composition root. Phase 5 adds config, the provider stack and the routes;
 * for now it only proves the server boots and answers its liveness check.
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health/live", () => ({ status: "ok" }));

  return app;
}
