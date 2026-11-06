import { buildApp } from "./app.js";

// Replaced by zod-validated config in Phase 5.
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3001");

const app = buildApp({ logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host, port });
