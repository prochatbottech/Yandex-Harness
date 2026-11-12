import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_FETCH_BYTES = 25 * 1024; // 25 KB limit

/**
 * Выполняет HTTP(S)-запрос с принудительным IPv4 (family: 4).
 * Это необходимо на Windows, где Node.js может выбирать IPv6 и
 * получать ETIMEDOUT на хостах с двойным стеком (Yandex Cloud и др.).
 */
function fetchWithIPv4(rawUrl: string): Promise<{ status: number; statusText: string; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      family: 4, // Принудительно IPv4
      headers: {
        "User-Agent": "HarnessDesktopAgent/1.0 (+https://github.com/prochatbottech/Yandex-Harness)"
      },
      timeout: 15000
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          text: () => Promise.resolve(body)
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Таймаут запроса к ${rawUrl}`));
    });

    req.on("error", reject);
    req.end();
  });
}

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
      const response = await fetchWithIPv4(rawUrl);

      if (response.status < 200 || response.status >= 300) {
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
