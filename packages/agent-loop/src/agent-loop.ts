import { ChatMessage, ModelClient, ToolCall } from "@harness/model";
import { PolicyEngine } from "@harness/policy";
import { ToolRegistry } from "@harness/tools";
import { ContextManager } from "@harness/memory";
import { AgentEvent, AgentRunOptions } from "./types.js";

const DEFAULT_SYSTEM_PROMPT = `Ты — агент в среде Harness Desktop. Твоя задача — довести поручение пользователя до результата, а не описывать, как его выполнить.
Правила:
1. Планируй: сначала перечисли шаги, затем выполняй по одному.
2. Промежуточные результаты сохраняй в файлы сессии (workspace), а не держи только в контексте.
3. Необратимые действия выполняй только после согласования пользователем — механизм уже встроен, не проси подтверждение словами.
4. Если информации не хватает — задай один точный вопрос, а не общие уточнения.
5. В финальном ответе: что сделано, где лежит результат (путь файла), какие допущения приняты.`;

export class AgentLoop {
  private contextManager = new ContextManager();

  constructor(
    private modelClient: ModelClient,
    private toolRegistry: ToolRegistry,
    private policyEngine: PolicyEngine
  ) {}

  async *run(userPrompt: string, options: AgentRunOptions): AsyncIterable<AgentEvent> {
    const maxSteps = options.maxSteps ?? 25;
    const mode = options.mode ?? "agent";
    const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    let messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    let step = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const toolDefs = mode === "agent" ? this.toolRegistry.toModelDefinitions() : undefined;

    while (step < maxSteps) {
      step++;

      // Check context limit and compact if necessary
      if (this.contextManager.shouldSummarize(messages)) {
        messages = this.contextManager.compact(messages);
      }

      let assistantText = "";
      const toolCalls: ToolCall[] = [];

      try {
        const stream = this.modelClient.chat({
          model: options.model || "",
          messages,
          tools: toolDefs,
          stream: true
        });

        for await (const chunk of stream) {
          if (chunk.deltaText) {
            assistantText += chunk.deltaText;
            yield { type: "text_delta", text: chunk.deltaText };
          }

          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              const existing = toolCalls.find((t) => t.id === tc.id || (t.function.name === tc.function.name && !t.id));
              if (existing) {
                existing.function.arguments += tc.function.arguments;
                if (tc.id) existing.id = tc.id;
              } else {
                toolCalls.push({
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                });
              }
            }
          }

          if (chunk.usage) {
            totalPromptTokens += chunk.usage.promptTokens;
            totalCompletionTokens += chunk.usage.completionTokens;
          }
        }
      } catch (err: unknown) {
        yield {
          type: "error",
          message: `Ошибка обращения к модели: ${(err as Error).message}`,
          fatal: true
        };
        return;
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantText || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      };
      messages.push(assistantMessage);

      if (toolCalls.length === 0) {
        yield {
          type: "done",
          usage: {
            input: totalPromptTokens,
            output: totalCompletionTokens,
            total: totalPromptTokens + totalCompletionTokens
          }
        };
        return;
      }

      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = { raw: tc.function.arguments };
        }

        yield {
          type: "tool_call",
          callId: tc.id,
          tool: toolName,
          args
        };

        const tool = this.toolRegistry.get(toolName);
        if (!tool) {
          const errMsg = `Инструмент "${toolName}" не найден в реестре.`;
          yield {
            type: "tool_result",
            callId: tc.id,
            content: errMsg,
            isError: true
          };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: toolName,
            content: errMsg
          });
          continue;
        }

        const policyCheck = this.policyEngine.check({
          toolName: tool.name,
          args,
          risk: tool.risk,
          description: tool.description
        });

        if (policyCheck.requiresApproval) {
          const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          yield {
            type: "approval_request",
            approvalId,
            action: policyCheck.action
          };

          let decision: "allow" | "deny" | "allow_always" = "allow";
          if (options.onApprovalRequest) {
            decision = await options.onApprovalRequest(policyCheck.action);
          }

          yield {
            type: "approval_result",
            approvalId,
            outcome: decision
          };

          if (decision === "deny") {
            const deniedMsg = `Действие отклонено пользователем.`;
            yield {
              type: "tool_result",
              callId: tc.id,
              content: deniedMsg,
              isError: true
            };
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: toolName,
              content: deniedMsg
            });
            continue;
          }

          if (decision === "allow_always") {
            this.policyEngine.recordDecision(tool.name, tool.name, "allow_always");
          }
        }

        try {
          const result = await tool.run(args, {
            workspaceDir: options.workspaceDir,
            sessionId: options.sessionId
          });

          yield {
            type: "tool_result",
            callId: tc.id,
            content: result.content,
            isError: result.isError,
            truncated: result.truncated
          };

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: toolName,
            content: result.content
          });
        } catch (err: unknown) {
          const errorMsg = `Исключение при выполнении инструмента: ${(err as Error).message}`;
          yield {
            type: "tool_result",
            callId: tc.id,
            content: errorMsg,
            isError: true
          };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: toolName,
            content: errorMsg
          });
        }
      }
    }

    yield {
      type: "error",
      message: `Превышен лимит шагов агента (${maxSteps}).`,
      fatal: false
    };
    yield {
      type: "done",
      usage: {
        input: totalPromptTokens,
        output: totalCompletionTokens,
        total: totalPromptTokens + totalCompletionTokens
      }
    };
  }
}
