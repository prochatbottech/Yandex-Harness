# Руководство контрибьютора (Contributing Guide)

Мы приветствуем вклад в развитие **Harness Desktop**!

## Как добавить свой инструмент в `tools-contrib/`

1. Создайте папку в `tools-contrib/<имя-инструмента>/`.
2. Создайте файл `index.js` или `index.ts`.
3. Экспортируйте объект инструмента, соответствующий контракту `Tool`:
```typescript
export const myTool = {
  name: "my_tool",
  description: "Описание для LLM",
  brief: "my_tool(...) — короткое описание",
  risk: "low", // "low" | "medium" | "high"
  schema: {
    type: "object",
    properties: {
      input: { type: "string" }
    },
    required: ["input"]
  },
  async run(args, ctx) {
    return { content: "OK" };
  }
};
export default myTool;
```
4. Инструмент будет загружен ядром динамически без пересборки.

---

## Правила оформления кода

- Используйте `pnpm` для управления зависимостями.
- Перед созданием Pull Request убедитесь, что все пакеты собираются:
  ```bash
  pnpm -r run build
  cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
  ```
- Не коммитьте файлы `.env` и секреты в git.
