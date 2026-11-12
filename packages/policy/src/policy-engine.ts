import {
  ActionDescriptor,
  ApprovalDecision,
  PolicyCheckResult,
  PolicyConfig,
  PolicyEngine
} from "./types.js";

export class DefaultPolicyEngine implements PolicyEngine {
  public config: PolicyConfig;
  private allowedPatterns: Set<string> = new Set();

  constructor(config?: Partial<PolicyConfig>) {
    this.config = {
      fileWriteOutsideWorkspace: config?.fileWriteOutsideWorkspace ?? "ask",
      fileDelete: config?.fileDelete ?? "always_ask",
      codeExecution: config?.codeExecution ?? "ask",
      defaultMaxSteps: config?.defaultMaxSteps ?? 25
    };
  }

  check(action: ActionDescriptor): PolicyCheckResult {
    const patternKey = `${action.toolName}`;
    if (this.allowedPatterns.has(patternKey)) {
      return { requiresApproval: false, action };
    }

    if (action.risk === "high") {
      return {
        requiresApproval: true,
        reason: "Действие высокого риска (удаление или необратимая операция)",
        action
      };
    }

    if (action.risk === "medium") {
      return {
        requiresApproval: true,
        reason: "Действие требует подтверждения (изменение файлов или запуск кода)",
        action
      };
    }

    return { requiresApproval: false, action };
  }

  recordDecision(toolName: string, pattern: string, decision: ApprovalDecision): void {
    if (decision === "allow_always") {
      this.allowedPatterns.add(pattern || toolName);
    }
  }

  resetSession(): void {
    this.allowedPatterns.clear();
  }
}
