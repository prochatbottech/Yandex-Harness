import { ActionDescriptor, ApprovalDecision } from "@harness/policy";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; callId: string; content: string; truncated?: boolean; isError?: boolean }
  | { type: "approval_request"; approvalId: string; action: ActionDescriptor }
  | { type: "approval_result"; approvalId: string; outcome: ApprovalDecision }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "done"; usage?: { input: number; output: number; total: number; cost?: number } };

export interface AgentRunOptions {
  model?: string;
  maxSteps?: number;
  workspaceDir: string;
  sessionId: string;
  systemPrompt?: string;
  mode?: "agent" | "chat";
  onApprovalRequest?: (action: ActionDescriptor) => Promise<ApprovalDecision>;
}
