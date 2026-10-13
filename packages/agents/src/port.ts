import type { AgentEvent } from "../../contracts/src/types";
export interface AgentMessage {
  id: string;
  role: string;
  model?: { provider?: string; id?: string };
  error?: unknown;
  parts: Array<{
    id: string;
    type: "text" | "tool";
    text?: string;
    toolName?: string;
    status?: string;
    details?: unknown;
  }>;
}
export interface AgentPort {
  health(): Promise<{
    ready: boolean;
    version: string | null;
    url?: string;
    message?: string;
  }>;
  createSession(options?: { title?: string }): Promise<{ sessionId: string }>;
  messages(id: string): Promise<AgentMessage[]>;
  sendMessage(id: string, text: string, signal?: AbortSignal): Promise<unknown>;
  runCommand(id: string, args?: string, signal?: AbortSignal): Promise<unknown>;
  abort(id: string): Promise<unknown>;
  events(id: string, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

/** Workbench integration; reliability tools and Skill do not depend on this UI port. */
export interface WorkspaceAgentPort extends AgentPort {
  webInfo(): Promise<{
    ready: boolean;
    version: string | null;
    url: string;
    directory: string;
    projectUrl: string;
    sessions: Array<{
      id: string;
      title: string;
      updatedAt?: number;
      url: string;
    }>;
    message?: string;
  }>;
  metadata(): Promise<unknown>;
  providers(): Promise<unknown>;
  addContext(id: string, context: unknown): Promise<unknown>;
  pending(id: string): Promise<{
    questions: Array<{ id: string }>;
    permissions: Array<{ id: string }>;
  }>;
  reply(kind: string, id: string, body: unknown): Promise<unknown>;
}
