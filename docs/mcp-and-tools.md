# Расширяемость Harness Desktop: MCP-плагины и пользовательские инструменты

Harness Desktop поддерживает открытый стандарт **Model Context Protocol (MCP)**, а также прямое подключение локальных TypeScript/JavaScript инструментов.

---

## 1. Подключение MCP-серверов

Каждый подключенный MCP-сервер автоматически регистрирует свои инструменты в реестре агента с префиксом:
`<название-плагина>__<имя-инструмента>`.

### Способ 1: Через графический интерфейс (UI)
1. Откройте приложение Harness Desktop.
2. В левой панели перейдите на вкладку **🔌 MCP**.
3. Нажмите **Подключить** напротив предустановленного плагина `filesystem` (или добавьте свой):
   - **Название:** `filesystem`
   - **Команда:** `npx`
   - **Аргументы:** `-y @modelcontextprotocol/server-filesystem ./workspace`
4. После успешного рукопожатия список доступных инструментов агента обновится автоматически в боковой панели.

---

## 2. Создание собственного инструмента (`tools-contrib/`)

Любой инструмент можно добавить без пересборки ядра проекта. Достаточно создать папку в директории `tools-contrib/`:

### Пример структуры:
```
tools-contrib/
└── my-tool/
    └── index.js   (или index.ts)
```

### Контракт инструмента:
```javascript
export const myCustomTool = {
  name: "my_custom_tool",
  description: "Описание для модели, когда и зачем вызывать этот инструмент",
  brief: "my_custom_tool(arg: string) — краткое описание",
  risk: "low", // "low" | "medium" | "high"
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Поисковый запрос" }
    },
    required: ["query"]
  },
  async run(args, ctx) {
    // Ваша логика
    return {
      content: `Результат работы для ${args.query}`
    };
  }
};

export default myCustomTool;
```

Все инструменты из папки `tools-contrib/` подхватываются загрузчиком `ContribToolsLoader` динамически при старте ядра агента.
