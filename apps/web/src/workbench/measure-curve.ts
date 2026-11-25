import type { MeasureScaleStudy } from "../../../../packages/core/src/index";
import { hours, percent, points, scale } from "./format";

type Item = MeasureScaleStudy["measures"][number];
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** One coordinate system: right-axis weekly loss is exactly 168 × (1 − left-axis A). */
export function measureCurveGeometry(data: Item["points"]) {
  const min = Math.max(
    0,
    Math.floor(
      (Math.min(
        ...data.flatMap((p) => [p.target, p.baseline, p.availability]),
      ) -
        0.02) *
        10,
    ) / 10,
  );
  const x = (i: number) => 76 + i * 202,
    y = (a: number) => 278 - ((a - min) / (1 - min)) * 210;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const availability = min + ((1 - min) * i) / 4;
    return {
      availability,
      weeklyLoss: 168 * (1 - availability),
      y: y(availability),
    };
  });
  const bands: Array<{ points: string; positive: boolean }> = [];
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i],
      b = data[i + 1],
      d0 = a.availability - a.baseline,
      d1 = b.availability - b.baseline;
    const cuts = d0 * d1 < 0 ? [0, d0 / (d0 - d1), 1] : [0, 1];
    for (let j = 1; j < cuts.length; j++) {
      const lo = cuts[j - 1],
        hi = cuts[j],
        at = (t: number, improved: boolean) => {
          const p = improved ? a.availability : a.baseline,
            q = improved ? b.availability : b.baseline;
          return `${x(i) + (x(i + 1) - x(i)) * t},${y(p + (q - p) * t)}`;
        };
      bands.push({
        points: [at(lo, false), at(hi, false), at(hi, true), at(lo, true)].join(
          " ",
        ),
        positive: d0 + ((d1 - d0) * (lo + hi)) / 2 >= 0,
      });
    }
  }
  return { ticks, bands, x, y };
}

/** Shared SVG renderer for the workbench and offline report; all user text is escaped. */
export function measureCurveSvg(item: Item) {
  const data = item.points,
    { ticks, bands, x, y } = measureCurveGeometry(data);
  const series = [
    {
      name: "目标",
      color: "#af3d32",
      dash: "7 5",
      values: data.map((p) => p.target),
    },
    {
      name: "现状",
      color: "#285a93",
      dash: "",
      values: data.map((p) => p.baseline),
    },
    {
      name: "仅优化该项",
      color: "#007d72",
      dash: "",
      values: data.map((p) => p.availability),
    },
  ];
  const last = data.at(-1)!,
    positive = last.gainPp >= 0,
    gap = Math.abs(y(last.baseline) - y(last.availability));
  const labelY =
    gap > 48
      ? (y(last.baseline) + y(last.availability)) / 2 - 8
      : Math.min(250, Math.max(100, y(last.availability) - 42));
  const title = `${item.name} · 可用度与周损失随规模变化`;
  return `<svg viewBox="0 0 1000 342" class="rw-measure-curve" role="img" aria-label="${escape(title)}">
<title>${escape(title)}。浅蓝阴影表示提升，浅红表示负收益。周损失＝168×(1−可用度)。</title>
<g font-family="system-ui,sans-serif" fill="#142d48">
<text x="16" y="23" font-size="15" font-weight="650">可用度（%）</text><text x="970" y="23" text-anchor="end" font-size="15" font-weight="650">周损失（h）</text>
${series.map((s, i) => `<line x1="${255 + i * 136}" x2="${279 + i * 136}" y1="19" y2="19" stroke="${s.color}" stroke-width="2.5" stroke-dasharray="${s.dash}"/><text x="${286 + i * 136}" y="24" fill="${s.color}" font-size="13">${s.name}</text>`).join("")}
<rect x="680" y="12" width="22" height="14" fill="#daeafe"/><text x="710" y="24" font-size="13">措施收益</text>
<text x="970" y="46" text-anchor="end" font-size="12">周损失＝168×(1−可用度)</text>
${ticks.map((t) => `<g data-axis-availability="${t.availability}" data-axis-weekly-loss="${t.weeklyLoss}"><line x1="76" x2="884" y1="${t.y}" y2="${t.y}" stroke="#d9e3ed"/><text x="65" y="${t.y + 4}" text-anchor="end" font-size="13">${percent(t.availability, 1)}</text><text x="901" y="${t.y + 4}" font-size="13">${t.weeklyLoss.toFixed(1)}</text></g>`).join("")}
${bands.map((b) => `<polygon class="rw-benefit-band" data-benefit="${b.positive ? "positive" : "negative"}" points="${b.points}" fill="${b.positive ? "#daeafe" : "#f9ded7"}"/>`).join("")}
${series.map((s) => `<path d="${s.values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-dasharray="${s.dash}"/>${s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${scale(data[i].cards)} · ${s.name}：${percent(v, 4)} / ${hours(168 * (1 - v))}每周；该项增益 ${points(data[i].gainPp / 100)} / 周减损 ${hours(data[i].savedHours)}</title></circle>`).join("")}`).join("")}
<g aria-label="50万卡措施增益"><rect x="718" y="${labelY - 17}" width="148" height="43" rx="5" fill="white" fill-opacity=".93"/><text x="792" y="${labelY}" text-anchor="middle" fill="${positive ? "#145c9a" : "#a2402d"}" font-size="14" font-weight="700">${points(last.gainPp / 100)}</text><text x="792" y="${labelY + 19}" text-anchor="middle" fill="#344961" font-size="12">周损失${positive ? "减少" : "增加"} ${hours(Math.abs(last.savedHours))}</text></g>
${data.map((p, i) => `<text x="${x(i)}" y="305" text-anchor="middle" font-size="14">${scale(p.cards)}</text>`).join("")}
<text x="480" y="333" text-anchor="middle" font-size="12">集群规模（分类刻度）；阴影为同一规模的单项收益，不累加面积</text>
</g></svg>`;
}
