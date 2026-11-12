import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool, ToolContext, ToolRegistry, ToolResult } from "@harness/tools";
import { McpConnectionStatus, McpServerConfig } from "./types.js";

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private statuses: Map<string, McpConnectionStatus> = new Map();

  constructor(private toolRegistry: ToolRegistry) {}

  async connectServer(config: McpServerConfig): Promise<McpConnectionStatus> {
    try {
      if (config.transport === "stdio") {
        if (!config.command) {
          throw new Error(`MCP сервер "${config.name}" требует указания command для stdio транспорта`);
        }

        const env: Record<string, string> = {};
        for (const [key, val] of Object.entries(process.env)) {
          if (val !== undefined) env[key] = val;
        }
        if (config.env) {
          for (const [key, val] of Object.entries(config.env)) {
            if (val !== undefined) env[key] = val;
          }
        }

        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env
        });

        const client = new Client(
          {
            name: `harness-mcp-client-${config.name}`,
            version: "0.1.0"
          },
          {
            capabilities: {}
          }
        );

        await client.connect(transport);
        this.clients.set(config.name, client);

        // Discover and register tools with prefix <plugin>__<tool>
        const toolsResponse = await client.listTools();
        const tools = toolsResponse.tools || [];

        for (const t of tools) {
          const namespacedName = `${config.name}__${t.name}`;
          const riskLevel = config.access === "read_only" ? "low" : "medium";

          const proxyTool: Tool = {
            name: namespacedName,
            description: `[MCP: ${config.name}] ${t.description || t.name}`,
            brief: `${namespacedName} — инструмент плагина ${config.name}`,
            risk: riskLevel,
            schema: (t.inputSchema as Record<string, unknown>) || { type: "object" },
            run: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
              try {
                const result = await client.callTool({
                  name: t.name,
                  arguments: args
                });

                let outputText = "";
                if (Array.isArray(result.content)) {
                  outputText = result.content
                    .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
                    .join("\n");
                } else {
                  outputText = JSON.stringify(result.content);
                }

                return {
                  content: outputText || "(Пустой ответ инструмента)",
                  isError: Boolean(result.isError)
                };
              } catch (err: unknown) {
                return {
                  content: `Ошибка вызова MCP инструмента: ${(err as Error).message}`,
                  isError: true
                };
              }
            }
          };

          this.toolRegistry.register(proxyTool);
        }

        const status: McpConnectionStatus = {
          name: config.name,
          connected: true,
          toolsCount: tools.length
        };
        this.statuses.set(config.name, status);
        return status;
      } else {
        // Streamable HTTP transport
        const status: McpConnectionStatus = {
          name: config.name,
          connected: false,
          toolsCount: 0,
          error: "HTTP транспорт находится в стадии доработки"
        };
        this.statuses.set(config.name, status);
        return status;
      }
    } catch (err: unknown) {
      const status: McpConnectionStatus = {
        name: config.name,
        connected: false,
        toolsCount: 0,
        error: (err as Error).message
      };
      this.statuses.set(config.name, status);
      return status;
    }
  }

  getStatus(name: string): McpConnectionStatus | undefined {
    return this.statuses.get(name);
  }

  getAllStatuses(): McpConnectionStatus[] {
    return Array.from(this.statuses.values());
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();
    this.statuses.clear();
  }
}
