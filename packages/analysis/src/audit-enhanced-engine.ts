import { createRequire } from "node:module";
import {
  auditExtensionCatalog,
  validateExtensions,
  type AuditExtensionInput,
} from "../../contracts/src/audit-extensions";
import type { AuditEventView } from "../../contracts/src/audit-objects";
const engineFactory = createRequire(import.meta.url)(
  "../../solvers/src/vendor/review-engine.cjs",
);

/** Extensions act on explicit residual events and stages, never on aggregate output scores. */
export function createEnhancedAuditEngine(
  events: AuditEventView[],
  policy: Record<string, any>,
  model: Record<string, any>,
  extensions: AuditExtensionInput[] = [],
) {
  validateExtensions(extensions);
  const resolved = extensions.map((input) => ({
    ...input,
    eventIds: auditExtensionCatalog.find((m) => m.id === input.id)!
      .eventCandidates as string[],
  }));
  const screen = resolved.find((m) => m.id === "H-SDC-SCREEN");
  const actualEvents = events.map((event) => ({
    ...event,
    fit: screen?.eventIds.includes(event.id)
      ? event.fit *
        (1 -
          screen.parameters.eligibleShare *
            screen.parameters.success *
            screen.parameters.reduction)
      : event.fit,
  }));
  return engineFactory(actualEvents, policy, {
    ...model,
    ...(extensions.length
      ? { extensions: resolved, referenceRateArithmetic: false }
      : {}),
  });
}
