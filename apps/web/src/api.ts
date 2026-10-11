import { createContext, useContext } from "react";

export async function api(path: string, body?: any, method?: string) {
  const r = await fetch("/api" + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error?.message ?? "请求失败"), {
      code: data.error?.code,
      status: r.status,
    });
  return data;
}
export function createTaskApi(taskId: string) {
  const prefix = "/tasks/" + encodeURIComponent(taskId);
  const global = /^\/(defaults|settings|templates|examples|public)(\/|\?|$)/;
  const url = (path: string) =>
    "/api" + (global.test(path) ? path : prefix + path);
  const request = (path: string, body?: any, method?: string) =>
    api(global.test(path) ? path : prefix + path, body, method);
  return { taskId, api: request, url };
}
export const TaskApiContext = createContext<ReturnType<
  typeof createTaskApi
> | null>(null);
export function useTaskApi() {
  const value = useContext(TaskApiContext);
  if (!value) throw new Error("请先打开任务");
  return value;
}
export const pretty = (v: any) => JSON.stringify(v, null, 2);
