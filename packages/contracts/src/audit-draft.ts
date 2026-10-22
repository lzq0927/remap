import type { AuditRequest } from "../../analysis/src/audit";
import {
  auditReferenceScales,
  auditReferenceOnly,
  auditScaleOrder,
} from "./audit-presets";
/** Shared draft conversion: browser, API and Agent use the same saved assessment. */
export interface AuditDraft {
  request: AuditRequest;
  overrides: string;
  hardware: string;
  model: string;
  policy: string;
  allScales: boolean;
}
/** The editor and submitted run must expose the same required inventory scales. */
export function auditDraftScales(request: AuditRequest, allScales: boolean) {
  return allScales
    ? [
        ...new Set([
          request.cards,
          ...(request.scales ?? []).filter(
            (cards) =>
              cards !== 1000 ||
              request.samplingProfile !== undefined ||
              request.cards === cards ||
              request.targets?.[cards] !== undefined,
          ),
          ...(request.samplingProfile
            ? auditReferenceScales
            : [10000, 100000, 200000, 500000]),
        ]),
      ].sort(auditScaleOrder)
    : [request.cards];
}
export function auditDraftInput(draft: AuditDraft): AuditRequest {
  const { request, overrides, hardware, model, policy, allScales } = draft;
  const eventOverrides = JSON.parse(overrides),
    candidateFitOverrides = JSON.parse(hardware);
  if (!Array.isArray(eventOverrides) || !Array.isArray(candidateFitOverrides))
    throw new Error("事件更新必须是数组");
  const scales = auditDraftScales(request, allScales);
  return {
    ...request,
    scales,
    targets: Object.fromEntries(
      scales
        .filter((n) => !auditReferenceOnly(request, n))
        .map((n) => [
          n,
          n === request.cards
            ? request.target
            : (request.targets?.[String(n)] ?? request.target),
        ]),
    ),
    model: JSON.parse(model),
    policy: JSON.parse(policy),
    eventOverrides,
    candidateFitOverrides,
    costs: Object.fromEntries(
      Object.entries(request.costs ?? {}).filter(([id]) =>
        request.mechanisms?.includes(id),
      ),
    ),
  };
}
export function draftFromAuditRequest(request: AuditRequest): AuditDraft {
  return {
    request: structuredClone(request),
    overrides: JSON.stringify(request.eventOverrides ?? [], null, 2),
    hardware: JSON.stringify(request.candidateFitOverrides ?? [], null, 2),
    model: JSON.stringify(request.model ?? {}, null, 2),
    policy: JSON.stringify(request.policy ?? {}, null, 2),
    allScales: (request.scales?.length ?? 0) > 1,
  };
}
