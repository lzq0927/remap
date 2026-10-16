import {
  auditReferenceOnly,
  auditSummaryScales,
} from "../../contracts/src/audit-presets";
import {
  auditContributionView,
  contributionExplanation,
} from "./audit-contributions";
/** Charts use frozen simulation points only; connecting points is not interpolation evidence. */
type Statistics = { mean: number; ciLow: number; ciHigh: number };
type Point = { x: number; statistics: Statistics; current?: boolean };
type Series = {
  name: string;
  color: string;
  points: Point[];
  dashed?: boolean;
};
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (v: number, digits = 3) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const pct = (v: number) => num(v * 100) + "%";
const scaleLabel = (v: number) => (v >= 10000 ? num(v / 10000) + "万" : num(v));
const valid = (s: Statistics) =>
  [s?.mean, s?.ciLow, s?.ciHigh].every(Number.isFinite);
const legend = (series: Series[]) =>
  `<div class="reliability-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${escape(s.name)}</span>`).join("")}<span class="interval-key">细竖线：95% 均值区间</span></div>`;

export function lineChart({
  title,
  series,
  xLabel,
  formatX,
  logarithmic = false,
  fullRange = false,
  target,
  note,
  yLabel = "可用度",
  formatY = (v: number) => num(v * 100) + "%",
  showIntervals = true,
}: {
  title: string;
  series: Series[];
  xLabel: string;
  formatX: (v: number) => string;
  logarithmic?: boolean;
  fullRange?: boolean;
  target?: number;
  note: string;
  yLabel?: string;
  formatY?: (value: number) => string;
  showIntervals?: boolean;
}) {
  series = series
    .map((s) => ({
      ...s,
      points: s.points
        .filter(
          (p) =>
            Number.isFinite(p.x) &&
            (!logarithmic || p.x > 0) &&
            valid(p.statistics),
        )
        .sort((a, b) => a.x - b.x),
    }))
    .filter((s) => s.points.length);
  const points = series.flatMap((s) => s.points);
  if (!points.length) return "";
  const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
  const transform = logarithmic ? Math.log10 : (v: number) => v;
  const xmin = transform(xs[0]),
    xmax = transform(xs.at(-1)!);
  const ys = points.flatMap((p) => [p.statistics.ciLow, p.statistics.ciHigh]);
  if (Number.isFinite(target)) ys.push(target!);
  const low = fullRange ? 0 : Math.min(...ys);
  const high = fullRange ? 1 : Math.max(...ys);
  const padding = fullRange ? 0 : Math.max(0.002, (high - low) * 0.15);
  const ymin = low >= 0 ? Math.max(0, low - padding) : low - padding,
    ymax = high <= 1 ? Math.min(1, high + padding) : high + padding;
  const X = (v: number) =>
    xmin === xmax ? 494 : 78 + ((transform(v) - xmin) / (xmax - xmin)) * 828;
  const Y = (v: number) =>
    306 -
    (((fullRange ? Math.max(0, Math.min(1, v)) : v) - ymin) / (ymax - ymin)) *
      250;
  const coordinate = (v: number) => v.toFixed(2);
  const grid = Array.from({ length: 6 }, (_, i) => {
    const v = ymin + ((ymax - ymin) * i) / 5,
      y = coordinate(Y(v));
    return `<line x1="78" y1="${y}" x2="906" y2="${y}" class="chart-grid"/><text x="65" y="${coordinate(Y(v) + 4)}" text-anchor="end">${escape(formatY(v))}</text>`;
  }).join("");
  const targetLine = Number.isFinite(target)
    ? `<line x1="78" y1="${coordinate(Y(target!))}" x2="906" y2="${coordinate(Y(target!))}" class="chart-target"/><text x="900" y="${coordinate(Y(target!) - 7)}" text-anchor="end" class="target-label">目标 ${pct(target!)}</text>`
    : "";
  const curves = series
    .map(
      (s) =>
        `${s.points.length > 1 ? `<polyline points="${s.points.map((p) => `${coordinate(X(p.x))},${coordinate(Y(p.statistics.mean))}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dashed ? 'stroke-dasharray="7 4"' : ""}/>` : ""}${s.points
          .map((p) => {
            const x = coordinate(X(p.x)),
              y = coordinate(Y(p.statistics.mean));
            return `<g data-value="${p.x}" data-mean="${p.statistics.mean}"><title>${escape(s.name)} · ${escape(formatX(p.x))}：${escape(formatY(p.statistics.mean))}${showIntervals ? "；95% 区间 " + escape(formatY(p.statistics.ciLow)) + " ～ " + escape(formatY(p.statistics.ciHigh)) : ""}${p.current ? "；当前输入" : ""}</title>${showIntervals ? `<path d="M${x},${coordinate(Y(p.statistics.ciLow))} V${coordinate(Y(p.statistics.ciHigh))} M${coordinate(X(p.x) - 4)},${coordinate(Y(p.statistics.ciLow))} h8 M${coordinate(X(p.x) - 4)},${coordinate(Y(p.statistics.ciHigh))} h8" stroke="${s.color}" stroke-width="1.4" opacity="0.65"/>` : ""}<circle cx="${x}" cy="${y}" r="${p.current ? 6 : 4}" fill="${p.current ? "white" : s.color}" stroke="${s.color}" stroke-width="2"/></g>`;
          })
          .join("")}`,
    )
    .join("");
  return `<figure class="reliability-chart"><h3>${escape(title)}</h3>${showIntervals ? legend(series) : legend(series).replace('<span class="interval-key">细竖线：95% 均值区间</span>', "")}<div class="reliability-plot" tabindex="0" aria-label="${escape(title)}图表，可横向滚动"><svg viewBox="0 0 960 390" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><desc>${escape(note)}</desc><text x="78" y="26" class="axis-label">${escape(yLabel)}</text>${grid}${targetLine}${curves}${xs.map((x) => `<text x="${coordinate(X(x))}" y="334" text-anchor="middle">${escape(formatX(x))}</text>`).join("")}<text x="494" y="374" text-anchor="middle" class="axis-label">${escape(xLabel)}</text></svg></div><figcaption>${escape(note)}</figcaption></figure>`;
}

export function auditScaleCurve(r: any) {
  const definitions = [
    ["base", "#7b8d97"],
    ["sdcStep", "#7663a3"],
    ["elastic", "#ba843b"],
    ["combined", "#16816a"],
  ];
  const displayRows = r.rows.filter(
    (row: any) => !auditReferenceOnly(r.request, row.cards),
  );
  const count = new Set(displayRows.map((row: any) => row.cards)).size;
  const chart = lineChart({
    title: "规模增大后，可用度如何变化",
    series: definitions.map(([id, color]) => ({
      name: r.rows.find((row: any) => row.id === id)?.name ?? id,
      color,
      dashed: id === "base",
      points: displayRows
        .filter((row: any) => row.id === id)
        .map((row: any) => ({ x: row.cards, statistics: row.statistics })),
    })),
    xLabel: "单作业卡数 · 对数刻度",
    formatX: (v) => scaleLabel(v) + "卡",
    logarithmic: true,
    fullRange: true,
    note:
      count > 1
        ? `连接本次已仿真的 ${count} 个规模，未计算的规模不补点、不外推。细竖线为 95% 均值区间，仅反映抽样误差；超出 0–100% 的区间在边界截断，完整数值见表格。各规模可有不同目标，因此不画统一目标线。`
        : "本次只计算了一个规模，仅显示实际点。启用多规模对比并重新评估后可查看趋势；95% 均值区间仅反映抽样误差，超出 0–100% 的区间在边界截断，完整数值见表格。",
  });
  const scales = auditSummaryScales(
    r.request,
    r.rows.map((row: any) => row.cards),
  );
  const values = `<div class="table-wrap curve-values"><table><thead><tr><th>曲线数值</th>${scales.map((cards) => `<th>${escape(scaleLabel(cards))}卡</th>`).join("")}</tr></thead><tbody>${definitions
    .map(
      ([id, color]) =>
        `<tr style="color:${color}"><td>${escape(r.rows.find((row: any) => row.id === id)?.name ?? id)}</td>${scales
          .map((cards) => {
            const row = r.rows.find(
              (row: any) => row.id === id && row.cards === cards,
            );
            return `<td>${row ? pct(row.statistics.mean) : "—"}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
  return chart.replace("<figcaption>", values + "<figcaption>");
}

export function auditSensitivityCurves(r: any) {
  const base = r.rows.find(
    (row: any) => row.cards === r.request.cards && row.id === "combined",
  );
  if (!base || !r.sensitivity?.length) return "";
  return [
    {
      parameter: "sdcCoverage",
      title: "静默检出率对可用度的影响",
      current: r.config.policy["D-SDC"]?.coverage ?? 0.95,
      label: "全系统静默即时检出率",
      format: pct,
    },
    {
      parameter: "sdcDelayHours",
      title: "漏检发现时延对可用度的影响",
      current: r.config.model.sdcDelayHours,
      label: "漏检兜底发现时延 · 小时",
      format: (v: number) => num(v) + " h",
    },
    {
      parameter: "elasticSyncSeconds",
      title: "弹性全局协调暂停对可用度的影响",
      current: r.config.policy["R-ELASTIC"]?.syncSeconds ?? 1,
      label: "全局协调暂停 · 秒",
      format: (v: number) => num(v) + " s",
    },
    {
      parameter: "stepSeconds",
      title: "step 回滚上限对可用度的影响",
      current: r.config.policy["R-SDC"]?.stepSeconds ?? 1,
      label: "step 回滚上限 · 秒",
      format: (v: number) => num(v) + " s",
    },
  ]
    .map(({ parameter, title, current, label, format }) => {
      const scanned = r.sensitivity.filter(
        (row: any) => row.parameter === parameter,
      );
      if (!scanned.length) return "";
      const scanCards = scanned[0].cards ?? r.request.cards;
      const reference = r.rows.find(
        (row: any) =>
          row.cards === scanCards &&
          row.id === (scanned[0].scenarioId ?? "combined"),
      ) ?? {
        ...base,
        name: scanned[0].scenarioName ?? base.name,
        statistics: scanned[0].referenceStatistics ?? base.statistics,
      };
      current = scanned[0].currentValue ?? current;
      const points: Point[] = scanned
        .filter((row: any) => row.value !== current)
        .map((row: any) => ({ x: row.value, statistics: row.statistics }));
      points.push({
        x: current,
        statistics:
          scanned.find((row: any) => row.value === current)?.statistics ??
          scanned[0].referenceStatistics ??
          reference.statistics,
        current: true,
      });
      return lineChart({
        title,
        series: [
          {
            name: `${num(scanCards)} 卡 · ${reference.name ?? "所选机制组合"}`,
            color: "#16816a",
            points,
          },
        ],
        xLabel: label,
        formatX: format,
        target:
          scanned[0].scenarioId && scanned[0].scenarioId !== "combined"
            ? undefined
            : (reference.target ??
              r.request.targets?.[String(r.request.cards)] ??
              r.request.target),
        note: `${num(scanCards)} 卡，${reference.name ?? "所选机制组合"}，保持情景内其他输入不变；空心点为当前输入 ${format(current)}。纵轴局部缩放以便观察变化，细竖线为 95% 均值区间；连线只连接已计算点。参考单项情景不替代所选组合的达标判读。`,
      });
    })
    .join("");
}

export function auditGainChart(r: any, cards = r.request.cards) {
  const rows = r.rows
    .filter(
      (row: any) =>
        row.cards === cards && row.id !== "base" && valid(row.delta),
    )
    .sort((a: any, b: any) => b.delta.mean - a.delta.mean);
  if (!rows.length) return "";
  const low = Math.min(0, ...rows.map((row: any) => row.delta.ciLow * 100));
  const high = Math.max(0, ...rows.map((row: any) => row.delta.ciHigh * 100));
  const padding = Math.max(0.01, (high - low) * 0.12);
  const X = (v: number) =>
    258 + ((v - low + padding) / (high - low + 2 * padding)) * 610;
  const zero = X(0),
    height = 75 + rows.length * 38;
  return `<figure class="reliability-chart gain-chart"><h3>${num(cards)} 卡 · 单项与组合方案收益对照</h3><div class="reliability-plot" tabindex="0" aria-label="方案收益对照图，可横向滚动"><svg viewBox="0 0 960 ${height}" role="img" aria-label="单项与组合方案收益对照"><title>单项与组合方案收益对照</title><desc>条形是相对基线的配对均值增益，横向细线是 95% 配对差值区间。负值向零线左侧延伸。</desc><line x1="${zero}" y1="16" x2="${zero}" y2="${height - 40}" class="chart-zero"/>${rows
    .map((row: any, i: number) => {
      const y = 30 + i * 38,
        mean = row.delta.mean * 100,
        x = X(mean),
        color =
          mean < 0 ? "#b75b46" : row.id === "combined" ? "#16816a" : "#708b84";
      const name =
        row.name.length > 19 ? row.name.slice(0, 18) + "…" : row.name;
      return `<g data-scenario="${escape(row.id)}"><title>${escape(row.name)}：${mean >= 0 ? "+" : ""}${num(mean)} pp；95% 配对区间 ${num(row.delta.ciLow * 100)} ～ ${num(row.delta.ciHigh * 100)} pp</title><text x="10" y="${y + 5}">${escape(name)}</text><rect x="${Math.min(x, zero)}" y="${y - 10}" width="${Math.max(0.5, Math.abs(x - zero))}" height="20" rx="3" fill="${color}"/><path d="M${X(row.delta.ciLow * 100)},${y} H${X(row.delta.ciHigh * 100)} M${X(row.delta.ciLow * 100)},${y - 6} v12 M${X(row.delta.ciHigh * 100)},${y - 6} v12" stroke="#233d37" stroke-width="1.4"/><text x="940" y="${y + 5}" text-anchor="end">${mean >= 0 ? "+" : ""}${num(mean)} pp</text></g>`;
    })
    .join(
      "",
    )}<text x="${zero}" y="${height - 16}" text-anchor="middle">0</text><text x="560" y="${height - 16}" text-anchor="middle">相对基线提升 · 百分点（pp）</text></svg></div><figcaption>每场景 ${escape(r.request.trials)} 条配对轨迹。条形为增益均值，横向细线为 95% 配对差值区间；区间跨 0 时，当前采样不能明确判断改善或下降。负值保留，组合收益不能与单项相加；每行比较完整方案相对当前基线的增量，方案收益为负时新增开销超过改善。Shapley贡献分摊另列，不能按名次宣称显著优劣。</figcaption></figure>`;
}

export function auditGainCharts(r: any) {
  const scales = auditSummaryScales(
    r.request,
    r.rows.map((row: any) => row.cards),
  );
  return `<label class="gain-scale-control">方案收益对照规模 <select id="gain-scale" aria-label="方案收益对照规模">${scales.map((cards) => `<option value="${cards}" ${cards === r.request.cards ? "selected" : ""}>${num(cards)} 卡</option>`).join("")}</select></label>${scales.map((cards) => `<div data-gain-scale="${cards}" ${cards !== r.request.cards ? "hidden" : ""}>${auditGainChart(r, cards)}</div>`).join("")}`;
}

export function auditContributionChart(r: any, cards = r.request.cards) {
  const v = auditContributionView(r, cards),
    rows = v.rows;
  if (!rows.length) return "";
  const bounds = rows.flatMap((row: any) =>
    [row.statistics.mean, row.statistics.ciLow, row.statistics.ciHigh]
      .filter(Number.isFinite)
      .map((n: number) => n * 100),
  );
  const low = Math.min(0, ...bounds),
    high = Math.max(0, ...bounds),
    padding = Math.max(0.01, (high - low) * 0.1);
  const X = (n: number) =>
    215 + ((n - low + padding) / (high - low + 2 * padding)) * 485;
  const zero = X(0),
    height = 68 + rows.length * 42;
  return `<figure class="reliability-chart contribution-chart"><div class="reliability-plot" tabindex="0" aria-label="贡献分摊图，可横向滚动"><svg viewBox="0 0 800 ${height}" role="img" aria-label="组合贡献分摊图"><title>${escape(v.title)}</title><desc>同一批Shapley样本的可用度贡献；负贡献向零线左侧延伸，横向线为95%区间。</desc><line x1="${zero}" y1="12" x2="${zero}" y2="${height - 32}" class="chart-zero"/>${rows
    .map((row: any, i: number) => {
      const s = row.statistics,
        y = 28 + i * 42,
        mean = s.mean * 100,
        x = X(mean);
      const intervalLabel =
        Number.isFinite(s.ciLow) && Number.isFinite(s.ciHigh)
          ? `${num(s.ciLow * 100)} ～ ${num(s.ciHigh * 100)} pp`
          : "历史未记录";
      const interval =
        Number.isFinite(s.ciLow) && Number.isFinite(s.ciHigh)
          ? `<path d="M${X(s.ciLow * 100)},${y} H${X(s.ciHigh * 100)} M${X(s.ciLow * 100)},${y - 6} v12 M${X(s.ciHigh * 100)},${y - 6} v12" stroke="#233d37" stroke-width="1.4"/>`
          : "";
      return `<g data-contribution="${escape(row.id)}" data-mean="${s.mean}"><title>${escape(row.name)}：${num(mean)} pp；95%区间 ${intervalLabel}</title><text x="8" y="${y + 5}">${escape(row.name.length > 16 ? row.name.slice(0, 15) + "…" : row.name)}</text><rect x="${Math.min(x, zero)}" y="${y - 10}" width="${Math.max(0.5, Math.abs(x - zero))}" height="20" rx="3" fill="${mean < 0 ? "#b75b46" : "#16816a"}"/>${interval}<text x="790" y="${y + 5}" text-anchor="end">${num(mean)} pp</text></g>`;
    })
    .join(
      "",
    )}<text x="${zero}" y="${height - 9}" text-anchor="middle">0</text><text x="480" y="${height - 9}" text-anchor="middle">Shapley贡献 · 百分点（pp）</text></svg></div><figcaption>条形为贡献均值，横向线为95%区间；负贡献保留。${escape(contributionExplanation)}</figcaption></figure>`;
}

export function auditContributionScaleControl(r: any) {
  const scales = auditSummaryScales(
    r.request,
    r.rows.map((row: any) => row.cards),
  );
  const selected = scales.includes(r.request.cards)
    ? r.request.cards
    : scales[0];
  return `<label class="gain-scale-control">贡献分摊规模 <select id="contribution-scale" aria-label="贡献分摊规模">${scales.map((cards) => `<option value="${cards}" ${cards === selected ? "selected" : ""}>${num(cards)} 卡</option>`).join("")}</select></label>`;
}

export const auditChartCss = `
.contribution-chart .reliability-plot svg{min-width:720px}
.reliability-chart{margin:24px 0;padding:20px;background:#f8faf8;border:1px solid #dfe8e2;border-radius:10px;min-width:0}.reliability-chart h3{margin:0 0 12px;font-size:17px;color:#244f40}.reliability-legend{display:flex;gap:12px 20px;flex-wrap:wrap;font-size:12px;color:#4c665d;margin-bottom:8px}.reliability-legend i{display:inline-block;width:18px;height:3px;vertical-align:middle;margin-right:7px}.reliability-legend .interval-key{color:#6f8077}.reliability-plot{overflow:auto;max-width:100%}.reliability-plot svg{display:block;width:100%;min-width:960px;font-family:inherit;font-size:12px;color:#536d62}.reliability-plot text{fill:currentColor}.reliability-plot .axis-label{font-size:12px;fill:#5b7266}.reliability-plot .chart-grid{stroke:#dce6df;stroke-width:1}.reliability-plot .chart-target{stroke:#b17d40;stroke-width:1.5;stroke-dasharray:6 5}.reliability-plot .target-label{fill:#906025}.reliability-plot .chart-zero{stroke:#82968a;stroke-width:1.2}.reliability-chart figcaption{font-size:12px;line-height:1.7;color:#61766a;margin-top:10px;max-width:1050px}.audit-curves{min-width:0}.audit-curves>summary{cursor:pointer;font-weight:600}
@media(max-width:640px){.reliability-chart{padding:12px;margin:18px 0}.reliability-chart h3{font-size:16px}.reliability-legend{gap:8px 12px}.reliability-plot:before{content:'横向滑动查看完整图表';display:block;font-size:11px;color:#7a897f;margin:4px 0}.reliability-chart figcaption{font-size:12px}}
@media print{.reliability-chart{padding:10px;background:white;break-inside:avoid}.reliability-plot{overflow:visible}.reliability-plot svg{width:100%;min-width:0}.reliability-plot:before{display:none}.reliability-plot svg *{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
