import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool, ToolContext, ToolResult } from "./types.js";

function resolveSafePath(filePath: string, workspaceDir: string): string {
  // If the path starts with workspace/ or ./workspace/ strip it to avoid workspace/workspace
  let normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("workspace/")) {
    normalized = normalized.slice("workspace/".length);
  } else if (normalized.startsWith("./workspace/")) {
    normalized = normalized.slice("./workspace/".length);
  }
  
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.resolve(workspaceDir, normalized);
}

export const fsReadTool: Tool = {
  name: "fs_read",
  description: "Чтение содержимого файла на диске (текст, CSV, код, markdown)",
  brief: "fs_read(path: string) — чтение файла",
  risk: "low",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Путь к файлу (абсолютный или относительно workspace)"
      }
    },
    required: ["path"]
  },
  async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const rawPath = String(args.path);
    const targetPath = resolveSafePath(rawPath, ctx.workspaceDir);
    try {
      const content = await fs.readFile(targetPath, "utf-8");
      // Truncate to 30KB if file is too large
      if (content.length > 30000) {
        return {
          content: content.slice(0, 30000) + "\n\n...[Файл обрезан из-за превышения лимита]...",
          truncated: true
        };
      }
      return { content };
    } catch (err: unknown) {
      return {
        content: `Ошибка чтения файла: ${(err as Error).message}`,
        isError: true
      };
    }
  }
};

export const fsWriteTool: Tool = {
  name: "fs_write",
  description: "Запись или обновление файла в пределах рабочей директории",
  brief: "fs_write(path: string, content: string) — запись файла",
  risk: "medium",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Путь к файлу"
      },
      content: {
        type: "string",
        description: "Содержимое файла для записи"
      }
    },
    required: ["path", "content"]
  },
  async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const rawPath = String(args.path);
    const targetPath = resolveSafePath(rawPath, ctx.workspaceDir);
    const content = String(args.content);

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf-8");
      return { content: `Файл успешно записан: ${targetPath}` };
    } catch (err: unknown) {
      return {
        content: `Ошибка записи файла: ${(err as Error).message}`,
        isError: true
      };
    }
  }
};

export const calculatorTool: Tool = {
  name: "calculator",
  description: "Точный математический калькулятор выражений",
  brief: "calculator(expression: string) — вычисление математического выражения",
  risk: "low",
  schema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "Математическое выражение, например: '12 * 4.5 + 100'"
      }
    },
    required: ["expression"]
  },
  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const expr = String(args.expression).trim();
    // Safe expression evaluator
    if (!/^[0-9+\-*/().\s%^]+$/.test(expr)) {
      return {
        content: "Ошибка: выражение содержит недопустимые символы. Разрешены только числа и операторы +, -, *, /, %, ^, ()",
        isError: true
      };
    }
    try {
      const sanitized = expr.replace(/\^/g, "**");
      const result = Function(`"use strict"; return (${sanitized});`)();
      return { content: String(result) };
    } catch (err: unknown) {
      return {
        content: `Ошибка вычисления: ${(err as Error).message}`,
        isError: true
      };
    }
  }
};
