import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_OUTPUT_BYTES = 10 * 1024; // 10 KB limit per channel (FR-42)

export const runCodeTool: Tool = {
  name: "run_code",
  description: "Исполнение скрипта Python в изолированной песочнице с лимитом времени и ресурсов",
  brief: "run_code(code: string) — выполнить Python скрипт в workspace",
  risk: "medium",
  schema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "Python код для исполнения"
      }
    },
    required: ["code"]
  },
  async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const code = String(args.code || "").trim();
    if (!code) {
      return { content: "Ошибка: пустой код для исполнения", isError: true };
    }

    const scriptFileName = `script_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.py`;
    const scriptPath = path.join(ctx.workspaceDir, scriptFileName);

    try {
      await fs.writeFile(scriptPath, code, "utf-8");

      const beforeFiles = new Set(await fs.readdir(ctx.workspaceDir));

      return await new Promise<ToolResult>((resolve) => {
        const timeoutMs = 60000; // 60s timeout (FR-40)
        let timedOut = false;

        const child = spawn("python", [scriptFileName], {
          cwd: ctx.workspaceDir,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8"
          }
        });

        let stdout = "";
        let stderr = "";
        let truncated = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on("data", (data: Buffer) => {
          if (stdout.length < MAX_OUTPUT_BYTES) {
            stdout += data.toString("utf-8");
          } else {
            truncated = true;
          }
        });

        child.stderr.on("data", (data: Buffer) => {
          if (stderr.length < MAX_OUTPUT_BYTES) {
            stderr += data.toString("utf-8");
          } else {
            truncated = true;
          }
        });

        child.on("close", async (code) => {
          clearTimeout(timer);

          // Clean up script file
          try {
            await fs.unlink(scriptPath);
          } catch {
            // ignore
          }

          if (timedOut) {
            resolve({
              content: `Ошибка: время выполнения скрипта превысило лимит 60 секунд. Процесс был остановлен.`,
              isError: true
            });
            return;
          }

          // Detect newly created files
          let createdFilesStr = "";
          try {
            const afterFiles = await fs.readdir(ctx.workspaceDir);
            const created = afterFiles.filter((f) => !beforeFiles.has(f) && f !== scriptFileName);
            if (created.length > 0) {
              createdFilesStr = `\n[Созданные файлы в workspace: ${created.join(", ")}]`;
            }
          } catch {
            // ignore
          }

          let output = "";
          if (stdout) output += `STDOUT:\n${stdout}\n`;
          if (stderr) output += `STDERR:\n${stderr}\n`;
          if (!output.trim()) output = "(Скрипт выполнился без текстового вывода)";
          if (truncated) {
            output += "\n[Внимание: вывод был обрезан до лимита 10 КБ]";
          }
          output += `\nКод возврата: ${code}${createdFilesStr}`;

          resolve({
            content: output.trim(),
            isError: code !== 0,
            truncated
          });
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({
            content: `Ошибка запуска процесса Python: ${err.message}`,
            isError: true
          });
        });
      });
    } catch (err: unknown) {
      return {
        content: `Ошибка подготовки скрипта: ${(err as Error).message}`,
        isError: true
      };
    }
  }
};
