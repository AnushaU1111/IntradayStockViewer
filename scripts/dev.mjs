// Runs the API and the Vite dev server together, with prefixed output.
// Cross-platform on purpose: no shell syntax, no extra dependency.
import { spawn } from "node:child_process";

const tasks = [
  { name: "api", color: 33, args: ["run", "dev", "-w", "@isv/backend"] },
  { name: "web", color: 36, args: ["run", "dev", "-w", "@isv/frontend"] },
];

const children = tasks.map(({ name, color, args }) => {
  const child = spawn("npm", args, {
    shell: process.platform === "win32",
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
    process.exitCode = code ?? 1;
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
