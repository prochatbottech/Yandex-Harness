import { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_FETCH_BYTES = 25 * 1024; // 25 KB limit

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Загрузка веб-страницы или текстового ресурса по URL с извлечением текстового содержимого",
  brief: "web_fetch(url: string) — загрузить страницу по URL",
  risk: "low",
  schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL страницы (например: https://example.com)"
      }
    },
    required: ["url"]
  },
  async run(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const rawUrl = String(args.url || "").trim();
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      return { content: "Ошибка: URL должен начинаться с http:// или https://", isError: true };
    }

    try {
      const response = await fetch(rawUrl, {
        headers: {
          "User-Agent": "HarnessDesktopAgent/1.0 (+https://github.com/prochatbottech/harness-desktop)"
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        return {
          content: `Ошибка загрузки URL (${response.status}): ${response.statusText}`,
          isError: true
        };
      }

      const html = await response.text();
      // Simple and robust text extractor from HTML
      const cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (cleaned.length > MAX_FETCH_BYTES) {
        return {
          content: cleaned.slice(0, MAX_FETCH_BYTES) + "\n\n...[Контент обрезан по лимиту 25 КБ]...",
          truncated: true
        };
      }

      return { content: cleaned || "(Страница не содержит читаемого текста)" };
    } catch (err: unknown) {
      return {
        content: `Ошибка запроса к ${rawUrl}: ${(err as Error).message}`,
        isError: true
      };
    }
  }
};
