import type { AuditSource } from "./audit-experiments";
import { auditReferenceOnly } from "../../contracts/src/audit-presets";
export function planningWork(
  source: AuditSource,
  scales: number[],
  trials: number,
) {
  const primary = 360 * trials + Math.min(1024, source.input.trials) * 32;
  const curve = 7 * Math.min(256, source.input.trials) * scales.length;
  const demands = source.result.rows
    .filter(
      (r: any) =>
        r.id === "combined" && !auditReferenceOnly(source.input, r.cards),
    )
    .map((r: any) => r.cards);
  const trajectories = primary * scales.length + curve * demands.length;
  const exposure =
    primary * scales.reduce((s, n) => s + n, 0) +
    curve * demands.reduce((s: number, n: number) => s + n, 0);
  const fit = source.result.events.reduce((s: number, e: any) => s + e.fit, 0);
  return { trajectories, events: (exposure * source.input.hours * fit) / 1e9 };
}
