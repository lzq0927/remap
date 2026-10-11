import { Store } from "../../assets/src/store";
import { DomainError } from "../../contracts/src/errors";
import type { Asset } from "../../contracts/src/types";

/** Validation freezes task-private revisions without claiming public approval. */
export class TaskStore extends Store {
  constructor(
    dataDir: string,
    readonly taskId: string,
  ) {
    super(dataDir);
  }
  override snapshot(
    refs?: {
      id: string;
      revision: number;
      contentHash?: string;
      taskId?: string;
    }[],
  ): Asset[] {
    const selected =
      refs ??
      (this.db
        .prepare(
          "SELECT id, MAX(revision) revision FROM assets WHERE state IN ('validated','published') GROUP BY id",
        )
        .all() as any[]);
    const assets: Asset[] = [];
    const seen = new Set<string>();
    const take = (ref: {
      id: string;
      revision: number;
      contentHash?: string;
      taskId?: string;
    }) => {
      const copiedScopes = new Set(
        this.documents("task-copy").map((doc) => doc.sourceTaskId),
      );
      if (
        ref.taskId &&
        ref.taskId !== this.taskId &&
        !copiedScopes.has(ref.taskId)
      )
        throw new DomainError("TASK_ACCESS_DENIED", "引用不属于当前任务", 403);
      const asset = this.get(ref.id, ref.revision);
      if (ref.contentHash && asset.contentHash !== ref.contentHash)
        throw new DomainError("REVISION_CONFLICT", "资产快照摘要不匹配", 409);
      if (!["validated", "published", "deprecated"].includes(asset.state))
        throw new DomainError(
          "INPUT_UNCONFIRMED",
          "评估引用必须先验证并冻结任务私有版本",
        );
      const key = asset.id + "@" + asset.revision;
      if (!seen.has(key)) {
        seen.add(key);
        assets.push(asset);
      }
    };
    for (const ref of selected) take(ref);
    for (let index = 0; index < assets.length; index++)
      for (const ref of assets[index].payload.refs ?? []) take(ref);
    return structuredClone(assets);
  }
}
