import type { AuditArchitectureDiagnosis } from "../../analysis/src/audit-architecture";
import { auditMechanismNames } from "../../contracts/src/audit-mechanism-view";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
import type { TrainingScenario } from "../../contracts/src/audit-training-scenario";

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (v: number | null | undefined, d = 3) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("zh-CN", { maximumFractionDigits: d });
const pct = (v: number | null | undefined) =>
  v == null ? "—" : num(v * 100) + "%";
const name = (id: string) =>
  auditMechanismNames[id] ??
  auditExtensionCatalog.find((m) => m.id === id)?.name ??
  id;
const text = (
  x: number,
  y: number,
  value: unknown,
  size = 15,
  color = "#253b54",
  weight = 400,
) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(value)}</text>`;
function lines(
  x: number,
  y: number,
  value: string,
  width = 28,
  size = 14,
  color = "#52667a",
) {
  const words = Array.from(value),
    parts: string[] = [];
  let line = "",
    length = 0;
  for (const word of words) {
    const w = word.charCodeAt(0) > 255 ? 1 : 0.55;
    if (length + w > width) {
      parts.push(line);
      line = "";
      length = 0;
    }
    line += word;
    length += w;
  }
  if (line) parts.push(line);
  return parts
    .map((s, i) => text(x, y + i * (size + 5), s, size, color))
    .join("");
}

/** One exportable ledger-backed diagram. Never invent layer availability or fit targets. */
export function layerDecisionSvg(
  result: any,
  cards: number,
  focusId?: string,
  depth = 10,
): string {
  const entries: {
    name: string;
    diagnosis: AuditArchitectureDiagnosis;
    reference?: number;
    scenario?: TrainingScenario;
    configuration?: any;
  }[] =
    result.kind === "expert-audit-comparison"
      ? result.entries
          .filter((e: any) => e.architectureDiagnosis)
          .map((e: any) => ({
            name: e.name,
            diagnosis: e.architectureDiagnosis,
            reference: e.trainingScenario?.referenceAvailability,
            scenario: e.trainingScenario,
            configuration: e.configuration,
          }))
      : result.architectureDiagnosis
        ? [
            {
              name:
                result.request.trainingScenario?.name ??
                result.name ??
                "本轮评估",
              diagnosis: result.architectureDiagnosis,
              reference: result.request.trainingScenario?.referenceAvailability,
              scenario: result.request.trainingScenario,
              configuration: result.configuration ?? result.config,
            },
          ]
        : [];
  if (!entries.length) return "";
  const d = entries[0].diagnosis,
    first = d.scales.find((s) => s.cards === cards);
  if (!first) return "";
  const root =
    d.architecture.nodes.find((n) => n.id === focusId) ??
    d.architecture.nodes.find((n) => !n.parentId)!;
  const ordered: { id: string; level: number }[] = [];
  const walk = (id: string, level: number) => {
    ordered.push({ id, level });
    if (level < depth)
      d.architecture.nodes
        .filter((n) => n.parentId === id)
        .forEach((n) => walk(n.id, level + 1));
  };
  walk(root.id, 0);
  const cols = entries.length,
    cell = 360,
    left = 760,
    right = 440,
    width = left + cell * cols + right + 40;
  const rowHeight = 112,
    top = 292,
    footer = top + ordered.length * rowHeight,
    height = footer + (entries.some((e) => e.scenario) ? 800 : 240);
  let body = `<rect width="${width}" height="${height}" fill="#f4f7fb"/><rect x="0" y="0" width="${width}" height="92" fill="#13283f"/>`;
  body += text(
    32,
    40,
    "架构 → 证据分配 → 差距 → 可靠性措施",
    28,
    "#ffffff",
    650,
  );
  body += text(
    32,
    72,
    `${num(cards, 0)}卡 · ${num(d.hours, 0)}小时总窗口 · 目标 ${pct(first.target)} · 总损失预算 ${num(first.allowedHours)} h`,
    17,
    "#b9d7ef",
  );
  body += text(
    32,
    124,
    "先计算现状，再形成分层责任，最后规划并独立复评",
    21,
    "#13283f",
    600,
  );
  body += text(
    32,
    153,
    "图中目标是业务损失责任；父子层不能重复相加，也不能直接连乘。灰色对象待补证据。",
    15,
  );
  body += text(
    32,
    185,
    first.allocationFrozen
      ? "预算参照：冻结现状轮的证据分配"
      : "预算参照：" + (first.allocationMethod ?? d.architecture.budgetMethod),
    15,
    "#286d79",
    600,
  );
  body += text(
    32,
    215,
    "C = 故障模式数 × 设计权重；E = 风险 / 正贡献优先级 × 人工重要度；数值可在分配依据表复核。",
    14,
  );
  body += `<rect x="20" y="244" width="${width - 40}" height="40" rx="8" fill="#e1eaf4"/>`;
  body +=
    text(34, 270, "系统层级 / 连接", 15, "#13283f", 650) +
    text(300, 270, "故障证据 · 数量 / FIT / 间隔", 15, "#13283f", 650) +
    text(560, 270, "分配依据与预算", 15, "#13283f", 650);
  entries.forEach((entry, i) => {
    const s = entry.diagnosis.scales.find((s) => s.cards === cards),
      x = left + i * cell;
    body += text(x, 270, entry.name, 16, "#13283f", 650);
    if (s) {
      body += text(
        x,
        124,
        `${pct(s.statistics.mean)} / 目标 ${pct(s.target)}`,
        21,
        "#13283f",
        650,
      );
      body += text(
        x,
        153,
        `有效 ${num(d.hours - s.actualHours)} h · 损失 ${num(s.actualHours)} h`,
        14,
      );
      body += text(
        x,
        179,
        `95%均值区间 ${pct(s.statistics.ciLow)} – ${pct(s.statistics.ciHigh)}`,
        13,
      );
      body += text(
        x,
        205,
        entry.reference != null
          ? `用户参考值 ${pct(entry.reference)}（非仿真结果）`
          : "已完成评估快照；均值不代表保证值",
        13,
        "#677b8c",
      );
    }
  });
  const rx = left + cell * cols;
  body += text(rx, 270, "薄弱点 → 消减方向 / 适用措施", 15, "#13283f", 650);
  ordered.forEach(({ id, level }, i) => {
    const n = first.nodes.find((n) => n.id === id)!;
    if (!n) return;
    const y = top + i * rowHeight,
      indent = 32 + Math.min(level, 7) * 18;
    body += `<rect x="20" y="${y}" width="${width - 40}" height="${rowHeight - 6}" rx="6" fill="${n.leaf ? "#ffffff" : "#eaf1f8"}"/>`;
    if (level)
      body += `<path d="M${indent - 10} ${y - 7} V${y + 26} H${indent - 2}" fill="none" stroke="#8aa3b9" stroke-width="1.5"/>`;
    body +=
      `<g data-node-id="${esc(id)}"><title>${esc(n.name)} · ${esc(n.source)}</title>` +
      lines(indent, y + 26, n.name, (280 - indent) / 16, 16, "#17334d") +
      text(indent, y + 87, n.leaf ? "叶层对象" : "汇总层", 12, "#6b7e90") +
      "</g>";
    body +=
      text(
        300,
        y + 25,
        `数量 ${num(n.quantity, 0)} · ${n.eventIds.length} 类模式`,
        14,
      ) +
      text(300, y + 49, `等效 FIT ${num(n.fit)}`, 14) +
      text(
        300,
        y + 73,
        `hard 间隔 ${num(n.frequencyRecovery?.hardEventIntervalHours)} h`,
        14,
      );
    body += text(
      300,
      y + 95,
      n.dataStatus === "modeled" ? "已建模范围" : "含待补数据 · 非零风险",
      12,
      n.dataStatus === "modeled" ? "#667d8b" : "#936b36",
    );
    const e = n.allocationEvidence;
    body +=
      text(
        560,
        y + 25,
        `C ${num(e?.complexity)} · E ${num(n.parentId ? e?.importance : null)}`,
        14,
      ) +
      text(
        560,
        y + 49,
        `允许损失 ${num(n.allowedHours)} h`,
        14,
        "#175869",
        600,
      ) +
      text(560, y + 73, `折算目标 ${pct(n.targetAvailability)}`, 14) +
      text(
        560,
        y + 95,
        `正贡献投影 ${num(e?.projectedGain == null ? null : e.projectedGain * 100)} pp`,
        12,
      );
    entries.forEach((entry, j) => {
      const sn = entry.diagnosis.scales
        .find((s) => s.cards === cards)
        ?.nodes.find((n) => n.id === id);
      const x = left + j * cell;
      if (!sn) return;
      const unknown = sn.dataStatus === "unknown",
        gap = sn.excessHours,
        color =
          unknown || gap == null ? "#748392" : gap > 0 ? "#a64537" : "#227562";
      body += `<rect x="${x - 7}" y="${y + 8}" width="${cell - 16}" height="${rowHeight - 22}" rx="5" fill="${unknown ? "#edf0f3" : gap != null && gap > 0 ? "#fff0e8" : "#edf7f2"}"/>`;
      body += text(
        x,
        y + 30,
        unknown
          ? "待补充故障证据"
          : `损失 ${num(sn.actualHours)} h · 可用度 ${pct(sn.attributedAvailability)}`,
        15,
        color,
        600,
      );
      body += text(
        x,
        y + 54,
        gap == null
          ? "预算待分配"
          : `${gap > 0 ? "超预算" : "预算余量"} ${num(Math.abs(gap))} h`,
        14,
        color,
      );
      body += text(
        x,
        y + 78,
        `恢复停机 ${num(sn.recoveryPauseSeconds, 2)} s / 次`,
        13,
      );
      body += `<title>${esc(sn.focus)}；${esc(sn.action)}</title>`;
    });
    body +=
      lines(rx, y + 24, n.focus, 27, 14, "#17334d") +
      lines(rx, y + 48, n.action, 27, 13);
    const applicable = n.mechanisms.map(name).join("、") || "需补充适用机制";
    body += text(
      rx,
      y + 96,
      applicable.length > 30 ? applicable.slice(0, 29) + "…" : applicable,
      12,
      "#286d79",
    );
    body += `<title>适用措施：${esc(applicable)}；候选（未计收益）：${esc(n.extensions.map((m) => m.name).join("、"))}</title>`;
  });
  body += text(32, footer + 28, "决策与验证", 20, "#17334d", 650);
  body += lines(
    32,
    footer + 58,
    "事件频率：保持器件失效依据；比较数量、组网、冗余与传播抑制，需验证容量和共因。恢复损失：检查检测覆盖/时延、检查点、局部恢复、失败升级与人工链路。",
    46,
    15,
  );
  body += lines(
    32,
    footer + 133,
    "预算是约束，机制是候选。使用现状Shapley形成AGREE重要度，受参数证据/产品边界约束后正向复评；改善轮沿用原预算，保留未达标与不可行结论。",
    46,
    15,
  );
  entries.forEach((entry, i) => {
    const s = entry.diagnosis.scales.find((s) => s.cards === cards),
      x = left + i * cell;
    body += text(
      x,
      footer + 30,
      entry.name + " · 优先核查",
      16,
      "#17334d",
      650,
    );
    body += lines(
      x,
      footer + 59,
      s?.weaknesses
        .slice(0, 3)
        .map((w) => `${w.rank}. ${w.name}：${num(w.excessHours)} h差距`)
        .join("；") || "补充足够故障暴露后再判定",
      20,
      14,
    );
    body += lines(
      x,
      footer + 142,
      "已选贡献：" +
        (s?.ranking
          .slice(0, 3)
          .map((r: any) => `${name(r.id)} ${num(r.statistics.mean * 100)}pp`)
          .join("；") || "未计算归因"),
      20,
      13,
    );
  });
  body += lines(
    rx,
    footer + 58,
    "FIT是源模型的等效事件率，不是单件失效率。恢复停机均值来自损失账，不等于完整物理修复MTTR。当前图展示逐层责任和已建模证据，不自动证明未建模对象达标。",
    27,
    14,
  );
  if (entries.some((e) => e.scenario)) {
    const y = footer + 266;
    body += text(
      32,
      y,
      "三档输入与机制意图 · 真实配置优先于载入模板",
      21,
      "#17334d",
      650,
    );
    const rows: [string, (e: (typeof entries)[number]) => string][] = [
      [
        "载入MTBF参考卡数 / 小时（所选事件范围）",
        (e) =>
          e.scenario
            ? `${num(e.scenario.referenceCards, 0)}卡 / ${num(e.scenario.mtbfHours)} h`
            : "—",
      ],
      [
        "检查点周期 / 保存阻塞（秒）",
        (e) =>
          `${num(e.configuration?.policy?.["C-FAST"]?.computeSeconds)} / ${num(e.configuration?.policy?.["C-FAST"]?.saveSeconds)}`,
      ],
      [
        "中断检测与调度（秒） / 检出成功率",
        (e) =>
          `${num(e.configuration?.policy?.["D-HARD"]?.detectSeconds)} / ${pct(e.configuration?.policy?.["D-HARD"]?.coverage)}`,
      ],
      [
        "自动恢复合计（秒，不重复含检测）",
        (e) => num(e.configuration?.model?.recoveryAttemptSeconds),
      ],
      [
        "载入阶段：建链 / 构建 / 加载 / 编译（秒）",
        (e) =>
          e.scenario
            ? `${e.scenario.communicationSeconds} / ${e.scenario.constructionSeconds} / ${e.scenario.loadSeconds} / ${e.scenario.compilationSeconds}`
            : "—",
      ],
      [
        "自动恢复成功率 / 失败后人工追加（小时）",
        (e) =>
          `${pct(e.configuration?.model?.recoverySuccess)} / ${num(e.configuration?.model?.manualAdditionalSeconds / 3600)}`,
      ],
      [
        "静默检测覆盖率 / 发现秒数",
        (e) =>
          `${pct(e.configuration?.policy?.["D-SDC"]?.coverage)} / ${num(e.configuration?.policy?.["D-SDC"]?.detectSeconds)}`,
      ],
      [
        "亚健康检测覆盖率 / 发现秒数",
        (e) =>
          `${pct(e.configuration?.policy?.["D-SLOW"]?.coverage)} / ${num(e.configuration?.policy?.["D-SLOW"]?.detectSeconds)}`,
      ],
      [
        "漏检静默兜底 / 亚健康持续（小时）",
        (e) =>
          `${num(e.configuration?.model?.sdcDelayHours)} / ${num(e.configuration?.model?.slowLifetimeHours)}`,
      ],
    ];
    rows.forEach(([label, value], i) => {
      const ry = y + 44 + i * 29;
      body +=
        `<rect x="20" y="${ry - 20}" width="${width - 40}" height="28" fill="${i % 2 ? "#eaf1f8" : "#ffffff"}"/>` +
        text(32, ry, label, 14);
      entries.forEach((e, j) => {
        body += text(left + j * cell, ry, value(e), 14);
      });
    });
    body += lines(
      32,
      y + 344,
      "参数中尚未明确的step与99.x由操作者填写。人工排查映射成漏检暴露时长；这不是完整人工工单模型。阶段模板是载入意图，后续真实修改以合计参数为准。",
      46,
      14,
    );
    entries.forEach((e, j) => {
      body += lines(
        left + j * cell,
        y + 344,
        e.scenario?.mechanismNotes ?? "按实际选择与参数解释",
        20,
        14,
      );
    });
    body += lines(
      rx,
      y + 344,
      "机制意图通过参数体现；不额外叠加同名收益。新增专家扩展机制时，核对与基础参数改善是否重叠，再单独评估增量。",
      27,
      14,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="分层分配与机制决策图" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${body}</svg>`;
}

export function layerAllocationTable(
  d: AuditArchitectureDiagnosis,
  cards: number,
) {
  const s = d.scales.find((s) => s.cards === cards);
  if (!s?.nodes.some((n) => n.allocationEvidence)) return "";
  return `<details class="arch-evidence"><summary>分层分配依据 · 故障 / 损失 / Shapley / AGREE</summary><p>${esc(s.allocationBasis)}</p>${s.allocationIssues?.length ? `<p>分配不可行，未伪造子层预算：${esc(s.allocationIssues.map((i) => i.message).join("；"))}</p>` : ""}<p>${s.allocationFrozen ? "沿用现状轮的冻结预算与分配证据；实际损失使用本轮结果。" : "本轮现状证据；只对已建模责任范围分配全部预算，含未知对象时不构成完整系统的达标证明。"}</p><p>R*=exp(−B/T)，qᵢ=[1−(R*)^(Cᵢ/ΣC)]/Eᵢ，wᵢ=−ln(1−qᵢ)，Bᵢ=B×wᵢ/Σw；qᵢ≥1时分配不可行，不能用均分掩盖。该归一化用于损失责任预算，不能解释为器件可靠度。</p><div class="table-wrap"><table style="min-width:1280px;table-layout:auto"><thead><tr><th>层级</th><th>独立模式数</th><th>等效FIT</th><th>实际损失 h</th><th>正贡献投影 pp</th><th>C复杂度</th><th>E工程重要度</th><th>允许损失 h</th><th>依据</th></tr></thead><tbody>${s.nodes
    .map((n) => {
      const e = n.allocationEvidence;
      return `<tr><th>${esc(n.name)}</th><td>${num(e?.modeCount, 0)}</td><td>${num(e?.fit)}</td><td>${num(e?.actualHours)}</td><td>${num(e?.projectedGain == null ? null : e.projectedGain * 100)}</td><td>${num(e?.complexity)}</td><td>${num(n.parentId ? e?.importance : null)}</td><td>${num(n.allowedHours)}</td><td>${esc(e?.priorityBasis || (n.parentId ? "数据待补" : "总体目标"))}</td></tr>`;
    })
    .join("")}</tbody></table></div></details>`;
}
