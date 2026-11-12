export type RiskLevel = "low" | "medium" | "high";

export type ApprovalDecision = "allow" | "deny" | "allow_always";

export interface ActionDescriptor {
  toolName: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  description: string;
}

export interface PolicyCheckResult {
  requiresApproval: boolean;
  reason?: string;
  action: ActionDescriptor;
}

export interface PolicyConfig {
  fileWriteOutsideWorkspace: "allow" | "ask" | "deny";
  fileDelete: "allow" | "ask" | "always_ask" | "deny";
  codeExecution: "allow" | "ask" | "deny";
  defaultMaxSteps: number;
}

export interface PolicyEngine {
  check(action: ActionDescriptor): PolicyCheckResult;
  recordDecision(toolName: string, pattern: string, decision: ApprovalDecision): void;
  resetSession(): void;
}
