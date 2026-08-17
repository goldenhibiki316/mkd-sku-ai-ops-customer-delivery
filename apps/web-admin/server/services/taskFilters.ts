export type SessionUser = {
  username: string;
  role: "admin" | "operator";
};

export type TaskFilterInput = {
  status: string;
  priority: number | null;
  owner: string | null;
  ownerFilter: string;
  taskType: string | null;
  search: string;
  user?: SessionUser;
};

const statusValues = (status: string): string[] => {
  const value = status.toLowerCase();
  if (["open", "pending"].includes(value)) return ["open", "pending"];
  if (["in_progress", "claimed", "doing"].includes(value)) {
    return ["in_progress", "doing", "claimed"];
  }
  if (["done", "closed"].includes(value)) return ["closed", "done", "dismissed"];
  return [value];
};

export function buildTaskFilter(
  input: TaskFilterInput,
): { sql: string; params: unknown[] } {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.status && input.status.toLowerCase() !== "all") {
    clauses.push(`lower(t.status) = ANY(${add(statusValues(input.status))}::text[])`);
  }
  if (input.priority !== null) clauses.push(`t.priority = ${add(input.priority)}`);

  const ownerFilter = input.ownerFilter.toLowerCase();
  if (input.user?.role === "operator") {
    if (ownerFilter === "unassigned") clauses.push("t.owner IS NULL");
    else clauses.push(`t.owner = ${add(input.user.username)}`);
  }
  if (input.user?.role === "admin") {
    if (input.owner) clauses.push(`t.owner = ${add(input.owner)}`);
    else if (ownerFilter === "assigned") clauses.push("t.owner IS NOT NULL");
    else if (ownerFilter === "unassigned") clauses.push("t.owner IS NULL");
  }

  if (input.taskType && input.taskType !== "ALL") {
    clauses.push(`t.task_type = ${add(input.taskType)}`);
  }
  if (input.search) {
    const search = add(`%${input.search}%`);
    clauses.push(
      `(t.sku ILIKE ${search} OR mp.chinese_name ILIKE ${search} OR mp.title ILIKE ${search} OR s.product_name_zh ILIKE ${search} OR s.brand_name ILIKE ${search})`,
    );
  }

  return { sql: clauses.join(" AND "), params };
}
