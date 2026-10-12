import sourceConfig from "../../../references/expert-review-2026-10-09/config.json";
import sourcePolicy from "../../../references/expert-review-2026-10-09/mechanism-policy.json";
import {
  auditReferenceScales,
  auditReferenceMechanisms,
  auditSamplingPreset,
} from "../../contracts/src/audit-presets";
import type { AuditRequest } from "./audit";

/** A profile name is intent; only the actual frozen configuration establishes reproduction. */
export function auditReferenceComparison(
  request: AuditRequest,
  resolved: {
    model: Record<string, number>;
    policy: Record<string, Record<string, number>>;
    mechanisms: string[];
    recoveryOrder: string[];
    scales: number[];
    attributionTrials: number;
    sensitivityCards: number;
    sensitivityTrials: number;
  },
) {
  const preset = auditSamplingPreset("expert-reproduction");
  const differences: string[] = [];
  const check = (ok: boolean, label: string) => {
    if (!ok) differences.push(label);
  };
  check(request.trials === preset.trials, "主场景轨迹数不是4000");
  check(
    request.attribution !== false &&
      resolved.attributionTrials === preset.attributionTrials,
    "Shapley未启用或每子集不是2000条轨迹",
  );
  check(
    request.sensitivity !== false &&
      resolved.sensitivityTrials === preset.sensitivityTrials,
    "敏感性未启用或每点不是2000条轨迹",
  );
  check(request.seed === preset.seed, "主场景种子不同");
  check(
    request.rateArithmetic === "expert-reference",
    "故障率计算未采用专家原始顺序",
  );
  check(
    (request.attributionSeed ?? request.seed) === preset.attributionSeed,
    "Shapley种子不同",
  );
  check(
    (request.sensitivitySeed ?? request.seed) === preset.sensitivitySeed,
    "敏感性种子不同",
  );
  check(
    request.confidenceMethod === preset.confidenceMethod,
    "置信区间不是1.96正态近似",
  );
  check(
    request.sensitivityMode === "expert-reproduction" &&
      resolved.sensitivityCards === 500000,
    "敏感性不是50万卡原始13点扫描",
  );
  check(request.hours === sourceConfig.horizonHours, "窗口不是720小时");
  check(
    resolved.scales.length === 5 &&
      auditReferenceScales.every((n) => resolved.scales.includes(n)),
    "主结果规模不同",
  );
  check(
    resolved.mechanisms.length === 6 &&
      auditReferenceMechanisms.every((id) => resolved.mechanisms.includes(id)),
    "组合不是专家六项措施",
  );
  check(
    resolved.recoveryOrder.join(",") === "replay,elastic,process",
    "物理恢复顺序不同",
  );
  check(
    Object.entries(request.model ?? {}).every(
      ([k, v]) => v === (sourceConfig as any)[k],
    ),
    "基线参数已修改",
  );
  check(
    Object.entries(sourcePolicy).every(([id, params]) =>
      Object.entries(params).every(([k, v]) => resolved.policy[id][k] === v),
    ),
    "机制参数已修改",
  );
  check(
    !request.eventOverrides?.length && !request.candidateFitOverrides?.length,
    "事件证据或FIT已更新",
  );
  const lowSample =
    request.trials < 4000 ||
    (request.attribution !== false && resolved.attributionTrials < 2000) ||
    (request.sensitivity !== false && resolved.sensitivityTrials < 2000);
  return {
    matchesReference: !differences.length,
    label: !differences.length
      ? "专家原始配置复现"
      : lowSample
        ? "快速试算 / 低采样结果"
        : "自定义审核配置",
    differences,
    mainTrials: request.trials,
    attributionTrials: resolved.attributionTrials,
    sensitivityTrials: resolved.sensitivityTrials,
    sensitivityCards: resolved.sensitivityCards,
    seeds: {
      main: request.seed,
      attribution: request.attributionSeed ?? request.seed,
      sensitivity: request.sensitivitySeed ?? request.seed,
    },
    confidenceMethod: request.confidenceMethod ?? "student-t",
  };
}
