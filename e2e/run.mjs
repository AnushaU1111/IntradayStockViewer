// Runs the real-stack e2e suite once per clock scenario, strictly in sequence
// (spec 8, R4-#1). Each run gets fresh servers from Playwright; this script
// makes sure the ports are free before each run and free again after it, so a
// leftover server can never answer for the wrong clock.
//
// Usage: npm run test:e2e [-- <extra playwright args>]
import { spawn } from "node:child_process";
import net from "node:net";

const SCENARIOS = ["after-close", "in-session"];
const PORTS = [4010, 3001, 4173];
const extraArgs = process.argv.slice(2);

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

async function busyPorts() {
  const busy = [];
  for (const port of PORTS) if (!(await portIsFree(port))) busy.push(port);
  return busy;
}

async function waitForFreePorts(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let busy = await busyPorts();
  while (busy.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    busy = await busyPorts();
  }
  return busy;
}

// Windows needs a shell to find npx.cmd. Node deprecates passing an argument
// list together with `shell: true` (DEP0190), so there the command is one
// string, with any extra argument quoted.
const quote = (arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`);

function runPlaywright(scenario) {
  const args = ["playwright", "test", "-c", "e2e/playwright.config.ts", ...extraArgs];
  const options = { stdio: "inherit", env: { ...process.env, E2E_SCENARIO: scenario } };
  return new Promise((resolve) => {
    const child =
      process.platform === "win32"
        ? spawn(["npx", ...args].map(quote).join(" "), { ...options, shell: true })
        : spawn("npx", args, options);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let failed = false;
for (const scenario of SCENARIOS) {
  const busy = await busyPorts();
  if (busy.length > 0) {
    console.error(
      `\ne2e: port ${busy.join(", ")} is already in use. Stop whatever is listening there ` +
        "(npm run dev, an earlier run) and try again; e2e must start its own servers.",
    );
    process.exit(1);
  }

  console.log(`\n=== e2e scenario: ${scenario} ===\n`);
  const code = await runPlaywright(scenario);
  if (code !== 0) failed = true;

  const left = await waitForFreePorts(15_000);
  if (left.length > 0) {
    console.error(`\ne2e: port ${left.join(", ")} still in use after the ${scenario} run.`);
    process.exit(1);
  }
}

process.exit(failed ? 1 : 0);
