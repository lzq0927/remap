import { auditReferenceMechanisms } from "../../contracts/src/audit-presets";
import { parameterLabels } from "./audit-labels";

export function auditSelectedMechanisms(r: any) {
  const ids: string[] = [
    ...new Set<string>([
      ...(r.request.baseline?.mechanisms ?? []),
      ...(r.request.mechanisms ?? auditReferenceMechanisms),
    ]),
  ];
  const codes: Record<string, string> = {
    hardDetect: "D-HARD",
    slowDetect: "D-SLOW",
    sdcDetect: "D-SDC",
    step: "R-SDC",
    replay: "R-REPLAY",
    process: "R-PROCESS",
    elastic: "R-ELASTIC",
    fast: "C-FAST",
  };
  return ids.map((id) => {
    const code = codes[id];
    const mechanism = r.mechanisms?.find((m: any) => m.id === code);
    const parameters = r.config.policy[code] ?? mechanism?.parameters ?? {};
    return {
      id,
      code,
      name:
        r.rows.find((row: any) => row.id === id)?.name ?? mechanism?.name ?? id,
      parameters: Object.entries(parameters)
        .map(([key, value]) => {
          const probability =
            ["coverage", "success"].includes(key) && typeof value === "number";
          const label = (parameterLabels[key] ?? key).replace("（0–1）", "");
          return `${label}：${probability ? `${((value as number) * 100).toLocaleString("zh-CN", { maximumFractionDigits: 6 })}%` : value}`;
        })
        .join("；"),
    };
  });
}
export function auditSamplingDescription(r: any) {
  const c = r.referenceComparison;
  const main = r.request.trials;
  const attribution = r.attribution?.[0]?.trials;
  const scan = r.sensitivity?.[0];
  const low =
    main < 4000 ||
    (attribution !== undefined && attribution < 2000) ||
    (scan && (scan.trials ?? main) < 2000);
  const label =
    c?.label ??
    (low ? "快速试算 / 低采样结果" : "历史审核配置（未记录复现核对）");
  return `${label}；主场景 ${main} 条轨迹，Shapley ${attribution === undefined ? "未计算" : `${attribution} 条 / 子集`}，敏感性 ${scan ? `${scan.trials ?? main} 条 / 点，${scan.cards.toLocaleString("zh-CN")} 卡，${r.sensitivity.length} 个点` : "未计算"}。${low ? "结果用于方向判断；不能作为专家原报告复现或正式达标确认。" : "区间仅反映采样误差，仍需真实数据和工程验证。"}`;
}
