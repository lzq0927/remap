import { test as base, expect } from "@playwright/test";
export const test = base.extend<{ taskId: string; fullWorkspace: boolean }>({
  // Existing domain journeys deliberately exercise the retained complete-edit views.
  // Focused UX tests opt out and verify the new production defaults independently.
  fullWorkspace: [true, { option: true }],
  taskId: async ({ request, context, fullWorkspace }, use) => {
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
    if (fullWorkspace)
      await context.addInitScript((id) => {
        sessionStorage.setItem(`remap.workspace.${id}`, "all");
        sessionStorage.setItem(`remap.results.${id}`, "all");
      }, task.id);
    await use(task.id);
  },
});
export { expect };
