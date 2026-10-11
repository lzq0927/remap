import type { WorkspaceAgentPort } from "../../../packages/agents/src/port";
import type { Task } from "../../../packages/contracts/src/types";
import type { TaskServices } from "../../../packages/tasks/src/service";
import { OpenCodeAdapter } from "../../../packages/agents/src/opencode-adapter";
import { prepareTaskAgent } from "../../../packages/agents/src/task-binding";

/** Administrator-controlled composition point, never registered by HTTP or Agent requests. */
export interface AgentIntegration {
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

export function openCodeIntegration(): AgentIntegration {
  return {
    global: new OpenCodeAdapter(),
    forTask: (directory) => new OpenCodeAdapter(undefined, directory),
    prepareTask: prepareTaskAgent,
  };
}
