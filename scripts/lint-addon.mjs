import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = join(rootDirectory, "node_modules", "web-ext", "bin", "web-ext.js");
const child = spawn(process.execPath, [
  executable,
  "lint",
  "--source-dir",
  join(rootDirectory, "build", "extension"),
  "--warnings-as-errors",
  "--no-input",
  "--no-config-discovery"
], {
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1"
  },
  stdio: "inherit"
});

child.once("error", (error) => {
  throw error;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
