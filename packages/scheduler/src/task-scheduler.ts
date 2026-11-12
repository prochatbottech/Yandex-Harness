export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}

export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private onTriggerCallback?: (task: ScheduledTask) => void;

  onTrigger(cb: (task: ScheduledTask) => void) {
    this.onTriggerCallback = cb;
  }

  addTask(task: Omit<ScheduledTask, "id" | "nextRun">): ScheduledTask {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullTask: ScheduledTask = {
      ...task,
      id,
      nextRun: Date.now() + 60000 // Simple 1-min simulation / cron
    };
    this.tasks.set(id, fullTask);
    return fullTask;
  }

  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  removeTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  start(tickIntervalMs = 5000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      const now = Date.now();
      for (const task of this.tasks.values()) {
        if (task.enabled && task.nextRun && now >= task.nextRun) {
          task.lastRun = now;
          task.nextRun = now + 60000; // next tick
          if (this.onTriggerCallback) {
            this.onTriggerCallback(task);
          }
        }
      }
    }, tickIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
