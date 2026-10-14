import source from "../../../references/新可靠性机制库-单点量化交付包/新可靠性机制库-单点量化.json";

export type ExtensionParameter = {
  label: string;
  min: number;
  max: number;
  value: number | null;
};
const fraction = (
  label: string,
  value: number | null = null,
): ExtensionParameter => ({ label, min: 0, max: 1, value });
const seconds = (label: string, value: number): ExtensionParameter => ({
  label,
  min: 0,
  max: 31536000,
  value,
});
const parameterSets: Record<string, Record<string, ExtensionParameter>> = {
  "R-LINK-LOCAL": { pauseSeconds: seconds("成功时完整停顿（秒）", 2) },
  "R-FABRIC-DEGRADE": {
    pauseSeconds: seconds("切换完整停顿（秒）", 2),
    communicationFraction: fraction("暴露通信比例", 0.3),
    bandwidthRatio: { label: "剩余带宽比例", min: 0.001, max: 1, value: 0.75 },
    repairSeconds: seconds("降级持续时间（秒）", 1800),
  },
  "I-CONTAIN": {},
  "H-CONTROL-CONTINUITY": { pauseSeconds: seconds("业务停顿（秒）", 1) },
  "R-WARM-PROCESS": { stageSeconds: seconds("启动阶段目标（秒）", 20) },
  "R-RUNTIME-SNAPSHOT": { stageSeconds: seconds("启动阶段目标（秒）", 15) },
  "C-ASYNC": {
    blockSeconds: seconds("保存阻塞（秒）", 1),
    durableLagSeconds: seconds("额外持久化滞后（秒）", 10),
  },
  "C-LOSSLESS": {
    compressionRatio: { label: "无损压缩比", min: 0.01, max: 100, value: 2 },
    decompressSeconds: seconds("解压耗时（秒）", 10),
  },
  "D-RECOVERY-CLASSIFY": {
    manualProbability: fraction("匹配成功后的人工介入概率", 0.001),
  },
  "D-SDC-FP8": {
    coverage: fraction("适用精度子集检出率", 0.95),
    detectSeconds: seconds("检测耗时（秒）", 1),
  },
  "D-SDC-FP4": {
    coverage: fraction("适用精度子集检出率", 0.95),
    detectSeconds: seconds("检测耗时（秒）", 1),
  },
  "D-ABFT": { coverage: fraction("上游漏检后的条件检出率", 0.9) },
  "D-NET-SDC": {
    coverage: fraction("网络适用子集检出率", 0.95),
    detectSeconds: seconds("检测耗时（秒）", 1),
  },
  "H-SDC-SCREEN": { reduction: fraction("适用残余 FIT 降低比例", 0.25) },
  "R-HCCL-ELASTIC": { stageSeconds: seconds("通信重建阶段目标（秒）", 15) },
  "R-CANN-GRAPH": { stageSeconds: seconds("图准备子阶段目标（秒）", 7.5) },
};
export const mechanismStages: Record<string, string> = {
  before: "发生前",
  during: "发生时",
  after: "发生后",
  fallback: "恢复失败",
};
export const existingMechanismClasses: Record<
  string,
  { effect: string; stage: string }
> = {
  hardDetect: { effect: "缩短 MTTR · 检测等待", stage: "during" },
  slowDetect: { effect: "缩短 MTTR · 亚健康持续", stage: "during" },
  sdcDetect: { effect: "减少污染损失 · 检测", stage: "during" },
  step: { effect: "缩短 MTTR / 减少回滚", stage: "after" },
  replay: { effect: "缩短 MTTR / 避免回滚", stage: "after" },
  process: { effect: "缩短 MTTR · 进程恢复", stage: "after" },
  elastic: { effect: "缩短等效恢复损失 · 局部隔离", stage: "after" },
  fast: { effect: "减少回滚 / 权衡保存开销", stage: "before" },
};
export const auditExtensionCatalog = source.mechanisms.map((m) => {
  const stage = ["H-SDC-SCREEN", "C-ASYNC", "I-CONTAIN"].includes(m.id)
    ? "before"
    : m.id === "D-RECOVERY-CLASSIFY"
      ? "fallback"
      : m.id.startsWith("D-")
        ? "during"
        : "after";
  const detection = m.id.startsWith("D-") && m.id !== "D-RECOVERY-CLASSIFY";
  return {
    ...m,
    stage,
    effect:
      m.id === "H-SDC-SCREEN"
        ? "降低 FIT / 提高 MTBF"
        : detection
          ? "减少污染损失 · 检测"
          : m.id === "C-ASYNC"
            ? "减少保存阻塞 / 增加持久化暴露"
            : "缩短 MTTR / 减少进度损失",
    sources: m.sourceIds.map(
      (id) =>
        (source.sources as Record<string, { title: string; url: string }>)[id],
    ),
    parameters: {
      eligibleShare: fraction(
        m.id === "D-SDC-FP8" || m.id === "D-SDC-FP4"
          ? "CORE 静默风险中本精度占比（非 FLOP 占比）"
          : "候选事件中的适用比例",
      ),
      success: fraction("适用条件下执行成功率"),
      failureSeconds: seconds("失败尝试额外耗时（秒）", 0),
      overhead: fraction("正常计算吞吐开销", m.id === "D-ABFT" ? 0.001 : null),
      ...parameterSets[m.id],
    } as Record<string, ExtensionParameter>,
  };
});
export interface AuditExtensionInput {
  id: string;
  parameters: Record<string, number>;
  source: string;
  evidence: "scenario" | "external-prior" | "internal-measured";
}
/** Explicit scenario, never a measured default or silently deployed protection. */
export function extensionScenario(id: string): AuditExtensionInput {
  const m = auditExtensionCatalog.find((item) => item.id === id);
  if (!m) throw new Error("未知扩展机制 " + id);
  return {
    id,
    parameters: Object.fromEntries(
      Object.entries(m.parameters).map(([key, p]) => [
        key,
        p.value ??
          (key === "eligibleShare"
            ? id === "D-SDC-FP8" || id === "D-SDC-FP4"
              ? 0.5
              : 1
            : key === "success"
              ? 0.95
              : 0),
      ]),
    ),
    source:
      "专家单点目标＋探索假设：适用比例与成功率非实测；未提供开销暂按0作情景分析，需验收替换",
    evidence: "scenario",
  };
}
export function validateExtensions(input: AuditExtensionInput[] = []) {
  if (
    !Array.isArray(input) ||
    input.length > 16 ||
    new Set(input.map((m) => m.id)).size !== input.length
  )
    throw new Error("扩展机制必须为最多16项且ID不重复");
  for (const item of input) {
    const m = auditExtensionCatalog.find((entry) => entry.id === item.id);
    if (
      !m ||
      !item.source?.trim() ||
      !["scenario", "external-prior", "internal-measured"].includes(
        item.evidence,
      )
    )
      throw new Error("扩展机制需要有效ID、来源和证据类型");
    if (
      !item.parameters ||
      Object.keys(item.parameters).length !== Object.keys(m.parameters).length
    )
      throw new Error(
        m.name + "：需填写完整适用比例、成功率、失败耗时、开销及机制参数",
      );
    for (const [key, value] of Object.entries(item.parameters)) {
      const p = m.parameters[key];
      if (!p || !Number.isFinite(value) || value < p.min || value > p.max)
        throw new Error(m.name + "：参数 " + (p?.label ?? key) + " 越界或缺失");
    }
  }
  const precisionShare = input
    .filter((m) => ["D-SDC-FP8", "D-SDC-FP4"].includes(m.id))
    .reduce((sum, m) => sum + m.parameters.eligibleShare, 0);
  if (precisionShare > 1 + 1e-10)
    throw new Error("FP8 与 FP4 的 CORE 静默风险占比必须互斥且合计不超过100%");
}
