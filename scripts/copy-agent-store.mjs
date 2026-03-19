import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const copies = [
  {
    sourceDir: fileURLToPath(new URL("../src/orchestrator/agent-store", import.meta.url)),
    targetDir: fileURLToPath(new URL("../dist/agent-store", import.meta.url)),
  },
  {
    sourceDir: fileURLToPath(new URL("../src/skills/built-in", import.meta.url)),
    targetDir: fileURLToPath(new URL("../dist/skills/built-in", import.meta.url)),
  },
];

for (const { sourceDir, targetDir } of copies) {
  if (!existsSync(sourceDir)) {
    continue;
  }

  rmSync(targetDir, { force: true, recursive: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
  removeJunkFiles(targetDir);
}

function removeJunkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      removeJunkFiles(entryPath);
      continue;
    }
    if (entry === ".DS_Store" || entry === "Thumbs.db") {
      rmSync(entryPath, { force: true });
    }
  }
}
