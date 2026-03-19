import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourceDir = fileURLToPath(new URL("../src/orchestrator/agent-store", import.meta.url));
const targetDir = fileURLToPath(new URL("../dist/agent-store", import.meta.url));

if (!existsSync(sourceDir)) {
  process.exit(0);
}

rmSync(targetDir, { force: true, recursive: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
