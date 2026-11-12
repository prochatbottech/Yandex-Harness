import * as readline from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as dotenv from "dotenv";
import { AgentLoop } from "@harness/agent-loop";
import { OpenAiCompatibleClient } from "@harness/model";
import { DefaultPolicyEngine, ActionDescriptor, ApprovalDecision } from "@harness/policy";
import {
  ToolRegistry,
  fsReadTool,
  fsWriteTool,
  calculatorTool,
  runCodeTool,
  webFetchTool,
  createSkillUseTool
} from "@harness/tools";
import { MemoryManager } from "@harness/memory";
import { ContribToolsLoader, McpClientManager, McpServerConfig } from "@harness/mcp";
import { TaskScheduler } from "@harness/scheduler";

dotenv.config();

const API_KEY = process.env.YANDEX_API_KEY || "";
const FOLDER_ID = process.env.YANDEX_FOLDER_ID || "";
const DEFAULT_MODEL = process.env.YANDEX_MODEL || "gpt://b1g2846d6bp9q0pe8pjv/yandexgpt/latest";
const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
const CONTRIB_DIR = path.resolve(process.cwd(), "tools-contrib");
const SKILLS_DIR = path.resolve(process.cwd(), "skills");

export async function runSidecarServer() {
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
  toolRegistry.register(runCodeTool);
  toolRegistry.register(webFetchTool);
  toolRegistry.register(createSkillUseTool(SKILLS_DIR));

  // Load custom tools from tools-contrib/
  const contribLoader = new ContribToolsLoader(toolRegistry);
  const loadedContribCount = await contribLoader.loadFromDirectory(CONTRIB_DIR);

  // Initialize MCP Manager
  const mcpManager = new McpClientManager(toolRegistry);

  const policyEngine = new DefaultPolicyEngine();
  const memoryManager = new MemoryManager(WORKSPACE_DIR);
  await memoryManager.init();

  const scheduler = new TaskScheduler();

  const agent = new AgentLoop(modelClient, toolRegistry, policyEngine);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>();

  function sendToHost(message: Record<string, unknown>) {
    process.stdout.write(JSON.stringify(message) + "\n");
  }

  // Scheduler callback trigger
  scheduler.onTrigger(async (task) => {
    sendToHost({
      type: "scheduler_triggered",
      task
    });
  });
  scheduler.start();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed);

      if (msg.type === "approval_response") {
        const resolver = pendingApprovals.get(msg.approvalId);
        if (resolver) {
          pendingApprovals.delete(msg.approvalId);
          resolver(msg.decision);
        }
        return;
      }

      if (msg.type === "connect_mcp") {
        const config: McpServerConfig = msg.config;
        const status = await mcpManager.connectServer(config);
        sendToHost({
          type: "mcp_status",
          status
        });
        return;
      }

      if (msg.type === "list_tools") {
        const tools = toolRegistry.list().map((t) => ({
          name: t.name,
          description: t.description,
          risk: t.risk
        }));
        sendToHost({
          type: "tools_list",
          tools
        });
        return;
      }

      if (msg.type === "add_scheduled_task") {
        const task = scheduler.addTask({
          name: msg.name,
          cron: msg.cron || "*/1 * * * *",
          prompt: msg.prompt,
          enabled: true
        });
        sendToHost({
          type: "scheduler_task_added",
          task
        });
        return;
      }

      if (msg.type === "run_prompt") {
        const sessionId = msg.sessionId || `session_${Date.now()}`;
        const prompt = msg.prompt;
        const mode = msg.mode || "agent";

        const events = agent.run(prompt, {
          workspaceDir: WORKSPACE_DIR,
          sessionId,
          mode,
          onApprovalRequest: (action: ActionDescriptor) => {
            return new Promise<ApprovalDecision>((resolve) => {
              const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              pendingApprovals.set(approvalId, resolve);
              sendToHost({
                type: "event",
                sessionId,
                event: {
                  type: "approval_request",
                  approvalId,
                  action
                }
              });
            });
          }
        });

        for await (const event of events) {
          sendToHost({
            type: "event",
            sessionId,
            event
          });
        }
      }
    } catch (err: unknown) {
      sendToHost({
        type: "error",
        message: `Ошибка парсинга sidecar запроса: ${(err as Error).message}`
      });
    }
  });

  sendToHost({
    type: "ready",
    model: DEFAULT_MODEL,
    workspace: WORKSPACE_DIR,
    contribLoaded: loadedContribCount,
    tools: toolRegistry.list().map((t) => t.name)
  });
}

if (process.argv[1]?.endsWith("sidecar.js") || process.argv[1]?.endsWith("sidecar.ts")) {
  runSidecarServer().catch(console.error);
}
