export interface IMCPServerConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export interface IMCPConfig {
  readonly mcpServers: Readonly<Record<string, IMCPServerConfig>>;
}
