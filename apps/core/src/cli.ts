import * as readline from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as dotenv from "dotenv";
import { AgentLoop } from "@harness/agent-loop";
import { OpenAiCompatibleClient } from "@harness/model";
import { DefaultPolicyEngine, ActionDescriptor, ApprovalDecision } from "@harness/policy";
import { ToolRegistry, fsReadTool, fsWriteTool, calculatorTool } from "@harness/tools";
import { MemoryManager } from "@harness/memory";

const API_KEY = process.env.YANDEX_API_KEY || "";
const FOLDER_ID = process.env.YANDEX_FOLDER_ID || "";
const DEFAULT_MODEL = process.env.YANDEX_MODEL || "gpt://b1g2846d6bp9q0pe8pjv/yandexgpt/latest";

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

async function askUserApproval(action: ActionDescriptor): Promise<ApprovalDecision> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log("\n⚠️  [ТРЕБУЕТСЯ СОГЛАСОВАНИЕ]");
    console.log(`Инструмент: ${action.toolName} (Риск: ${action.risk.toUpperCase()})`);
    console.log(`Параметры:  ${JSON.stringify(action.args, null, 2)}`);

    rl.question("Разрешить действие? [y/N/always]: ", (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "y" || trimmed === "yes" || trimmed === "д") {
        resolve("allow");
      } else if (trimmed === "always" || trimmed === "a") {
        resolve("allow_always");
      } else {
        resolve("deny");
      }
    });
  });
}

export async function main() {
  dotenv.config();
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });

  const modelClient = new OpenAiCompatibleClient({
    baseUrl: "https://ai.api.cloud.yandex.net/v1",
    apiKey: API_KEY,
    folderId: FOLDER_ID,
    defaultModel: DEFAULT_MODEL
  });

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(fsReadTool);
  toolRegistry.register(fsWriteTool);
  toolRegistry.register(calculatorTool);

  const policyEngine = new DefaultPolicyEngine();
  const memoryManager = new MemoryManager(WORKSPACE_DIR);
  await memoryManager.init();

  const agent = new AgentLoop(modelClient, toolRegistry, policyEngine);

  const args = process.argv.slice(2);
  const promptArg = args.join(" ").trim();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askPrompt = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  console.log("==================================================");
  console.log("   Harness Desktop — CLI Режим ядра агента        ");
  console.log(`   Модель: YandexGPT (${DEFAULT_MODEL})`);
  console.log(`   Workspace: ${WORKSPACE_DIR}`);
  console.log("==================================================\n");

  let prompt = promptArg;
  if (!prompt) {
    prompt = await askPrompt("Введите задачу для агента: ");
  }

  if (!prompt.trim()) {
    console.log("Пустой запрос. Завершение.");
    rl.close();
    return;
  }

  console.log("\n▶️  Запуск агентного цикла...\n");

  const events = agent.run(prompt, {
    workspaceDir: WORKSPACE_DIR,
    sessionId: `cli_${Date.now()}`,
    onApprovalRequest: askUserApproval
  });

  for await (const event of events) {
    switch (event.type) {
      case "text_delta":
        process.stdout.write(event.text);
        break;
      case "tool_call":
        console.log(`\n\n🔧 [Вызов инструмента]: ${event.tool}`);
        console.log(`   Аргументы: ${JSON.stringify(event.args)}`);
        break;
      case "tool_result":
        console.log(`📥 [Результат инструмента ${event.callId}]:`);
        console.log(`   ${event.content.trim()}`);
        if (event.isError) console.log("   ⚠️ Завершено с ошибкой");
        break;
      case "approval_request":
        console.log(`🔔 [Запрос согласования]: ${event.action.toolName}`);
        break;
      case "approval_result":
        console.log(`✅ [Решение]: ${event.outcome}`);
        break;
      case "error":
        console.log(`\n❌ [Ошибка]: ${event.message}`);
        break;
      case "done":
        console.log("\n\n🏁 [Готово!]");
        if (event.usage) {
          console.log(`   Токены: вход=${event.usage.input}, выход=${event.usage.output}, всего=${event.usage.total}`);
        }
        break;
    }
  }

  rl.close();
}

if (process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts")) {
  main().catch(console.error);
}
