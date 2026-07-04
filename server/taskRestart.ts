type TaskStatus = "queued" | "running" | "success" | "failed" | "canceled";

export function shouldFailTaskAfterServerRestart(status: TaskStatus): boolean {
  return status === "running";
}
