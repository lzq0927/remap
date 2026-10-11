export type CatalogKind =
  | "failure-mode"
  | "mechanism"
  | "parameter-evidence"
  | "scenario-template"
  | "validation-case"
  | "incident";
export type AssetState = "draft" | "validated" | "published" | "deprecated";
export type AssetRef = { id: string; revision: number; contentHash: string };
export interface Asset extends AssetRef {
  kind: CatalogKind;
  name: string;
  state: AssetState;
  schemaVersion: string;
  payload: Record<string, any>;
  createdAt: string;
  issues?: Issue[];
}
export type Issue = {
  code: string;
  message: string;
  path?: string;
  objectId?: string;
};
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface RunEvent {
  runId: string;
  sequence: number;
  stepId: string;
  type: string;
  payload: Record<string, any>;
  createdAt: string;
}
export interface Run {
  id: string;
  status: RunStatus;
  operation: string;
  input: Record<string, any>;
  inputHash: string;
  result?: any;
  error?: Issue;
  createdAt: string;
  completedAt?: string;
  progress: number;
  events: RunEvent[];
}
export interface TrainingRequest {
  cards: number;
  hours: number;
  trials: number;
  seed: number;
  target: number;
  scenarioId?: string;
  generation?: string;
  idealWorkPerHour?: number;
  model?: Record<string, any>;
  config?: Record<string, any>;
  factors?: string[];
}
export interface AgentEvent {
  sessionId: string;
  eventId: string;
  kind: "message" | "tool" | "question" | "permission" | "error" | "idle";
  payload: Record<string, any>;
}

export interface Task {
  id: string;
  name: string;
  status: "active" | "archived";
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  copiedFrom?: string;
  origin?: "local" | "legacy" | "import";
}

export interface TaskMigrationManifest {
  schemaVersion: "1.0.0";
  taskId: "legacy";
  sourcePath: string;
  sourceHash: string;
  backupPath: string;
  databasePath: string;
  createdAt: string;
  files: Array<{ name: string; contentHash: string }>;
}
