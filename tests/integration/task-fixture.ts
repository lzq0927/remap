import {
  buildApp as createApp,
  type BuildAppOptions,
} from "../../apps/api/src/server";

/** Older domain tests still choose one explicit isolated task; no legacy API exists at runtime. */
export async function buildApp(options: BuildAppOptions = {}) {
  const app = await createApp(options);
  const task = app.taskServices.create("Domain regression fixture");
  if (options.seed !== false) {
    const target = app.taskServices.resolve(task.id).store;
    for (const asset of app.taskServices.examples.list()) {
      target.db
        .prepare(
          "INSERT INTO assets (id,revision,kind,name,state,hash,payload,created) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          asset.id,
          asset.revision,
          asset.kind,
          asset.name,
          "validated",
          asset.contentHash,
          JSON.stringify(asset.payload),
          asset.createdAt,
        );
    }
  }
  const original = app.inject.bind(app);
  const scoped = (url: string) =>
    url.replace(
      /^\/api\/(catalogs|inputs|design|runs|feedback|allocations)(?=\/|\?|$)/,
      `/api/tasks/${task.id}/$1`,
    );
  app.inject = ((request: any) =>
    original(
      typeof request === "string"
        ? scoped(request)
        : { ...request, url: scoped(request.url) },
    )) as typeof app.inject;
  return Object.assign(app, { testTaskId: task.id });
}
