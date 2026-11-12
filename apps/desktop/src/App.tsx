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

export default function App() {
  const [mode, setMode] = useState<"agent" | "chat">("agent");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeModel, setActiveModel] = useState("YandexGPT");
  const [usage, setUsage] = useState<{ total: number } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start sidecar process when desktop app starts
    invoke("start_sidecar")
      .then(() => console.log("Sidecar started"))
      .catch((err) => console.error("Error starting sidecar:", err));

    const unlisten = listen<string>("sidecar-event", (event) => {
      try {
        const payload = JSON.parse(event.payload);

        if (payload.type === "ready") {
          setActiveModel(payload.model.split("/").pop() || "YandexGPT");
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
      // Remove or mark approval in steps
      setSteps((prev) =>
        prev.map((s) => (s.approvalId === approvalId ? { ...s, content: `Решение: ${decision}` } : s))
      );
    } catch (err) {
      console.error("Error responding to approval:", err);
    }
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
            className={`mode-btn ${mode === "agent" ? "active" : ""}`}
            onClick={() => setMode("agent")}
          >
            🤖 Агент
          </button>
          <button
            className={`mode-btn ${mode === "chat" ? "active" : ""}`}
            onClick={() => setMode("chat")}
          >
            💬 Чат
          </button>
        </div>

        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          <p><strong>Модель:</strong> {activeModel}</p>
          <p style={{ marginTop: "0.4rem" }}><strong>Безопасность:</strong> PolicyEngine активен</p>
          {usage && <p style={{ marginTop: "0.4rem" }}><strong>Токены:</strong> {usage.total}</p>}
        </div>

        <div className="status-badge">
          Workspace: <code>./workspace</code>
        </div>
      </aside>

      {/* Main Area */}
      <main className="main-content">
        <div className="top-bar">
          <div>
            <strong>Сессия агента</strong> —{" "}
            <span style={{ color: "var(--text-muted)" }}>
              {mode === "agent" ? "Автономный режим с инструментами" : "Прямой диалог с моделью"}
            </span>
          </div>
          <div>
            {isRunning && <span style={{ color: "var(--accent)" }}>● Генерация / выполнение шага...</span>}
          </div>
        </div>

        <div className="chat-split-view">
          {/* Chat Messages */}
          <section className="chat-panel">
            <div className="messages-list">
              {messages.length === 0 && (
                <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "3rem" }}>
                  👋 Задайте задачу агенту (например: «Прочитай cart.csv и посчитай общую сумму»)
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

          {/* Steps & Audit Log Panel */}
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
      </main>
    </div>
  );
}
