import { test as base, expect } from "@playwright/test";
export const test = base.extend<{ taskId: string }>({
  taskId: async ({ request }, use) => {
    const task = await (
      await request.post("/api/tasks", {
        data: { name: "Regression " + Date.now() },
      })
    ).json();
    const examples = await (await request.get("/api/examples/catalogs")).json();
    for (const asset of examples.filter((a: any) => a.state === "published"))
      await request.post(`/api/tasks/${task.id}/catalogs/copy-public`, {
        data: {
          source: "example",
          id: asset.id,
          revision: asset.revision,
          contentHash: asset.contentHash,
        },
      });
    await use(task.id);
  },
});
export { expect };
