import { RiskLevel } from "@harness/policy";

export interface ToolContext {
  workspaceDir: string;
  sessionId: string;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  truncated?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  brief: string;
  instructions?: string;
  risk: RiskLevel;
  schema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
