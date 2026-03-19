import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface PackageJsonShape {
  version?: string;
}

const FALLBACK_VERSION = "0.0.0";

function loadPackageVersion(): string {
  try {
    const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const raw = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as PackageJsonShape;
    return parsed.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const PACKAGE_VERSION = loadPackageVersion();
