import {
  auditObjects,
  eventLossHours,
  type AuditEventView,
} from "../../contracts/src/audit-objects";
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const number = (v: number) =>
  Number.isFinite(v)
    ? v.toLocaleString("zh-CN", { maximumFractionDigits: 3 })
    : "—";
export function auditObjectComparison(
  events: AuditEventView[],
  left: any,
  right: any,
  leftEvents = events,
  rightEvents = events,
) {
  return auditObjects(events).map((object) => {
    const fits = (catalog: AuditEventView[]) =>
      object.events.reduce(
        (s, e) => s + (catalog.find((x) => x.id === e.id)?.fit ?? e.fit),
        0,
      );
    const loss = (row: any) =>
      row?.perEvent
        ? object.events.reduce(
            (s, e) => s + eventLossHours(row.perEvent[e.id]),
            0,
          )
        : null;
    return {
      ...object,
      leftFit: fits(leftEvents),
      rightFit: fits(rightEvents),
      leftLoss: loss(left),
      rightLoss: loss(right),
    };
  });
}
/** An influence block view, not an invented series/parallel topology or an additional solver. */
export function auditObjectDiagram(
  events: AuditEventView[],
  left?: any,
  right?: any,
  leftEvents = events,
  rightEvents = events,
  coveredIds: string[] = [],
) {
  const objects = auditObjectComparison(
    events,
    left,
    right,
    leftEvents,
    rightEvents,
  );
  const width = 1000,
    rows = Math.ceil(objects.length / 3),
    height = rows * 146 + 140;
  const blocks = objects
    .map((object, i) => {
      const x = 32 + (i % 3) * 324,
        y = 70 + Math.floor(i / 3) * 146;
      const delta =
        object.leftLoss === null || object.rightLoss === null
          ? null
          : object.leftLoss - object.rightLoss;
      const covered = object.events.some((e) => coveredIds.includes(e.id));
      const accent =
        delta === null
          ? covered
            ? "#1b796d"
            : "#8b9690"
          : delta >= 0
            ? "#157563"
            : "#ad5b29";
      const fit =
        object.leftFit === object.rightFit
          ? number(object.leftFit)
          : `${number(object.leftFit)} → ${number(object.rightFit)}`;
      const loss =
        delta === null
          ? covered
            ? "所选措施有覆盖 · 收益待计算"
            : "收益待计算"
          : `损失 ${number(object.leftLoss!)} → ${number(object.rightLoss!)} h`;
      return `<g data-object="${escape(object.id)}"><rect x="${x}" y="${y}" width="288" height="126" rx="7" fill="#fff" stroke="${accent}" stroke-width="1.5"/><rect x="${x}" y="${y}" width="5" height="126" rx="2" fill="${accent}"/><text x="${x + 14}" y="${y + 20}" font-size="11" fill="#65746b">${escape(object.category)} · ${escape(object.id)}</text><text x="${x + 14}" y="${y + 42}" font-size="14" font-weight="600" fill="#233c34">${escape(object.name)}</text><text x="${x + 14}" y="${y + 63}" font-size="12" fill="#344b42">源 FIT：${escape(fit)}</text><text x="${x + 14}" y="${y + 82}" font-size="11" fill="#627168">基线：中断 ${number(object.types.hard)} / 亚健康 ${number(object.types.slow)} / 静默 ${number(object.types.sdc)}</text><text x="${x + 14}" y="${y + 107}" font-size="12" fill="${accent}">${escape(loss)}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="可靠性框图：故障对象 FIT 与措施影响" style="font-family:system-ui,'Noto Sans CJK SC',sans-serif"><title>可靠性框图：故障对象 FIT 与措施影响</title><desc>按对象组织中断、亚健康和静默故障，显示源 FIT 与所选方案的实际损失对比。对象之间的物理串并联关系未假设为独立；最终可用度由原有离散事件仿真计算。</desc><rect x="12" y="50" width="976" height="${rows * 146 + 4}" rx="12" fill="#f4f7f3" stroke="#c8d8cd"/><text x="500" y="22" text-anchor="middle" font-size="14" font-weight="600" fill="#294a3e">运行任务 → 故障对象与影响范围</text><path d="M500 29v16m-4-5 4 5 4-5" fill="none" stroke="#6a8275" stroke-width="2"/>${blocks}<path d="M500 ${height - 82}v22m-4-5 4 5 4-5" fill="none" stroke="#6a8275" stroke-width="2"/><rect x="190" y="${height - 55}" width="620" height="38" rx="6" fill="#e4efe8" stroke="#96b9a5"/><text x="500" y="${height - 31}" text-anchor="middle" font-size="14" fill="#234a39">检测 / 恢复 / 检查点 → 保留进度 → 可用度与达标决策</text></svg>`;
}
