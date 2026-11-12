export interface McpServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  description?: string;
  access?: "read_only" | "full";
}

export interface McpConnectionStatus {
  name: string;
  connected: boolean;
  toolsCount: number;
  error?: string;
}
