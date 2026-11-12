import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import {
  ChatChunk,
  ChatRequest,
  ModelClient,
  ToolCall,
  UsageInfo
} from "./types.js";

export interface OpenAiClientConfig {
  baseUrl: string;
  apiKey?: string;
  folderId?: string;
  defaultModel?: string;
}

export class OpenAiCompatibleClient implements ModelClient {
  private baseUrl: string;
  private apiKey?: string;
  private folderId?: string;
  private defaultModel?: string;

  constructor(config: OpenAiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.folderId = config.folderId;
    this.defaultModel = config.defaultModel;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const url = new URL(`${this.baseUrl}/chat/completions`);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    };

    if (this.apiKey) {
      // Yandex AI Studio OpenAI-compatible endpoint accepts Api-Key or Bearer
      const authHeader = this.apiKey.startsWith("AQVN")
        ? `Api-Key ${this.apiKey}`
        : `Bearer ${this.apiKey}`;
      headers["Authorization"] = authHeader;
    }

    if (this.folderId) {
      headers["x-folder-id"] = this.folderId;
    }

    const payload = {
      model: request.model || this.defaultModel,
      messages: request.messages,
      tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
      stream: true,
      temperature: request.temperature,
      tool_choice: request.toolChoice ?? (request.tools && request.tools.length > 0 ? "auto" : undefined)
    };

    const postData = JSON.stringify(payload);

    // Exponential backoff retry loop for 429 errors (max 3 retries)
    let attempt = 0;
    const maxRetries = 3;

    while (true) {
      try {
        const streamChunks = await this.performStreamRequest(
          transport,
          url,
          headers,
          postData
        );
        for await (const chunk of streamChunks) {
          yield chunk;
        }
        return;
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        if (error.statusCode === 429 && attempt < maxRetries) {
          attempt++;
          const delayMs = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
  }

  private performStreamRequest(
    transport: typeof https | typeof http,
    url: URL,
    headers: Record<string, string>,
    postData: string
  ): Promise<AsyncIterable<ChatChunk>> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers,
        family: 4 // IPv4 preference to avoid IPv6 issues in node undici/fetch
      };

      const req = transport.request(options, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errorBody = "";
          res.on("data", (chunk) => {
            errorBody += chunk.toString();
          });
          res.on("end", () => {
            const error = new Error(
              `Model API error (${res.statusCode}): ${errorBody || res.statusMessage}`
            );
            (error as unknown as { statusCode: number }).statusCode = res.statusCode || 500;
            reject(error);
          });
          return;
        }

        resolve(this.parseSseStream(res));
      });

      req.on("error", (err) => reject(err));
      req.write(postData);
      req.end();
    });
  }

  private async *parseSseStream(res: http.IncomingMessage): AsyncIterable<ChatChunk> {
    let buffer = "";

    for await (const chunk of res) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            return;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            const toolCalls: ToolCall[] | undefined = delta?.tool_calls?.map(
              (tc: { id?: string; function?: { name?: string; arguments?: string } }) => ({
                id: tc.id || "",
                type: "function" as const,
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || ""
                }
              })
            );

            let usage: UsageInfo | undefined;
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0
              };
            }

            yield {
              id: parsed.id || "",
              deltaText: delta?.content || undefined,
              toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
              finishReason: choice?.finish_reason || null,
              usage
            };
          } catch {
            // Ignore malformed json chunks in SSE stream
          }
        }
      }
    }
  }
}
