import type { AuditArchitectureDiagnosis } from "../../analysis/src/audit-architecture";
import { lineChart } from "./audit-charts";

export const summaryColors = [
  "#237b6a",
  "#b47a36",
  "#7760a1",
  "#b34f65",
  "#377faa",
  "#6a813d",
  "#7a7371",
  "#42a1a0",
  "#ad6f9b",
  "#526487",
];
export const summaryEscape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const summaryNumber = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : (Math.abs(v) < 1e-9 ? 0 : v).toLocaleString("zh-CN", {
        maximumFractionDigits:
          Math.abs(v) > 1e-9 && Math.abs(v) < 0.001 ? 6 : digits,
      });
const esc = summaryEscape,
  num = summaryNumber;
export const summaryScaleLabel = (n: number) =>
  n >= 10000 ? num(n / 10000) + "万卡" : num(n) + "卡";
const label = summaryScaleLabel;
const pct = (v: number) => num(v * 100) + "%";
const fixed = (v: number) => ({ mean: v, ciLow: v, ciHigh: v });
export function orderedDiagnosisScales(
  d: AuditArchitectureDiagnosis,
  includeReference = false,
) {
  return d.scales
    .filter((s) => includeReference || !s.referenceOnly)
    .slice()
    .sort(
      (a, b) =>
        Number(a.referenceOnly) - Number(b.referenceOnly) || a.cards - b.cards,
    );
}
export function architectureTrend(
  d: AuditArchitectureDiagnosis,
  nodeId?: string,
) {
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  const node = d.architecture.nodes.find((n) => n.id === nodeId) ?? root;
  const scales = orderedDiagnosisScales(d);
  const overall = node.id === root.id;
  if (!scales.length)
    return '<p class="note">本次只有参考规模，没有设置需求目标。</p>';
  const recorded = (d as AuditArchitectureDiagnosis & { hours?: number }).hours;
  const scale =
    scales.find((s) => s.allowedHours !== null && s.target < 1) ?? scales[0];
  const horizon =
    recorded ??
    (scale.allowedHours !== null && scale.target < 1
      ? scale.allowedHours / (1 - scale.target)
      : scale.actualHours > 0 && scale.statistics.mean < 1
        ? scale.actualHours / (1 - scale.statistics.mean)
        : 1);
  const targets = scales.flatMap((s) => {
    const n = s.nodes.find((n) => n.id === node.id)!;
    return overall
      ? [{ x: s.cards, statistics: fixed(s.target) }]
      : n.allowedHours === null
        ? []
        : [{ x: s.cards, statistics: fixed(n.allowedHours / horizon) }];
  });
  const chart = lineChart({
    title: overall
      ? "各规模可用度目标与现状趋势"
      : node.name + " · 目标损失与实际损失趋势",
    series: [
      {
        name: overall ? "可用度目标" : "允许损失",
        color: "#b14f50",
        dashed: true,
        points: targets,
      },
      {
        name: overall ? "本轮可用度" : "实际损失",
        color: "#237b6a",
        points: scales.map((s) => ({
          x: s.cards,
          statistics: overall
            ? s.statistics
            : fixed(s.nodes.find((n) => n.id === node.id)!.lossFraction),
        })),
      },
    ],
    xLabel: "需求规模 / 卡 · 按实际卡数",
    formatX: label,
    yLabel: overall ? "可用度" : "系统可用度损失 / 百分点",
    formatY: overall ? pct : (v) => num(v * 100) + " pp",
    showIntervals: overall,
    note: overall
      ? "各规模使用自己的目标；连线仅连接已计算点，细线为均值95%采样区间。参考规模另列，不参与需求排序或达标判定。"
      : "该层目标是允许造成的系统损失，不是模块自身可用度。预算与实际均按同一窗口归一化；未采集分层置信区间，连线不代表中间规模已验证。",
  });
  return `<div data-summary-chart="availability-trend">${chart}<div class="table-wrap"><table><thead><tr><th>规模</th><th>${overall ? "可用度目标" : "允许损失 / pp"}</th><th>${overall ? "本轮可用度" : "实际损失 / pp"}</th><th>${overall ? "距目标 / pp（目标−本轮）" : "超出预算 / pp"}</th></tr></thead><tbody>${scales
    .map((s) => {
      const n = s.nodes.find((n) => n.id === node.id)!;
      const gap = overall
        ? s.target - s.statistics.mean
        : n.excessHours === null
          ? null
          : n.excessHours / horizon;
      return `<tr><th>${label(s.cards)}</th><td>${overall ? pct(s.target) : n.allowedHours === null ? "未分配" : num((n.allowedHours / horizon) * 100)}</td><td>${overall ? pct(s.statistics.mean) : num(n.lossFraction * 100)}</td><td>${gap === null ? "未分配" : (gap > 0 ? "+" : "") + num(gap * 100)}</td></tr>`;
    })
    .join("")}</tbody></table></div></div>`;
}

export function architectureTargetBreakdown(
  d: AuditArchitectureDiagnosis,
  parentId?: string,
) {
  const parent =
    d.architecture.nodes.find((n) => n.id === parentId) ??
    d.architecture.nodes.find((n) => !n.parentId)!;
  const children = d.architecture.nodes.filter((n) => n.parentId === parent.id);
  const nodes = children.length ? children : [parent],
    scales = orderedDiagnosisScales(d);
  return `<div class="scale-target-breakdown" data-budget-parent="${esc(parent.id)}"><h4>${esc(parent.name)} · 分层目标分解</h4><p class="note">同级允许损失之和等于上级预算；父层与子层不重复相加。每格为允许损失 / 实际损失（等效计算小时），目标由本次${esc({ none: "暂不分配", equal: "同级均分", weighted: "设计权重", agree: "AGREE损失预算适配" }[d.architecture.budgetMethod])}得到，不改变现状FIT和措施。</p><div class="table-wrap"><table><thead><tr><th>下级对象</th>${scales.map((s) => `<th>${label(s.cards)}</th>`).join("")}</tr></thead><tbody>${nodes
    .map(
      (n) =>
        `<tr><th>${esc(n.name)}</th>${scales
          .map((s) => {
            const x = s.nodes.find((v) => v.id === n.id)!;
            const incomplete = x.dataStatus && x.dataStatus !== "modeled";
            return `<td class="${x.excessHours === null || incomplete ? "pending" : x.excessHours > 0 ? "gap" : "within"}"><b>${num(x.allowedHours)} / ${x.dataStatus === "unknown" ? "待补充" : num(x.actualHours)} h</b><small>${incomplete ? "故障数据不完整；已知损失仅作参照" : x.excessHours === null ? "未分配" : (x.excessHours > 0 ? "超出 " : "余量 ") + num(Math.abs(x.excessHours)) + " h"}</small></td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div></div>`;
}

/** An explicit diagnostic reference, not an inferred physical availability requirement. */
export function faultModeGapRows(d: AuditArchitectureDiagnosis) {
  return orderedDiagnosisScales(d).map((scale) => {
    const rows = scale.nodes
      .filter((n) => n.leaf && n.kind !== "overhead")
      .flatMap((n) => {
        const total = n.drivers.reduce((s, e) => s + e.fit, 0);
        const drivers = n.drivers.length
          ? n.drivers
          : [
              {
                id: "unmodeled:" + n.id,
                name: n.name,
                type: "unknown",
                fit: 0,
                lossHours: 0,
                source: n.source,
                evidence: "故障数据待补充",
              },
            ];
        return drivers.map((e) => {
          const allowedHours =
            n.allowedHours === null
              ? null
              : n.allowedHours * (total ? e.fit / total : 1 / drivers.length);
          return {
            ...e,
            layerId: n.id,
            layerName: n.name,
            allowedHours,
            excessHours:
              allowedHours === null || e.type === "unknown"
                ? null
                : e.lossHours - allowedHours,
          };
        });
      })
      .sort(
        (a, b) =>
          (b.excessHours ?? b.lossHours) - (a.excessHours ?? a.lossHours) ||
          a.id.localeCompare(b.id),
      );
    let knownRank = 0;
    return {
      cards: scale.cards,
      rows: rows.map((r) => ({
        ...r,
        rank: r.type === "unknown" ? 0 : ++knownRank,
      })),
    };
  });
}
export function faultModeGapSummary(d: AuditArchitectureDiagnosis, limit = 5) {
  const scales = faultModeGapRows(d);
  const unknownIds = [
    ...new Set(
      scales.flatMap((s) =>
        s.rows.filter((r) => r.type === "unknown").map((r) => r.id),
      ),
    ),
  ];
  const reserved = unknownIds.length
    ? `<details class="arch-evidence"><summary>未建模对象的预留预算（${unknownIds.length}项）</summary><p class="note">这些预算尚无故障模型对应，不计为可用余量，也不进入薄弱点已知损失排名。</p><div class="table-wrap"><table><thead><tr><th>对象</th>${scales.map((s) => `<th>${label(s.cards)} / h</th>`).join("")}</tr></thead><tbody>${unknownIds.map((id) => `<tr><th>${esc(scales[0].rows.find((r) => r.id === id)?.layerName ?? id)}</th>${scales.map((s) => `<td>${num(s.rows.find((r) => r.id === id)?.allowedHours)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`
    : "";
  const ids = [
    ...new Set(
      scales.flatMap((s) =>
        s.rows
          .filter((r) => r.lossHours > 1e-12 || (r.excessHours ?? 0) > 1e-12)
          .slice(0, limit)
          .map((r) => r.id),
      ),
    ),
  ];
  return `<div class="arch-chart fault-gap-summary" data-summary-chart="fault-gaps"><h3>故障模式的细分差距与排名</h3><p class="note">汇集各需求规模前${limit}项，单元格按本规模分别排名。叶层预算按本叶层FIT份额分到故障模式，仅作诊断参照；保存与检测开销另列，零观测不代表零风险。</p>${reserved}${
    ids.length
      ? `<div class="table-wrap"><table><thead><tr><th>故障模式 / 归属</th>${scales.map((s) => `<th>${label(s.cards)}</th>`).join("")}</tr></thead><tbody>${ids
          .map((id) => {
            const sample = scales
              .flatMap((s) => s.rows)
              .find((r) => r.id === id)!;
            return `<tr><th>${esc(id)}<small>${esc(sample.layerName)}</small></th>${scales
              .map((s) => {
                const r = s.rows.find((r) => r.id === id);
                return r
                  ? `<td data-fault-id="${esc(id)}" data-cards="${s.cards}" data-rank="${r.rank}" class="${r.excessHours === null ? "pending" : r.excessHours > 0 ? "gap" : "within"}"><b>#${r.rank} · ${r.excessHours === null ? "未分配" : (r.excessHours > 0 ? "+" : "") + num(r.excessHours) + " h"}</b><small>实际 ${num(r.lossHours)} / 预算 ${num(r.allowedHours)} h</small><small>FIT ${num(r.fit, 6)}</small></td>`
                  : "<td>本规模未记录</td>";
              })
              .join("")}</tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<p class="note">本次样本未观察到可排序的故障损失；公共开销仍见损失时间图。</p>'
  }</div>`;
}

export const lossLabels: Record<string, string> = {
  downtime: "恢复停机",
  save: "保存阻塞",
  rollback: "回滚重算",
  terminalInvalid: "期末污染",
  slowdown: "亚健康降速",
  localLoss: "局部容量损失",
  mechanismOverhead: "检测与机制开销",
};
export function lossTimeSegments(
  d: AuditArchitectureDiagnosis,
  mode: "loss" | "layer" | "type" = "loss",
) {
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  return orderedDiagnosisScales(d).map((scale) => {
    const overall = scale.nodes.find((n) => n.id === root.id)!;
    const segments =
      mode === "loss"
        ? Object.entries(lossLabels).map(([id, name]) => ({
            id,
            name,
            hours: overall.loss[id] ?? 0,
          }))
        : mode === "layer"
          ? d.architecture.nodes
              .filter((n) => n.parentId === root.id)
              .map((n) => ({
                id: n.id,
                name: n.name,
                hours: scale.nodes.find((x) => x.id === n.id)!.actualHours,
              }))
          : [
              ...["hard", "slow", "sdc"].map((type) => ({
                id: type,
                name: (
                  {
                    hard: "中断故障",
                    slow: "亚健康故障",
                    sdc: "静默故障",
                  } as Record<string, string>
                )[type],
                hours: scale.nodes
                  .filter((n) => n.leaf)
                  .flatMap((n) => n.drivers)
                  .filter((e) => e.type === type)
                  .reduce((s, e) => s + e.lossHours, 0),
              })),
              { id: "save", name: lossLabels.save, hours: overall.loss.save },
              {
                id: "mechanismOverhead",
                name: lossLabels.mechanismOverhead,
                hours: overall.loss.mechanismOverhead,
              },
            ];
    return {
      cards: scale.cards,
      allowedHours: scale.allowedHours,
      totalHours: scale.actualHours,
      segments,
    };
  });
}
export function lossTimeDistribution(
  d: AuditArchitectureDiagnosis,
  mode: "loss" | "layer" | "type" = "loss",
) {
  const rows = lossTimeSegments(d, mode);
  if (!rows.length) return "";
  const keys = rows[0].segments,
    max = Math.max(
      1e-9,
      ...rows.map((r) => Math.max(r.totalHours, r.allowedHours ?? 0)),
    );
  const width = 1000,
    left = 160,
    plotWidth = 690,
    top = 42,
    rowHeight = 64,
    height = top + rows.length * rowHeight + 62;
  const X = (h: number) => left + (h / max) * plotWidth;
  const lines = rows
    .map((r, i) => {
      const y = top + i * rowHeight;
      let cumulative = 0;
      return `<g data-loss-cards="${r.cards}" data-total-hours="${r.totalHours}"><text x="145" y="${y + 20}" text-anchor="end">${label(r.cards)}</text><text x="145" y="${y + 39}" text-anchor="end" class="loss-small">预算 ${num(r.allowedHours)} h</text>${r.segments
        .map((s, j) => {
          const start = cumulative;
          cumulative += s.hours;
          return s.hours > 0
            ? `<rect data-loss-key="${esc(s.id)}" data-hours="${s.hours}" x="${X(start).toFixed(3)}" y="${y}" width="${((s.hours / max) * plotWidth).toFixed(3)}" height="30" fill="${summaryColors[j % summaryColors.length]}"><title>${label(r.cards)} · ${esc(s.name)}：${num(s.hours)} h，${num((s.hours / Math.max(1e-12, r.totalHours)) * 100)}%</title></rect>`
            : "";
        })
        .join(
          "",
        )}${r.allowedHours === null ? "" : `<path d="M${X(r.allowedHours).toFixed(3)},${y - 5}v40" stroke="#af414a" stroke-width="2" stroke-dasharray="4 3"><title>允许损失 ${num(r.allowedHours)} h</title></path>`}<text x="${Math.max(870, X(r.totalHours) + 10).toFixed(2)}" y="${y + 20}" font-weight="600">${num(r.totalHours)} h</text></g>`;
    })
    .join("");
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = (max * i) / 4;
    return `<text x="${X(v)}" y="${height - 33}" text-anchor="middle">${num(v)} h</text>`;
  }).join("");
  return `<figure class="reliability-chart" data-summary-chart="loss-time"><h3>不同规模的损失时间分布</h3><div class="reliability-legend">${keys.map((s, i) => `<span><i style="background:${summaryColors[i % summaryColors.length]}"></i>${esc(s.name)}</span>`).join("")}<span>红虚线：允许损失预算</span></div><div class="reliability-plot" tabindex="0"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="不同规模的损失时间分布"><title>不同规模的损失时间分布</title>${lines}${ticks}<text x="505" y="${height - 6}" text-anchor="middle">损失时间 / 等效计算小时</text></svg></div><details class="arch-evidence"><summary>查看损失时间明细（小时）</summary><div class="table-wrap"><table><thead><tr><th>规模</th><th>允许损失</th><th>总损失</th>${keys.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr><th>${label(r.cards)}</th><td>${num(r.allowedHours)}</td><td>${num(r.totalHours)}</td>${r.segments.map((s) => `<td>${num(s.hours)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details><figcaption>每条横柱只汇总本规模互斥损失，同一刻度比较规模差异；父子层不重复相加，保存与检测开销独立计入。柱长是模型评估的等效损失时间，不是物理修复MTTR。</figcaption></figure>`;
}

export function contributionRankSummary(d: AuditArchitectureDiagnosis) {
  const scales = orderedDiagnosisScales(d).filter((s) => s.ranking.length);
  if (!scales.length)
    return '<p class="note">本次未计算Shapley，不能生成贡献排序。</p>';
  const ids = [
    ...new Set<string>(scales.flatMap((s) => s.ranking.map((r: any) => r.id))),
  ];
  const rankings = scales.map((s) => ({
    cards: s.cards,
    rows: s.ranking
      .slice()
      .sort((a: any, b: any) => b.statistics.mean - a.statistics.mean)
      .map((c: any, _i: number, all: any[]) => ({
        ...c,
        rank:
          all.findIndex(
            (other) => other.statistics.mean === c.statistics.mean,
          ) + 1,
      })),
  }));
  const height = 105 + ids.length * 45,
    left = 90,
    right = 730;
  const X = (i: number) =>
      scales.length === 1
        ? 410
        : left + (i * (right - left)) / (scales.length - 1),
    Y = (rank: number) => 40 + (rank - 1) * 45;
  const graph = ids
    .map((id, index) => {
      const points = rankings.flatMap((s, i) => {
        const c = s.rows.find((r: any) => r.id === id);
        return c ? [{ ...c, x: X(i), cards: s.cards }] : [];
      });
      const name = points[0]?.name ?? id,
        color = summaryColors[index % summaryColors.length];
      return `${points.length > 1 ? `<polyline points="${points.map((p) => `${p.x},${Y(p.rank)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5"/>` : ""}${points.map((p) => `<g data-rank-id="${esc(id)}" data-cards="${p.cards}" data-rank="${p.rank}" data-contribution="${p.statistics.mean}"><title>${esc(name)} · ${label(p.cards)}：第${p.rank}位，${num(p.statistics.mean * 100)} pp；95%区间 ${num(p.statistics.ciLow * 100)} ～ ${num(p.statistics.ciHigh * 100)} pp</title><circle cx="${p.x}" cy="${Y(p.rank)}" r="6" fill="white" stroke="${color}" stroke-width="2.5"/><text x="${p.x}" y="${Y(p.rank) + 4}" text-anchor="middle" style="font-size:8px" fill="${color}">${p.rank}</text></g>`).join("")}`;
    })
    .join("");
  const series = ids.map((id, i) => ({
    name: rankings.flatMap((s) => s.rows).find((r: any) => r.id === id)!.name,
    color: summaryColors[i % summaryColors.length],
    points: rankings.flatMap((s) => {
      const c = s.rows.find((r: any) => r.id === id);
      return c ? [{ x: s.cards, statistics: c.statistics }] : [];
    }),
  }));
  return `<div class="arch-chart" data-summary-chart="contribution-ranks"><h3>不同规模的措施贡献排序</h3><div class="reliability-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div><div class="reliability-plot" tabindex="0"><svg viewBox="0 0 820 ${height}" role="img" aria-label="各规模措施贡献排名变化"><title>各规模措施贡献排名变化</title>${ids.map((_, i) => `<line x1="${left}" y1="${Y(i + 1)}" x2="${right}" y2="${Y(i + 1)}" class="chart-grid"/><text x="60" y="${Y(i + 1) + 4}" text-anchor="end">第${i + 1}位</text>`).join("")}${graph}${scales.map((s, i) => `<text x="${X(i)}" y="${height - 35}" text-anchor="middle">${label(s.cards)}</text>`).join("")}<text x="410" y="${height - 5}" text-anchor="middle">需求规模 · 各规模独立排名</text></svg></div><p class="note">${d.version.includes("incremental") ? "本轮改进相对冻结第一轮的增量贡献" : "现有候选措施相对固定基线的贡献"}。折线展示排名变化；同均值并列，负贡献保留。排名变化不代表差异达到统计显著性，现状贡献不等于继续改善的边际收益。</p><details class="arch-evidence"><summary>贡献值趋势与95%区间（百分点）</summary>${lineChart({ title: "各规模措施贡献值对比", series, xLabel: "需求规模 / 卡", formatX: label, yLabel: "Shapley贡献 / 百分点", formatY: (v) => num(v * 100) + " pp", note: "各条线使用同一纵轴，保留负贡献与原95%均值区间；仅连接已有计算点，不把现状贡献与改进增量混为同一基准。" })}</details><div class="table-wrap"><table><thead><tr><th>措施</th>${rankings.map((s) => `<th>${label(s.cards)}</th>`).join("")}</tr></thead><tbody>${ids
    .map(
      (id) =>
        `<tr><th>${esc(series[ids.indexOf(id)].name)}</th>${rankings
          .map((s) => {
            const c = s.rows.find((r: any) => r.id === id);
            return `<td>${c ? `<b>#${c.rank} · ${num(c.statistics.mean * 100)} pp</b><small>95%区间 ${num(c.statistics.ciLow * 100)} ～ ${num(c.statistics.ciHigh * 100)} pp</small>` : "未计算"}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div></div>`;
}

export function architectureSummary(d: AuditArchitectureDiagnosis) {
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  const parents = d.architecture.nodes.filter(
    (n) =>
      d.architecture.nodes.some((c) => c.parentId === n.id) && n.id !== root.id,
  );
  return `<div class="scale-summary"><div class="scale-summary-flow"><b>目标分解与趋势</b><span>→</span><b>故障模式差距</b><span>→</span><b>损失时间分布</b><span>→</span><b>贡献排序</b><span>→</span><b>分规模改进</b></div>${architectureTargetBreakdown(d)}${architectureTrend(d)}<details class="arch-evidence"><summary>展开其他层级的目标分解与差距趋势</summary>${parents.map((n) => architectureTargetBreakdown(d, n.id) + architectureTrend(d, n.id)).join("")}</details>${faultModeGapSummary(d)}${lossTimeDistribution(d)}<details class="arch-evidence"><summary>按子系统查看损失时间</summary>${lossTimeDistribution(d, "layer")}</details>${contributionRankSummary(d)}<p class="scale-next-step">下一步：按每个规模的实际缺口、适用范围及Shapley重要度分别进行AGREE分配，生成各自的措施与参数建议；建议尚未部署，载入后需单独评估并保留新的增量贡献排序。</p></div>`;
}

export function architectureSummaryMarkdown(d: AuditArchitectureDiagnosis) {
  const cell = (v: unknown) =>
    esc(v).replaceAll("|", "\\|").replaceAll("\n", " ");
  const table = (heads: string[], rows: unknown[][]) =>
    "| " +
    heads.map(cell).join(" | ") +
    " |\n| " +
    heads.map(() => "---").join(" | ") +
    " |\n" +
    rows.map((row) => "| " + row.map(cell).join(" | ") + " |").join("\n");
  const scales = orderedDiagnosisScales(d),
    root = d.architecture.nodes.find((n) => !n.parentId)!;
  const summary = table(
    ["需求规模", "可用度目标", "本轮可用度", "目标−本轮 / pp"],
    scales.map((s) => [
      label(s.cards),
      pct(s.target),
      pct(s.statistics.mean),
      num((s.target - s.statistics.mean) * 100),
    ]),
  );
  const budgets = table(
    ["下级对象", ...scales.map((s) => label(s.cards) + " 允许/实际 h")],
    d.architecture.nodes
      .filter((n) => n.parentId === root.id)
      .map((n) => [
        n.name,
        ...scales.map((s) => {
          const v = s.nodes.find((v) => v.id === n.id)!;
          return num(v.allowedHours) + " / " + num(v.actualHours);
        }),
      ]),
  );
  const losses = lossTimeSegments(d);
  const lossTable = table(
    ["损失环节", ...losses.map((s) => label(s.cards) + " / h")],
    Object.entries(lossLabels).map(([id, name]) => [
      name,
      ...losses.map((s) => num(s.segments.find((v) => v.id === id)?.hours)),
    ]),
  );
  const ranks = scales.filter((s) => s.ranking.length),
    ids = [
      ...new Set<string>(ranks.flatMap((s) => s.ranking.map((r: any) => r.id))),
    ];
  const rankTable = table(
    ["措施", ...ranks.map((s) => label(s.cards) + " 排名/贡献 pp")],
    ids.map((id) => [
      ranks.flatMap((s) => s.ranking).find((r: any) => r.id === id)!.name,
      ...ranks.map((s) => {
        const sorted = s.ranking
            .slice()
            .sort((a: any, b: any) => b.statistics.mean - a.statistics.mean),
          c = sorted.find((r: any) => r.id === id);
        return c
          ? "#" +
              (sorted.findIndex(
                (r: any) => r.statistics.mean === c.statistics.mean,
              ) +
                1) +
              " / " +
              num(c.statistics.mean * 100)
          : "未计算";
      }),
    ]),
  );
  return (
    "### 各规模目标与差距汇总\n\n" +
    summary +
    "\n\n### 架构目标分解\n\n" +
    budgets +
    "\n\n### 损失时间分布\n\n" +
    lossTable +
    "\n\n### 贡献排名汇总\n\n" +
    rankTable +
    "\n\n分层目标为设计参照，不是模块自身运行可用度；各规模改善要求分别分配，之后独立评估。"
  );
}

export const scaleSummaryCss = `
.scale-summary-flow{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 15px;background:#eef5ef;border-radius:8px;font-size:12px;color:#355e4e}.scale-summary-flow span{color:#829b8e}.scale-target-breakdown{margin:18px 0}.scale-target-breakdown h4{margin:10px 0}.scale-next-step{border-left:3px solid #3b816d;padding:12px;background:#f0f6f0;font-size:13px}.scale-summary small{display:block;line-height:1.7;font-size:11px}.loss-small{font-size:10px;fill:#61786b}.fault-gap-summary td{min-width:160px}.scale-summary-controls{display:flex;gap:14px;flex-wrap:wrap;margin:12px 0}.scale-summary-controls label{min-width:180px;flex:1}.scale-summary-controls select{max-width:100%}.scale-summary .gap,.scale-target-breakdown .gap{background:#fff3e3;color:#80521d}.scale-summary .within,.scale-target-breakdown .within{background:#eaf5ee;color:#286451}.scale-summary .pending{background:#f1f3ef}.scale-summary [data-summary-chart]{margin:22px 0}.scale-summary table{font-variant-numeric:tabular-nums}
@media(max-width:650px){.scale-summary-flow{gap:6px;font-size:10px}.scale-summary-controls{display:block}.scale-summary-controls label{display:block;margin:10px 0}.scale-summary .table-wrap table{min-width:650px}}
@media print{.scale-summary-flow,.scale-summary .gap,.scale-summary .within{print-color-adjust:exact;-webkit-print-color-adjust:exact}.scale-summary .table-wrap table{min-width:0}.scale-summary [data-summary-chart]{break-inside:avoid}}
`;
