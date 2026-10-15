/** Presentation metadata: scenario presets never define how many mechanisms a study must use. */
export const auditMechanismCodes: Record<string, string> = {
  hardDetect: "D-HARD",
  slowDetect: "D-SLOW",
  sdcDetect: "D-SDC",
  step: "R-SDC",
  replay: "R-REPLAY",
  process: "R-PROCESS",
  elastic: "R-ELASTIC",
  fast: "C-FAST",
};
export const auditMechanismNames: Record<string, string> = {
  hardDetect: "中断检测",
  slowDetect: "亚健康检测",
  sdcDetect: "静默检测",
  step: "干净step恢复",
  replay: "重执行",
  process: "进程恢复",
  elastic: "弹性恢复",
  fast: "检查点策略",
};
const capabilities: Record<string, string> = {
  hardDetect: "检测",
  slowDetect: "检测",
  sdcDetect: "检测",
  step: "恢复",
  replay: "恢复",
  process: "恢复",
  elastic: "恢复",
  fast: "检查点",
};
export function auditMechanismSummary(
  request: {
    mechanisms?: string[];
    baseline?: { mechanisms?: string[] };
  },
  selection?: { candidates: string[]; deployed: string[] },
) {
  const deployed = [
    ...new Set(selection?.deployed ?? request.baseline?.mechanisms ?? []),
  ];
  const candidates = [
    ...new Set(selection?.candidates ?? request.mechanisms ?? []),
  ].filter((id) => !deployed.includes(id));
  const ids = [...deployed, ...candidates];
  const features = [
    ...new Set(ids.map((id) => capabilities[id] ?? "其他能力")),
  ];
  return {
    ids,
    deployed,
    candidates,
    count: ids.length,
    features,
    names: ids.map((id) => auditMechanismNames[id] ?? id),
    title: ids.length
      ? `已选${ids.length}项措施 · ${features.join("、")}`
      : "基础模型 · 未选附加措施",
    roles: `固定部署${deployed.length}项 · 组合候选${candidates.length}项`,
  };
}
