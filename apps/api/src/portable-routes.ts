import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import { exportTask, importTask } from "../../../packages/tasks/src/portable";
export function registerPortableRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
) {
  app.get("/api/tasks/:taskId/export", async (req: any, reply) => {
    tasks.requireUser(req, req.params.taskId);
    reply.header(
      "Content-Disposition",
      `attachment; filename="task-${req.params.taskId}.json"`,
    );
    return exportTask(tasks, req.params.taskId);
  });
  app.post("/api/tasks/import", async (req: any) => {
    tasks.requireUser(req);
    return importTask(tasks, req.body.bundle, req.body.name);
  });
}
