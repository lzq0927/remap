import type { WorkspaceAgentPort } from "../../../packages/agents/src/port";
import type { Task } from "../../../packages/contracts/src/types";
import type { TaskServices } from "../../../packages/tasks/src/service";
import { OpenCodeAdapter } from "../../../packages/agents/src/opencode-adapter";
import { prepareTaskAgent } from "../../../packages/agents/src/task-binding";
import { OpenCodeTaskRuntime } from "../../../packages/agents/src/opencode-runtime";

/** Administrator-controlled composition point, never registered by HTTP or Agent requests. */
export interface AgentIntegration {
  close?(): Promise<void>;
  global: WorkspaceAgentPort;
  forTask(directory: string): WorkspaceAgentPort;
  prepareTask(
    tasks: TaskServices,
    taskId: string,
    apiUrl: string,
  ): Promise<{
    task: Task;
    agent: WorkspaceAgentPort;
  }>;
}

export function openCodeIntegration(
  options: { isolate?: boolean } = {},
): AgentIntegration {
  const runtime = new OpenCodeTaskRuntime();
  const adapters = new Map<string, OpenCodeAdapter>();
  const migration = new Map<string, Promise<void>>();
  const forTask = (directory: string) => {
    if (!adapters.has(directory))
      adapters.set(
        directory,
        new OpenCodeAdapter(
          undefined,
          directory,
          options.isolate === false
            ? undefined
            : () => runtime.ensure(directory),
        ),
      );
    return adapters.get(directory)!;
  };
  return {
    global: new OpenCodeAdapter(),
    forTask,
    close: () => runtime.close(),
    prepareTask: async (tasks, taskId, apiUrl) => {
      const directory = tasks.registry.resolveRoot(taskId);
      const prepared = await prepareTaskAgent(
        tasks,
        taskId,
        apiUrl,
        forTask(directory),
      );
      const bindings = tasks.resolve(taskId).store.documents("agent-binding");
      // Configuration and Skill preparation work without an installed/running Agent.
      // Only existing native session history requires migration and a live service.
      if (
        options.isolate !== false &&
        bindings.length &&
        (await prepared.agent.health()).ready
      ) {
        if (!migration.has(directory))
          migration.set(
            directory,
            (async () => {
              const { store } = tasks.resolve(taskId);
              const info = await prepared.agent.webInfo();
              for (const binding of store.documents("agent-binding")) {
                if (info.sessions.some((s: any) => s.id === binding.sessionId))
                  continue;
                await runtime.migrateSession(directory, binding.sessionId);
              }
            })().catch((error) => {
              migration.delete(directory);
              throw error;
            }),
          );
        await migration.get(directory);
      }
      return prepared;
    },
  };
}
