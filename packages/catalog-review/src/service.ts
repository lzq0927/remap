import { randomUUID } from "node:crypto";
import { Store } from "../../assets/src/store";
import { hash } from "../../assets/src/hash";
import { DomainError } from "../../contracts/src/errors";
import type { Asset, AssetRef } from "../../contracts/src/types";

export interface Submission {
  id: string; taskId: string; submittedBy: string; contentHash: string; asset: Asset;
  state: "submitted" | "rejected" | "published"; createdAt: string; review?: any; publicAsset?: AssetRef;
}
/** Reviewer identities must come from an authenticated adapter, never a body field. */
export class CatalogReviewService {
  constructor(public store: Store) {}
  list() { return this.store.documents("catalog-submission") as Submission[]; }
  get(id: string) {
    const item = this.list().find((s) => s.id === id);
    if (!item) throw new DomainError("REFERENCE_MISSING", "审核候选不存在", 404);
    return item;
  }
  submit(taskId: string, asset: Asset, submittedBy: string) {
    if (asset.state === "draft") throw new DomainError("INPUT_UNCONFIRMED", "请先校验私有版本");
    const item: Submission = { id: randomUUID(), taskId, submittedBy, contentHash: hash({ kind: asset.kind, name: asset.name, payload: asset.payload }), asset: structuredClone(asset), state: "submitted", createdAt: new Date().toISOString() };
    this.store.putDocument("catalog-submission", item, item.id);
    this.audit(item, "submitted", submittedBy);
    return item;
  }
  decide(id: string, input: { decision: string; contentHash: string; reason: string; checks?: Record<string, boolean> }, identity: { id: string; role: string }) {
    if (identity.role !== "reviewer" || !identity.id) throw new DomainError("REVIEWER_REQUIRED", "需要经过认证的独立审核身份", 403);
    const item = this.get(id);
    if (identity.id === item.submittedBy) throw new DomainError("INDEPENDENT_REVIEW_REQUIRED", "提交人不能批准自己的公共候选", 403);
    if (item.state !== "submitted" || input.contentHash !== item.contentHash) throw new DomainError("REVISION_CONFLICT", "审核版本已改变或已经结案", 409);
    if (!["approved", "rejected"].includes(input.decision) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 10000) throw new DomainError("SCHEMA_INVALID", "审核决定和理由必填");
    if (input.decision === "approved") {
      if (["units", "evidence", "applicability", "privacy", "reproducibility"].some((key) => input.checks?.[key] !== true)) throw new DomainError("REVIEW_INCOMPLETE", "单位、证据、适用范围、共享许可与复现检查必须全部通过");
      const payload = item.asset.payload;
      if (payload.evidenceStatus !== "validated" || !payload.source || !payload.conditions) throw new DomainError("EVIDENCE_REQUIRED", "公共发布需经验证的来源与明确适用条件");
      // Task-local references must be replaced by approved public references before sharing.
      for (const ref of payload.refs ?? []) {
        const target = this.store.get(ref.id, ref.revision);
        if (target.state !== "published" || target.contentHash !== ref.contentHash) throw new DomainError("REFERENCE_MISSING", "公共依赖必须为已批准固定版本");
      }
      const published = this.store.create(item.asset.kind, item.asset.name, payload);
      this.store.transition(published.id, published.revision, "validated");
      this.store.transition(published.id, published.revision, "published");
      item.publicAsset = { id: published.id, revision: published.revision, contentHash: published.contentHash };
      item.state = "published";
    } else item.state = "rejected";
    item.review = { reviewer: identity.id, decision: input.decision, reason: input.reason, checks: input.checks, contentHash: input.contentHash, reviewedAt: new Date().toISOString() };
    this.store.putDocument("catalog-submission", item, item.id);
    this.audit(item, input.decision, identity.id);
    return item;
  }
  private audit(item: Submission, action: string, actor: string) {
    this.store.putDocument("catalog-review-audit", { submissionId: item.id, taskId: item.taskId, contentHash: item.contentHash, action, actor, createdAt: new Date().toISOString() });
  }
}
