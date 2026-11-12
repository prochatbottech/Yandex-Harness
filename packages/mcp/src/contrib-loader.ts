import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Tool, ToolRegistry } from "@harness/tools";

export class ContribToolsLoader {
  constructor(private toolRegistry: ToolRegistry) {}

  async loadFromDirectory(contribDir: string): Promise<number> {
    let loadedCount = 0;
    try {
      const entries = await fs.readdir(contribDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const entryPath = path.join(contribDir, entry.name);
          const candidates = ["index.js", "index.mjs", "index.ts"];
          for (const cand of candidates) {
            const filePath = path.join(entryPath, cand);
            try {
              await fs.access(filePath);
              const fileUrl = pathToFileURL(filePath).href;
              const module = await import(fileUrl);
              const candidateTool = (module.default || module) as Tool;
              if (
                candidateTool &&
                typeof candidateTool.name === "string" &&
                typeof candidateTool.run === "function"
              ) {
                this.toolRegistry.register(candidateTool);
                loadedCount++;
                break;
              }
            } catch {
              // Not found or not valid, continue search
            }
          }
        }
      }
    } catch {
      // directory does not exist or cannot be read
    }
    return loadedCount;
  }
}
