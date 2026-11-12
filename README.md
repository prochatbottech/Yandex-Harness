# ⚡ Harness Desktop

> **Открытый десктоп-харнесс для ИИ-агентов на моделях Яндекса (YandexGPT, Alice AI LLM) и локальных открытых LLM (Ollama, llama.cpp, vLLM).**

[![CI](https://github.com/prochatbottech/harness-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/prochatbottech/harness-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🎯 О проекте

**Harness Desktop** — это открытая десктопная среда выполнения поручений вокруг LLM, созданная как прозрачная альтернатива закрытым агентным режимам.
Пользователь полностью контролирует работу ИИ-ассистента: видит каждый шаг рассуждений, вызовы инструментов и подтверждает необратимые действия в один клик.

### Ключевые возможности:
- **🧠 Поддержка моделей Яндекса и локальных LLM:** Работа через OpenAI-совместимый эндпоинт Yandex AI Studio (`YandexGPT Pro 5.1`, `Alice AI LLM`), а также локальные сервера (Ollama, vLLM, LM Studio).
- **🔄 Автономный агентный цикл:** Поддержка tool calling, SSE-стриминг текста и событий, лимиты шагов, отслеживание токенов.
- **🛡️ Безопасность и Policy Engine:** Интерактивное подтверждение чувствительных действий (`fs_write`, удаление, запуск кода) в панели шагов.
- **🔌 Стандарт MCP (Model Context Protocol):** Подключение любых внешних MCP-серверов по транспорту `stdio` прямо из графического интерфейса.
- **🐍 Песочница Python-кода (`run_code`):** Безопасное выполнение скриптов с ограничением времени (60 с) и дисковой изоляцией в `workspace/`.
- **🌐 Веб-инструменты:** `web_fetch` с извлечением чистого текста страниц.
- **🧩 Скиллы (`skills/`):** Переиспользуемые пошаговые инструкции (сводка новостей, анализ CSV таблиц).
- **⏰ Планировщик (`@harness/scheduler`):** Фоновые cron-задачи и напоминания.
- **🖥️ Быстрый нативный UI:** Tauri 2 (Rust) + React 19 + TypeScript (размер приложения в разы меньше Electron).

---

## 🚀 Быстрый старт для разработчиков

### Требования:
- Node.js ≥ 22
- pnpm ≥ 10
- Rust & Cargo (для Tauri)
- Python 3.10+ (для песочницы `run_code`)

### 1. Клонирование и установка:
```bash
git clone https://github.com/prochatbottech/harness-desktop.git
cd harness-desktop
pnpm install
```

### 2. Настройка переменных окружения:
Скопируйте пример файла конфигурации:
```bash
cp .env.example .env
```
Укажите в `.env` ваши параметры Yandex Cloud / AI Studio:
```env
YANDEX_API_KEY="ваш_api_ключ"
YANDEX_FOLDER_ID="ваш_folder_id"
YANDEX_MODEL="gpt://<folder_id>/yandexgpt/latest"
```

### 3. Запуск CLI-агента в консоли:
```bash
pnpm -r run build
node apps/core/dist/cli.js "Прочитай cart.csv и посчитай общую сумму"
```

### 4. Запуск десктопного приложения (Tauri 2 + React):
```bash
pnpm --filter appsdesktop tauri dev
```

---

## 📁 Структура монорепозитория

```
harness-desktop/
├── apps/
│   ├── desktop/          # Tauri 2 десктопное приложение (Rust + React UI)
│   └── core/             # Node.js ядро агента (CLI & Sidecar JSON-RPC)
├── packages/
│   ├── agent-loop/       # Чистый агентный цикл (ReAct / Tool calling)
│   ├── model/            # Абстракция ModelClient (Yandex Cloud, Ollama, OpenAI)
│   ├── policy/           # PolicyEngine (контроль рисков, согласования)
│   ├── tools/            # Встроенные инструменты (fs, calculator, python, web)
│   ├── mcp/              # MCP клиент и менеджер подключений
│   ├── memory/           # Долговременная память и ContextManager
│   └── scheduler/        # Планировщик периодических задач
├── tools-contrib/        # Каталог для пользовательских инструментов (без пересборки)
├── skills/               # Скиллы агента в формате Markdown
└── docs/                 # Документация и руководства
```

---

## ⚖️ Юридическая информация и ограничения
- Проект является открытым независимым ПО под лицензией **MIT**.
- Обозначения «Алиса AI», «YandexGPT», «Yandex Cloud» являются товарными знаками ООО «Яндекс». Проект взаимодействует с официальными открытыми API платформы.

---

## 🤝 Участие в разработке
Ознакомьтесь с [CONTRIBUTING.md](docs/CONTRIBUTING.md) перед созданием Pull Request.
Любые вопросы и идеи можно оставлять в [Issues](https://github.com/prochatbottech/harness-desktop/issues).
