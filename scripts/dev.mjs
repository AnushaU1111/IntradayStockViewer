// Runs the API and the Vite dev server together, with prefixed output.
// Cross-platform on purpose: no shell syntax, no extra dependency.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

const tasks = [
  { name: "api", color: 33, args: ["run", "dev", "-w", "@isv/backend"] },
  { name: "web", color: 36, args: ["run", "dev", "-w", "@isv/frontend"] },
];

const children = tasks.map(({ name, color, args }) => {
  // On POSIX each task gets its own process group, so stopping it also stops
  // the vite and tsx processes that npm starts underneath.
  const child = spawn("npm", args, {
    shell: isWindows,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffered = "";
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited with code ${code ?? "null"}\n`);
    stopAll();
    process.exitCode = code ?? 0;
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (isWindows) {
      // Ctrl+C already reaches every process in the console; this covers one
      // task exiting on its own while the other keeps running.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
