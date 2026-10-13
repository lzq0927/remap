import { auditReferenceMechanisms } from "../../contracts/src/audit-presets";
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export const gainExplanation =
  "每行是完整方案相对当前基线的可用度增量；单项与组合收益不能相加。方案收益为负，表示相对基线新增开销超过改善。";
export const contributionExplanation =
  "Shapley为负，表示在剩余候选的各种组合中平均边际贡献为负。区间跨零时，当前采样不能明确判断改善或下降。排名按均值排列，不能仅凭名次宣称显著优劣。";
export const interactionExplanation =
  "二阶交互为负，表示联合收益小于单项收益之和，不等于联合方案比基线差；二阶差分不包含全部高阶交互。";
export const conservationExplanation =
  "贡献之和应与同一批Shapley样本的组合总提升核对，不能要求与另一批主方案样本的总提升完全相同。检查使用未舍入数值，显示舍入可能产生微小差异。";

/** Reads frozen results only. Sorting and formatting do not recalculate or edit the model. */
export function auditCandidateScope(r: any, cards = r.request.cards) {
  const fixed: string[] =
    r.baseline?.mechanisms ?? r.request.baseline?.mechanisms ?? [];
  const selected: string[] = (
    r.request.mechanisms ?? auditReferenceMechanisms
  ).filter((id: string) => !fixed.includes(id));
  const a = r.attribution?.find((a: any) => a.cards === cards);
  const participants: string[] =
    a?.contributions?.map((c: any) => c.id) ?? selected;
  const exploratory: string[] = [
    ...new Set<string>(
      (r.rows ?? [])
        .filter(
          (row: any) =>
            row.cards === cards &&
            ![
              "base",
              "combined",
              "sdcStep",
              "hardware",
              ...fixed,
              ...participants,
            ].includes(row.id),
        )
        .map((row: any) => row.id),
    ),
  ];
  const name = (id: string) =>
    r.rows?.find((row: any) => row.id === id)?.name ??
    a?.contributions?.find((c: any) => c.id === id)?.name ??
    id;
  return {
    fixed: [...fixed],
    candidates: participants,
    exploratory,
    fixedNames: fixed.map(name),
    candidateNames: participants.map(name),
    exploratoryNames: exploratory.map(name),
  };
}
export function auditContributionView(r: any, cards = r.request.cards) {
  const a = r.attribution?.find((a: any) => a.cards === cards);
  const conditional = !!(
    r.baseline?.active ||
    r.request.baseline?.mechanisms?.length ||
    r.request.baseline?.resolvedEventIds?.length
  );
  const hours = r.request.hours;
  const rows = (a?.contributions ?? [])
    .filter((c: any) => finite(c.statistics?.mean))
    .map((c: any) => ({
      ...c,
      statistics: { ...c.statistics },
      hours: finite(hours) ? hours * c.statistics.mean : null,
    }))
    .sort(
      (x: any, y: any) =>
        y.statistics.mean - x.statistics.mean || x.id.localeCompare(y.id),
    );
  const empty = a?.coalitions?.find(
    (c: any) => c.mask === 0 || c.factors?.length === 0,
  );
  const full = a?.coalitions?.find(
    (c: any) =>
      c.mask === 2 ** rows.length - 1 || c.factors?.length === rows.length,
  );
  const baselineMean = finite(empty?.statistics.mean)
    ? empty.statistics.mean
    : finite(a?.baseline)
      ? a.baseline
      : null;
  const combinedMean = finite(full?.statistics.mean)
    ? full.statistics.mean
    : finite(a?.combined)
      ? a.combined
      : null;
  const gain = finite(a?.gain)
    ? a.gain
    : baselineMean !== null && combinedMean !== null
      ? combinedMean - baselineMean
      : null;
  const sum = rows.reduce((sum: number, c: any) => sum + c.statistics.mean, 0);
  const scope = auditCandidateScope(r, cards);
  return {
    cards,
    title: "组合贡献分摊" + (conditional ? " · 条件 Shapley" : " · Shapley"),
    conditional,
    rows,
    scope,
    baselineMean,
    combinedMean,
    gain,
    mainGain:
      r.rows?.find((row: any) => row.cards === cards && row.id === "combined")
        ?.delta?.mean ?? null,
    trials: a?.trials ?? null,
    subsetCount: a?.coalitions?.length ?? null,
    mainTrials: r.request.trials,
    mainSeed: r.request.seed,
    seed: r.request.attributionSeed ?? r.request.seed,
    sum,
    residual: gain === null ? null : sum - gain,
    windowLabel: finite(hours)
      ? `${hours}小时窗口${hours === 720 ? "（30天，按月折算）" : ""}`
      : "历史未记录窗口",
    unavailable: !scope.candidates.length
      ? "没有剩余候选机制；没有新增组合贡献需要分摊。"
      : r.request.attribution === false
        ? "本次未启用Shapley；不能由未计算推断贡献为零或收益可加。"
        : "当前规模未记录Shapley样本；仅使用已保存数据，不以其他规模或主方案结果补算。",
    interactions: a?.interactions ?? [],
    conditionalStep: a?.conditionalStep,
    nonAdditivity: a?.nonAdditivity ?? null,
  };
}
export function auditContributionSummary(
  v: ReturnType<typeof auditContributionView>,
) {
  const pct = (n: number | null) =>
    n === null ? "历史未记录" : (n * 100).toFixed(3) + "%";
  return `本节基线可用度 ${pct(v.baselineMean)}；本节组合可用度 ${pct(v.combinedMean)}；总提升 ${v.gain === null ? "未记录" : (v.gain * 100).toFixed(3) + " pp"}。参与机制 ${v.rows.length}项；子集 ${v.subsetCount ?? "未记录"}个；每子集 ${v.trials ?? "未记录"}条轨迹；${v.windowLabel}。指标为可用度。`;
}
export function auditContributionEvidence(r: any, cards: number) {
  const v = auditContributionView(r, cards);
  const name = (id: string) =>
    r.rows?.find((row: any) => row.id === id)?.name ?? id;
  const pp = (x: number) => (x * 100).toFixed(6) + " pp";
  return {
    paragraphs: [
      conservationExplanation,
      `主方案采样：${v.mainTrials ?? "未记录"}条/方案，种子${v.mainSeed ?? "未记录"}；Shapley采样：${v.trials ?? "未记录"}条/子集，种子${v.seed ?? "未记录"}。主方案提升${v.mainGain === null ? "未记录" : pp(v.mainGain)}；本批Shapley提升${v.gain === null ? "未记录" : pp(v.gain)}。`,
      `未舍入贡献合计${v.sum}；未舍入本批总提升${v.gain ?? "未记录"}；残差${v.residual === null ? "未记录" : v.residual.toExponential(6)}；${v.residual === null ? "无法核对" : Math.abs(v.residual) < 1e-10 ? "守恒检查通过" : "守恒检查未通过"}。`,
      "检测与恢复存在条件依赖：step可能依赖静默检测，单独收益为零仍可能获得组合贡献。Shapley加入顺序不代表物理恢复顺序。",
      "原始基线已包含常规CKPT与人工兜底，不参与新增收益分摊。额外已部署机制固定在每个候选组合中，不重复计新增收益和成本。",
      ...(v.conditionalStep
        ? [
            `在当前固定基线上增加静默检测后，step额外提升${pp(v.conditionalStep.mean)}，95%区间${pp(v.conditionalStep.ciLow)} ～ ${pp(v.conditionalStep.ciHigh)}；使用主方案样本。`,
          ]
        : []),
      interactionExplanation,
      ...(r.assumptions ?? []),
      ...(r.warnings ?? []),
      "全子集枚举和采样区间不能覆盖参数、证据或模型误差；具体机制前置条件、失败回退、证据和冻结参数见机制审核及输入快照。",
    ],
    tables: [
      {
        heads: ["机制对", "基线二阶交互", "95%区间"],
        rows: v.interactions.map((i: any) => [
          name(i.a) + " + " + name(i.b),
          pp(i.statistics.mean),
          pp(i.statistics.ciLow) + " ～ " + pp(i.statistics.ciHigh),
        ]),
      },
      {
        heads: ["机制", "冻结参数", "参数证据", "前置条件与失败回退"],
        rows: [...v.scope.fixed, ...v.scope.candidates].map((id) => {
          const m = r.mechanisms?.find((m: any) => m.scenario === id);
          return [
            name(id),
            JSON.stringify(r.config?.policy?.[m?.id] ?? m?.parameters) ??
              "历史未记录",
            m?.confidence ?? "历史未记录",
            [m?.prerequisite, m?.failure].filter(Boolean).join("；") ||
              "历史未记录",
          ];
        }),
      },
    ],
  };
}
