import { buildApp } from "./app.js";
import { ConfigError, loadConfig, type AppConfig } from "./config/env.js";

const DRAIN_TIMEOUT_MS = 10_000;

function configOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const config = configOrExit();
const app = await buildApp({ config });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");
  setTimeout(() => {
    app.log.error("in-flight requests did not drain in time; exiting");
    process.exit(1);
  }, DRAIN_TIMEOUT_MS).unref();
  await app.close();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
