import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface StepItem {
  id: string;
  type: "tool_call" | "tool_result" | "approval_request" | "done" | "error";
  tool?: string;
  args?: Record<string, unknown>;
  content?: string;
  approvalId?: string;
  action?: {
    toolName: string;
    args: Record<string, unknown>;
    risk: string;
    description: string;
  };
}

interface McpPlugin {
  name: string;
  command: string;
  args: string;
  connected: boolean;
  toolsCount: number;
  error?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "plugins">("chat");
  const [mode, setMode] = useState<"agent" | "chat">("agent");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeModel, setActiveModel] = useState("YandexGPT");
  const [usage, setUsage] = useState<{ total: number } | null>(null);
  const [availableTools, setAvailableTools] = useState<string[]>([]);

  // MCP Plugin State
  const [plugins, setPlugins] = useState<McpPlugin[]>([
    {
      name: "filesystem",
      command: "npx",
      args: "-y @modelcontextprotocol/server-filesystem ./workspace",
      connected: false,
      toolsCount: 0
    }
  ]);
  const [newPluginName, setNewPluginName] = useState("");
  const [newPluginCommand, setNewPluginCommand] = useState("");
  const [newPluginArgs, setNewPluginArgs] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke("start_sidecar")
      .then(() => console.log("Sidecar started"))
      .catch((err) => console.error("Error starting sidecar:", err));

    const unlisten = listen<string>("sidecar-event", (event) => {
      try {
        const payload = JSON.parse(event.payload);

        if (payload.type === "ready") {
          setActiveModel(payload.model.split("/").pop() || "YandexGPT");
          if (payload.tools) setAvailableTools(payload.tools);
        }

        if (payload.type === "mcp_status") {
          const status = payload.status;
          setPlugins((prev) =>
            prev.map((p) =>
              p.name === status.name
                ? {
                    ...p,
                    connected: status.connected,
                    toolsCount: status.toolsCount,
                    error: status.error
                  }
                : p
            )
          );
          // Refresh tools list
          invoke("request_tools_list").catch(console.error);
        }

        if (payload.type === "tools_list") {
          setAvailableTools(payload.tools.map((t: { name: string }) => t.name));
        }

        if (payload.type === "event") {
          const ev = payload.event;

          if (ev.type === "text_delta") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, text: last.text + ev.text }
                ];
              }
              return [...prev, { role: "assistant", text: ev.text }];
            });
          }

          if (ev.type === "tool_call") {
            setSteps((prev) => [
              ...prev,
              {
                id: ev.callId,
                type: "tool_call",
                tool: ev.tool,
                args: ev.args
              }
            ]);
          }

          if (ev.type === "tool_result") {
            setSteps((prev) => [
              ...prev,
              {
                id: `res_${Date.now()}_${Math.random()}`,
                type: "tool_result",
                content: ev.content
              }
            ]);
          }

          if (ev.type === "approval_request") {
            setSteps((prev) => [
              ...prev,
              {
                id: ev.approvalId,
                type: "approval_request",
                approvalId: ev.approvalId,
                action: ev.action
              }
            ]);
          }

          if (ev.type === "done") {
            setIsRunning(false);
            if (ev.usage) {
              setUsage({ total: ev.usage.total });
            }
          }

          if (ev.type === "error") {
            setIsRunning(false);
            setSteps((prev) => [
              ...prev,
              {
                id: `err_${Date.now()}`,
                type: "error",
                content: ev.message
              }
            ]);
          }
        }
      } catch (e) {
        console.error("Failed to parse sidecar event:", e);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const handleSend = async () => {
    if (!input.trim() || isRunning) return;

    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setIsRunning(true);

    try {
      await invoke("send_prompt", {
        sessionId: `session_${Date.now()}`,
        prompt: userText,
        mode
      });
    } catch (err) {
      console.error("Error sending prompt:", err);
      setIsRunning(false);
    }
  };

  const handleApproval = async (approvalId: string, decision: "allow" | "allow_always" | "deny") => {
    try {
      await invoke("respond_approval", {
        approvalId,
        decision
      });
      setSteps((prev) =>
        prev.map((s) => (s.approvalId === approvalId ? { ...s, content: `Решение: ${decision}` } : s))
      );
    } catch (err) {
      console.error("Error responding to approval:", err);
    }
  };

  const handleConnectPlugin = async (p: McpPlugin) => {
    try {
      await invoke("connect_mcp_server", {
        config: {
          name: p.name,
          transport: "stdio",
          command: p.command,
          args: p.args ? p.args.split(" ") : []
        }
      });
    } catch (err) {
      console.error("Error connecting MCP plugin:", err);
    }
  };

  const handleAddCustomPlugin = () => {
    if (!newPluginName.trim() || !newPluginCommand.trim()) return;
    const p: McpPlugin = {
      name: newPluginName.trim(),
      command: newPluginCommand.trim(),
      args: newPluginArgs.trim(),
      connected: false,
      toolsCount: 0
    };
    setPlugins((prev) => [...prev, p]);
    setNewPluginName("");
    setNewPluginCommand("");
    setNewPluginArgs("");
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <span>⚡</span> Harness Desktop
        </div>

        <div className="mode-toggle">
          <button
            className={`mode-btn ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            💬 Чат
          </button>
          <button
            className={`mode-btn ${activeTab === "plugins" ? "active" : ""}`}
            onClick={() => setActiveTab("plugins")}
          >
            🔌 MCP ({plugins.filter((p) => p.connected).length})
          </button>
        </div>

        {activeTab === "chat" && (
          <div className="mode-toggle">
            <button
              className={`mode-btn ${mode === "agent" ? "active" : ""}`}
              onClick={() => setMode("agent")}
            >
              🤖 Агент
            </button>
            <button
              className={`mode-btn ${mode === "chat" ? "active" : ""}`}
              onClick={() => setMode("chat")}
            >
              💭 Простой чат
            </button>
          </div>
        )}

        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          <p><strong>Модель:</strong> {activeModel}</p>
          <p style={{ marginTop: "0.4rem" }}><strong>Инструментов:</strong> {availableTools.length}</p>
          {usage && <p style={{ marginTop: "0.4rem" }}><strong>Токены:</strong> {usage.total}</p>}
        </div>

        <div className="status-badge" style={{ marginBottom: "0.5rem" }}>
          <strong>Активные tools:</strong>
          <div style={{ maxHeight: "90px", overflowY: "auto", fontSize: "0.75rem", marginTop: "0.3rem" }}>
            {availableTools.map((t) => (
              <div key={t}>• {t}</div>
            ))}
          </div>
        </div>

        <div className="status-badge">
          Workspace: <code>./workspace</code>
        </div>
      </aside>

      {/* Main Area */}
      <main className="main-content">
        <div className="top-bar">
          <div>
            <strong>
              {activeTab === "chat" ? "Сессия агента" : "Управление MCP-плагинами и расширениями"}
            </strong>{" "}
            —{" "}
            <span style={{ color: "var(--text-muted)" }}>
              {activeTab === "chat"
                ? mode === "agent"
                  ? "Автономный ReAct цикл с вызовом инструментов"
                  : "Прямой диалог"
                : "Стандарт Model Context Protocol (stdio / HTTP)"}
            </span>
          </div>
          <div>
            {isRunning && <span style={{ color: "var(--accent)" }}>● Генерация / выполнение шага...</span>}
          </div>
        </div>

        {activeTab === "plugins" ? (
          /* MCP Plugins Settings Screen */
          <div style={{ padding: "2rem", overflowY: "auto" }}>
            <h2 style={{ marginBottom: "1rem" }}>Подключенные MCP серверы</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
              {plugins.map((p) => (
                <div
                  key={p.name}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    padding: "1rem",
                    borderRadius: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: "1.05rem" }}>
                      {p.name}{" "}
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          background: p.connected ? "var(--success)" : "var(--border)",
                          color: p.connected ? "white" : "var(--text-muted)",
                          marginLeft: "0.5rem"
                        }}
                      >
                        {p.connected ? `Подключен (${p.toolsCount} tools)` : "Не подключен"}
                      </span>
                    </h3>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.3rem" }}>
                      Команда: <code>{p.command} {p.args}</code>
                    </p>
                    {p.error && (
                      <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.3rem" }}>
                        Ошибка: {p.error}
                      </p>
                    )}
                  </div>
                  <button
                    className="send-btn"
                    style={{ padding: "0.5rem 1rem" }}
                    onClick={() => handleConnectPlugin(p)}
                  >
                    {p.connected ? "Переподключить" : "Подключить"}
                  </button>
                </div>
              ))}
            </div>

            <h2 style={{ marginBottom: "1rem" }}>Добавить новый MCP-плагин</h2>
            <div
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                padding: "1.5rem",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                maxWidth: "600px"
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                  Название плагина (префикс инструментов)
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: "100%" }}
                  placeholder="github, postgres, memory..."
                  value={newPluginName}
                  onChange={(e) => setNewPluginName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                  Команда запуска (stdio)
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: "100%" }}
                  placeholder="npx, python, docker..."
                  value={newPluginCommand}
                  onChange={(e) => setNewPluginCommand(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                  Аргументы команды
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: "100%" }}
                  placeholder="-y @modelcontextprotocol/server-xxx ..."
                  value={newPluginArgs}
                  onChange={(e) => setNewPluginArgs(e.target.value)}
                />
              </div>
              <button
                className="send-btn"
                style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}
                onClick={handleAddCustomPlugin}
              >
                + Добавить в список
              </button>
            </div>
          </div>
        ) : (
          /* Normal Chat + Steps View */
          <div className="chat-split-view">
            <section className="chat-panel">
              <div className="messages-list">
                {messages.length === 0 && (
                  <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "3rem" }}>
                    👋 Задайте задачу агенту (например: «Какая погода в Москве?» или «Прочитай cart.csv»)
                  </div>
                )}
                {messages.map((m, idx) => (
                  <div key={idx} className={`message-bubble message-${m.role}`}>
                    {m.text}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="input-area">
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Введите поручение для агента..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                />
                <button className="send-btn" onClick={handleSend} disabled={isRunning || !input.trim()}>
                  {isRunning ? "Выполняется..." : "Отправить"}
                </button>
              </div>
            </section>

            <aside className="steps-panel">
              <div className="steps-header">
                <span>Панель шагов агента</span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{steps.length} действий</span>
              </div>

              <div className="steps-list">
                {steps.length === 0 && (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", marginTop: "2rem" }}>
                    Шаги и вызовы инструментов отобразятся здесь в реальном времени.
                  </div>
                )}
                {steps.map((step) => {
                  if (step.type === "tool_call") {
                    return (
                      <div key={step.id} className="step-card tool">
                        <div className="step-title">
                          <span>🔧 {step.tool}</span>
                        </div>
                        <div className="step-body">
                          {JSON.stringify(step.args, null, 2)}
                        </div>
                      </div>
                    );
                  }

                  if (step.type === "tool_result") {
                    return (
                      <div key={step.id} className="step-card">
                        <div className="step-title" style={{ color: "var(--text-muted)" }}>
                          📥 Результат
                        </div>
                        <div className="step-body">{step.content}</div>
                      </div>
                    );
                  }

                  if (step.type === "approval_request" && step.action && step.approvalId) {
                    return (
                      <div key={step.id} className="step-card approval">
                        <div className="step-title" style={{ color: "var(--warning)" }}>
                          ⚠️ Согласование действия
                        </div>
                        <div style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
                          {step.action.description || step.action.toolName} (Риск: {step.action.risk})
                        </div>
                        <div className="step-body">
                          {JSON.stringify(step.action.args, null, 2)}
                        </div>
                        <div className="approval-actions">
                          <button
                            className="appr-btn appr-allow"
                            onClick={() => handleApproval(step.approvalId!, "allow")}
                          >
                            Разрешить
                          </button>
                          <button
                            className="appr-btn appr-always"
                            onClick={() => handleApproval(step.approvalId!, "allow_always")}
                          >
                            Всегда
                          </button>
                          <button
                            className="appr-btn appr-deny"
                            onClick={() => handleApproval(step.approvalId!, "deny")}
                          >
                            Отклонить
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
                <div ref={stepsEndRef} />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
