import { apiRequest } from "./queryClient";

export async function getJSON<T = any>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return await res.json();
}
