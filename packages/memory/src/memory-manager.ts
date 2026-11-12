import * as fs from "node:fs/promises";
import * as path from "node:path";

export class MemoryManager {
  private memoryDir: string;

  constructor(workspaceDir: string) {
    this.memoryDir = path.join(workspaceDir, "memory");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
  }

  async getSummary(): Promise<string> {
    const memoryFile = path.join(this.memoryDir, "MEMORY.md");
    try {
      const content = await fs.readFile(memoryFile, "utf-8");
      return content.slice(0, 1500); // 1.5KB summary
    } catch {
      return "";
    }
  }

  async save(key: string, content: string): Promise<void> {
    await this.init();
    const filePath = path.join(this.memoryDir, `${key}.md`);
    await fs.writeFile(filePath, content, "utf-8");
  }

  async read(key: string): Promise<string | null> {
    const filePath = path.join(this.memoryDir, `${key}.md`);
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.memoryDir);
      return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  }
}
