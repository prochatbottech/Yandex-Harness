import { ChatMessage, ToolCall } from "@harness/model";

export interface ContextManagerOptions {
  maxTokensThreshold?: number; // default: 8000 tokens
}

export class ContextManager {
  private threshold: number;

  constructor(options?: ContextManagerOptions) {
    this.threshold = options?.maxTokensThreshold ?? 8000;
  }

  estimateTokens(messages: ChatMessage[]): number {
    let totalChars = 0;
    for (const m of messages) {
      if (m.content) totalChars += m.content.length;
      if (m.tool_calls) {
        totalChars += JSON.stringify(m.tool_calls).length;
      }
    }
    return Math.ceil(totalChars / 3.5);
  }

  shouldSummarize(messages: ChatMessage[]): boolean {
    return this.estimateTokens(messages) > this.threshold;
  }

  compact(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= 6) return messages;

    const systemMessage = messages.find((m) => m.role === "system");
    const userFirst = messages.find((m) => m.role === "user");
    const recentMessages = messages.slice(-4);

    const intermediateMessages = messages.slice(2, -4);
    const summaryText = intermediateMessages
      .map((m) => {
        if (m.role === "assistant" && m.tool_calls) {
          return `[Агент вызвал: ${m.tool_calls.map((t: ToolCall) => t.function.name).join(", ")}]`;
        }
        if (m.role === "tool") {
          return `[Результат ${m.name}: ${(m.content || "").slice(0, 100)}]`;
        }
        return `[${m.role}: ${(m.content || "").slice(0, 80)}]`;
      })
      .join(" -> ");

    const compacted: ChatMessage[] = [];
    if (systemMessage) compacted.push(systemMessage);
    if (userFirst) compacted.push(userFirst);

    compacted.push({
      role: "assistant",
      content: `[Сжатая история предыдущих шагов: ${summaryText}]`
    });

    for (const m of recentMessages) {
      if (!compacted.includes(m)) {
        compacted.push(m);
      }
    }

    return compacted;
  }
}
