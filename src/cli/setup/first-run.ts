import { existsSync } from "node:fs";

import pc from "picocolors";

import { CLI_PROVIDER_ORDER, getCliProviderEntry, type LoginProvider } from "../../orchestrator/utils/provider-catalog.js";
import { detectInstalledProviders } from "../../orchestrator/utils/detect-providers.js";
import { DEFAULT_AEMEATH_CONFIG } from "../../config/defaults.js";
import { loadGlobalConfigFile, saveGlobalConfig } from "../../config/persist.js";
import type { AemeathConfig } from "../../config/schema.js";
import { getConfigPath } from "../../utils/pathResolver.js";
import { PACKAGE_VERSION } from "../../version.js";
import { loginProvider, type LoginProvider as RuntimeLoginProvider } from "../auth-runtime.js";

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
  readonly config: AemeathConfig;
}

export function hasGlobalConfig(): boolean {
  return existsSync(getConfigPath());
}

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export function createInitialConfig(): AemeathConfig {
  return {
    ...DEFAULT_AEMEATH_CONFIG,
    version: PACKAGE_VERSION,
  };
}

export function ensureDefaultConfig(): FirstRunSetupResult {
  const configPath = getConfigPath();
  if (hasGlobalConfig()) {
    return {
      configPath,
      created: false,
      config: loadGlobalConfigFile(),
    };
  }

  const config = createInitialConfig();
  saveGlobalConfig(config);
  return {
    configPath,
    created: true,
    config,
  };
}

function createFirstRunLogin(provider: LoginProvider): IFirstRunLogin {
  const runtimeProvider = provider as RuntimeLoginProvider;
  return {
    login: () => loginProvider(runtimeProvider),
  };
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
    return {
      configPath,
      created: false,
      config: loadGlobalConfigFile(),
    };
  }

  const config = createInitialConfig();
  const detectedProviders = detectInstalledProviders();

  if (options.defaults || !isInteractiveTerminal()) {
    saveGlobalConfig(config);
    const modeLabel = options.defaults ? "defaults" : "non-interactive defaults";
    process.stdout.write(`${pc.green("✓")} Saved ${modeLabel} to ${pc.cyan(configPath)}\n`);
    if (detectedProviders.length > 0) {
      process.stdout.write(`Detected providers: ${detectedProviders.join(", ")}\n`);
    }
    return {
      configPath,
      created: true,
      config,
    };
  }

  const { checkbox, confirm } = await import("@inquirer/prompts");

  writeWelcomeBanner();

  const detectedLines = CLI_PROVIDER_ORDER.map((provider) => {
    const entry = getCliProviderEntry(provider);
    const installed = detectedProviders.includes(provider);
    return `  ${installed ? pc.green("✓") : pc.dim("○")} ${entry.label} — ${installed ? "installed" : "not detected"}`;
  });
  process.stdout.write(`${detectedLines.join("\n")}\n\n`);

  const loginChoices = CLI_PROVIDER_ORDER
    .map((provider) => {
      const entry = getCliProviderEntry(provider);
      if (entry.loginProvider === undefined) {
        return undefined;
      }
      return {
        name: `${entry.label}${detectedProviders.includes(provider) ? "" : " (not detected, login only)"}`,
        value: entry.loginProvider,
        checked: detectedProviders.includes(provider) && provider !== "kimi-cli",
      };
    })
    .filter((choice): choice is { name: string; value: LoginProvider; checked: boolean } => choice !== undefined);

  const selectedLoginProviders = await checkbox<LoginProvider>({
    message: "Which providers should be authenticated during setup?",
    choices: loginChoices,
  });

  for (const provider of selectedLoginProviders) {
    process.stdout.write(pc.cyan(`  Logging in to ${provider}...\n`));
    try {
      const login = createFirstRunLogin(provider);
      await login.login();
      process.stdout.write(pc.green(`  ✓ ${provider} — Logged in successfully\n`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(pc.yellow(`  ○ ${provider} — skipped (${message})\n`));
    }
  }

  const save = await confirm({
    message: `Write configuration to ${configPath}?`,
    default: true,
  });

  if (save) {
    saveGlobalConfig(config);
    process.stdout.write(`${pc.green("✓")} Saved configuration to ${pc.cyan(configPath)}\n`);
  }

  return {
    configPath,
    created: save,
    config,
  };
}
