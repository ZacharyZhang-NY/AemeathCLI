import { existsSync } from "node:fs";

import pc from "picocolors";

import { ConfigStore } from "../../storage/config-store.js";
import { DEFAULT_CONFIG, type IGlobalConfig } from "../../types/config.js";
import { getConfigPath } from "../../utils/pathResolver.js";
import { PACKAGE_VERSION } from "../../version.js";

type FirstRunProvider = "claude" | "codex" | "gemini" | "kimi";

interface IFirstRunLogin {
  login(): Promise<unknown>;
}

export interface FirstRunSetupOptions {
  readonly defaults?: boolean;
  readonly force?: boolean;
}

export interface FirstRunSetupResult {
  readonly configPath: string;
  readonly created: boolean;
  readonly config: IGlobalConfig;
}

const FIRST_RUN_PROVIDERS: readonly FirstRunProvider[] = [
  "claude",
  "codex",
  "gemini",
  "kimi",
] as const;

export function hasGlobalConfig(): boolean {
  return existsSync(getConfigPath());
}

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export function createInitialConfig(): IGlobalConfig {
  return {
    ...DEFAULT_CONFIG,
    version: PACKAGE_VERSION,
  };
}

export function ensureDefaultConfig(): FirstRunSetupResult {
  const store = new ConfigStore();
  const configPath = getConfigPath();

  if (hasGlobalConfig()) {
    return {
      configPath,
      created: false,
      config: store.loadGlobal(),
    };
  }

  const config = createInitialConfig();
  store.saveGlobal(config);

  return {
    configPath,
    created: true,
    config,
  };
}

async function createFirstRunLogin(provider: FirstRunProvider): Promise<IFirstRunLogin> {
  switch (provider) {
    case "claude": {
      const { ClaudeLogin } = await import("../../auth/providers/claude-login.js");
      return new ClaudeLogin();
    }
    case "codex": {
      const { CodexLogin } = await import("../../auth/providers/codex-login.js");
      return new CodexLogin();
    }
    case "gemini": {
      const { GeminiLogin } = await import("../../auth/providers/gemini-login.js");
      return new GeminiLogin();
    }
    case "kimi": {
      const { KimiLogin } = await import("../../auth/providers/kimi-login.js");
      return new KimiLogin();
    }
  }
}

function writeWelcomeBanner(): void {
  process.stdout.write(
    [
      "",
      pc.cyan("  ╔══════════════════════════════════════════════╗"),
      pc.cyan("  ║           Welcome to AemeathCLI              ║"),
      pc.cyan(`  ║    Multi-Model CLI Coding Tool v${PACKAGE_VERSION.padEnd(10)}    ║`),
      pc.cyan("  ╚══════════════════════════════════════════════╝"),
      "",
      "  Let's get you set up:",
      "",
    ].join("\n"),
  );
}

export async function runFirstRunSetup(
  options: FirstRunSetupOptions = {},
): Promise<FirstRunSetupResult> {
  const configPath = getConfigPath();
  if (hasGlobalConfig() && !options.force) {
    const store = new ConfigStore();
    return {
      configPath,
      created: false,
      config: store.loadGlobal(),
    };
  }

  const store = new ConfigStore();
  const config = createInitialConfig();

  if (options.defaults || !isInteractiveTerminal()) {
    store.saveGlobal(config);

    const modeLabel = options.defaults ? "defaults" : "non-interactive defaults";
    process.stdout.write(
      `${pc.green("✓")} Saved ${modeLabel} to ${pc.cyan(configPath)}\n`,
    );

    return {
      configPath,
      created: true,
      config,
    };
  }

  const { confirm } = await import("@inquirer/prompts");

  writeWelcomeBanner();

  for (const provider of FIRST_RUN_PROVIDERS) {
    const shouldLogin = await confirm({
      message: `Log in to ${provider}?`,
      default: provider !== "kimi",
    });

    if (!shouldLogin) {
      continue;
    }

    process.stdout.write(pc.cyan(`  Logging in to ${provider}...\n`));
    try {
      const login = await createFirstRunLogin(provider);
      await login.login();
      process.stdout.write(pc.green(`  ✓ ${provider} — Logged in successfully\n`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(pc.yellow(`  ! ${provider} — Login skipped: ${message}\n`));
    }
  }

  store.saveGlobal(config);

  process.stdout.write(
    [
      "",
      `  ${pc.green("✓")} Configuration saved to ${pc.cyan(configPath)}`,
      "",
      "  Ready. Start with `aemeathcli` for chat.",
      "  For `aemeathcli launch`, make sure the supervisor provider also has an API key configured via `auth set-key` or environment variables.",
      "",
    ].join("\n"),
  );

  return {
    configPath,
    created: true,
    config,
  };
}
