export type TaskStatus = "open" | "in_progress" | "done";

export type TaskActor = {
  username: string;
  role: "admin" | "operator";
};

export class TaskReopenRequiredError extends Error {
  readonly code = "TASK_REOPEN_REQUIRED";

  constructor() {
    super("已完成任务需要先重新打开，再修改负责人");
    this.name = "TaskReopenRequiredError";
  }
}

export function normalizeTaskStatus(value: unknown): TaskStatus {
  const status = String(value ?? "").toLowerCase();
  if (["closed", "done", "dismissed"].includes(status)) return "done";
  if (["in_progress", "doing", "claimed"].includes(status)) {
    return "in_progress";
  }
  return "open";
}

export function assignmentRequiresWrite(
  currentOwner: string | null,
  nextOwner: string | null,
): boolean {
  return currentOwner !== nextOwner;
}

export function planAssignmentChange(input: {
  currentStatus: unknown;
  currentOwner: string | null;
  nextOwner: string | null;
}): {
  owner: string | null;
  status: Exclude<TaskStatus, "done">;
  clearClaimedAt: boolean;
} {
  const status = normalizeTaskStatus(input.currentStatus);
  if (status === "done") throw new TaskReopenRequiredError();

  if (input.nextOwner === null) {
    return { owner: null, status: "open", clearClaimedAt: true };
  }
  if (input.nextOwner === input.currentOwner) {
    return {
      owner: input.nextOwner,
      status,
      clearClaimedAt: false,
    };
  }
  if (status === "in_progress") {
    return {
      owner: input.nextOwner,
      status: "open",
      clearClaimedAt: true,
    };
  }
  return {
    owner: input.nextOwner,
    status: "open",
    clearClaimedAt: false,
  };
}

export function canOperateTask(
  user: TaskActor,
  owner: string | null,
  nextStatus: TaskStatus,
): boolean {
  if (user.role === "admin") return true;
  if (owner === user.username) return true;
  return owner === null && nextStatus === "in_progress";
}
