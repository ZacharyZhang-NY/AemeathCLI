import { existsSync } from "node:fs";

import pc from "picocolors";

import type { CliProviderType } from "../../orchestrator/constants.js";
import { CLI_PROVIDER_ORDER, getCliProviderEntry, type LoginProvider } from "../../orchestrator/utils/provider-catalog.js";
import { detectInstalledProviders } from "../../orchestrator/utils/detect-providers.js";
import { ConfigStore } from "../../storage/config-store.js";
import { DEFAULT_CONFIG, type IGlobalConfig } from "../../types/config.js";
import { getConfigPath } from "../../utils/pathResolver.js";
import { PACKAGE_VERSION } from "../../version.js";

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

async function createFirstRunLogin(provider: LoginProvider): Promise<IFirstRunLogin> {
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
  const detectedProviders = detectInstalledProviders();

  if (options.defaults || !isInteractiveTerminal()) {
    const defaultPrimaryMasterProvider = detectedProviders[0];
    const configWithDefaults: IGlobalConfig = {
      ...config,
      swarm: {
        onboardingComplete: true,
        detectedProviders,
        primaryMasterProvider: defaultPrimaryMasterProvider,
        fallbackMasterProviders: detectedProviders.slice(1),
      },
    };
    store.saveGlobal(configWithDefaults);

    const modeLabel = options.defaults ? "defaults" : "non-interactive defaults";
    process.stdout.write(
      `${pc.green("✓")} Saved ${modeLabel} to ${pc.cyan(configPath)}\n`,
    );

    return {
      configPath,
      created: true,
      config: configWithDefaults,
    };
  }

  const { checkbox, confirm, select } = await import("@inquirer/prompts");

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

      const installed = detectedProviders.includes(provider);
      return {
        name: `${entry.label}${installed ? "" : " (not detected, login only)"}`,
        value: entry.loginProvider,
        checked: installed && provider !== "kimi-cli",
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
      const login = await createFirstRunLogin(provider);
      await login.login();
      process.stdout.write(pc.green(`  ✓ ${provider} — Logged in successfully\n`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(pc.yellow(`  ! ${provider} — Login skipped: ${message}\n`));
    }
  }

  if (detectedProviders.includes("ollama")) {
    process.stdout.write(pc.green("  ✓ ollama — Local agent runtime detected\n"));
  }

  let primaryMasterProvider: CliProviderType | undefined;
  let fallbackMasterProviders: CliProviderType[] = [];

  if (detectedProviders.length > 0) {
    primaryMasterProvider = await select<CliProviderType>({
      message: "Choose the primary master agent provider for swarm orchestration:",
      choices: detectedProviders.map((provider) => ({
        name: `${getCliProviderEntry(provider).label} — ${getCliProviderEntry(provider).description}`,
        value: provider,
      })),
    });

    const remainingProviders = detectedProviders.filter(
      (provider) => provider !== primaryMasterProvider,
    );

    if (remainingProviders.length > 0) {
      fallbackMasterProviders = await checkbox<CliProviderType>({
        message: "Select optional fallback master-agent providers:",
        choices: remainingProviders.map((provider) => ({
          name: `${getCliProviderEntry(provider).label} — ${getCliProviderEntry(provider).description}`,
          value: provider,
        })),
      });
    }
  } else {
    process.stdout.write(
      `${pc.yellow("  !")} No supported native agent CLIs were detected. You can still use direct chat, but swarm orchestration will stay limited until one is installed.\n`,
    );
  }

  const keepRoleDefaults = await confirm({
    message: "Keep the recommended role-routing defaults?",
    default: true,
  });

  const configuredProviders: IGlobalConfig["providers"] = {
    ...config.providers,
  };
  for (const provider of detectedProviders) {
    const entry = getCliProviderEntry(provider);
    configuredProviders[entry.provider] = {
      ...configuredProviders[entry.provider],
      enabled: true,
    };
  }

  const finalConfig: IGlobalConfig = {
    ...config,
    roles: keepRoleDefaults ? DEFAULT_CONFIG.roles : config.roles,
    providers: configuredProviders,
    swarm: {
      onboardingComplete: true,
      detectedProviders,
      primaryMasterProvider,
      fallbackMasterProviders,
    },
  };

  store.saveGlobal(finalConfig);

  process.stdout.write(
    [
      "",
      `  ${pc.green("✓")} Configuration saved to ${pc.cyan(configPath)}`,
      "",
      `  Swarm primary: ${primaryMasterProvider ? getCliProviderEntry(primaryMasterProvider).label : "not set"}`,
      `  Swarm fallbacks: ${fallbackMasterProviders.length > 0 ? fallbackMasterProviders.map(getCliProviderEntry).map((entry) => entry.label).join(", ") : "none"}`,
      "",
      "  Ready. Start with `aemeathcli` or `ac`.",
      "  Use Shift+Tab inside the TUI to switch between swarm, guided edits, and direct chat.",
      "",
    ].join("\n"),
  );

  return {
    configPath,
    created: true,
    config: finalConfig,
  };
}
