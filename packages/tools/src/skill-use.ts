import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool, ToolContext, ToolResult } from "./types.js";

export function createSkillUseTool(skillsDir: string): Tool {
  return {
    name: "skill_use",
    description: "Подключение сохраненного скилла/инструкции к текущей задаче агента",
    brief: "skill_use(name: string) — загрузить скилл",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Название скилла (например: news-summary, csv-analysis)"
        }
      },
      required: ["name"]
    },
    async run(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const skillName = String(args.name || "").trim();
      const skillPath = path.join(skillsDir, skillName, "SKILL.md");

      try {
        const content = await fs.readFile(skillPath, "utf-8");
        return {
          content: `Скилл "${skillName}" успешно активирован. Инструкции:\n\n${content}`
        };
      } catch (err: unknown) {
        return {
          content: `Скилл "${skillName}" не найден по пути ${skillPath}: ${(err as Error).message}`,
          isError: true
        };
      }
    }
  };
}
