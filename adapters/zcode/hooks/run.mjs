import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const result = spawnSync(process.execPath, [cli, "hook"], {
  stdio: ["inherit", "inherit", "pipe"],
  windowsHide: true,
});
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
