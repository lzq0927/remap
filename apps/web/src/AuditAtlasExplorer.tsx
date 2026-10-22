import { useEffect, useId, useMemo, useRef, useState } from "react";
import { auditAtlas } from "../../../packages/analysis/src/audit-atlas";
import {
  atlasDomainNames,
  functionalDomains,
  mechanismCapabilities,
  type FunctionalDomain,
} from "../../../packages/contracts/src/audit-atlas";
import {
  hardwareCount,
  hardwareLevels,
} from "../../../packages/contracts/src/audit-hardware";
import type { AuditArchitecture } from "../../../packages/contracts/src/audit-architecture";
import type { AuditEventView } from "../../../packages/contracts/src/audit-objects";
import { faultTypeLabels } from "../../../packages/contracts/src/audit-objects";
import { mechanismStages } from "../../../packages/contracts/src/audit-extensions";
import {
  atlasMatrixSvg,
  matrixCell,
  atlasSvg,
  atlasVisible,
  atlasMetricNames,
  atlasNumber,
  atlasStandaloneHtml,
  type AtlasMetric,
} from "../../../packages/reports/src/audit-atlas";
import { parameterLabels } from "../../../packages/reports/src/audit-labels";
import "./audit-atlas.css";

const statusNames: Record<string, string> = {
  selected: "本轮已选",
  deployed: "固定部署",
  candidate: "未选候选",
};
function download(name: string, content: string | Blob, type = "text/plain") {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AuditAtlasExplorer({
  architecture,
  events,
  request,
  result,
  cards: inputCards,
  onDomainChange,
}: {
  architecture?: AuditArchitecture;
  events: AuditEventView[];
  request?: any;
  result?: any;
  cards: number;
  onDomainChange?: (id: string, value?: FunctionalDomain) => void;
}) {
  const svgId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [cards, setCards] = useState(inputCards);
  useEffect(() => setCards(inputCards), [inputCards]);
  const viewScales: number[] = [
    ...new Set<number>(
      result
        ? (result.rows ?? []).map((r: any) => r.cards)
        : [
            inputCards,
            1000,
            1024,
            ...(request?.scales ?? []),
            10000,
            100000,
            200000,
            500000,
          ],
    ),
  ].sort((a, b) => a - b);
  const atlas = useMemo(
    () => auditAtlas({ architecture, events, request, result }, cards),
    [architecture, events, request, result, cards],
  );
  const root = atlas.nodes.find((n) => !n.parentId)!;
  const hasTopology = !!atlas.architecture.topology;
  const [selected, setSelected] = useState(root.id),
    [focus, setFocus] = useState(root.id);
  const [view, setView] = useState(
      architecture?.topology ||
        result?.request?.architecture?.topology ||
        request?.architecture?.topology
        ? "topology"
        : "plan",
    ),
    [metric, setMetric] = useState<AtlasMetric>("structure");
  useEffect(() => setView(hasTopology ? "topology" : "plan"), [hasTopology]);
  const [domain, setDomain] = useState(""),
    [query, setQuery] = useState(""),
    [fault, setFault] = useState("");
  const [stage, setStage] = useState(""),
    [capability, setCapability] = useState(""),
    [status, setStatus] = useState("");
  const [depth, setDepth] = useState(10),
    [links, setLinks] = useState(true),
    [full, setFull] = useState(false);
  const [yaw, setYaw] = useState(-22),
    [pitch, setPitch] = useState(38),
    [spacing, setSpacing] = useState(160);
  const [tab, setTab] = useState("object"),
    [axis, setAxis] = useState("fault"),
    [leaves, setLeaves] = useState(false);
  const [zoom, setZoom] = useState(0.5),
    [fit, setFit] = useState(true),
    [message, setMessage] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    yaw: number;
    pitch: number;
    moved: boolean;
    node?: string;
  } | null>(null);
  const skipClick = useRef(false);
  const n = atlas.nodes.find((v) => v.id === selected) ?? root;
  const focused = atlas.nodes.find((v) => v.id === focus) ?? root;
  const options = {
    includeOverhead: view === "matrix",
    focus: focused.id,
    depth,
    domain,
    query,
    faultType: fault,
    stage,
    capability,
    status,
    metric,
    spatial: view === "space",
    yaw,
    pitch,
    spacing,
    links,
    topology: view === "topology",
    idPrefix: `atlas-${svgId}`,
  };
  const svg = useMemo(
    () => atlasSvg(atlas, options),
    [
      atlas,
      focus,
      depth,
      domain,
      query,
      fault,
      stage,
      capability,
      status,
      metric,
      view,
      yaw,
      pitch,
      spacing,
      links,
    ],
  );
  const svgWidth = Number(svg.match(/width="([^"]+)"/)?.[1] ?? 1000);
  const shown = atlasVisible(atlas, options);
  const filteredMechanisms = atlas.mechanisms.filter(
    (m) =>
      (!stage || m.stages.includes(stage as any)) &&
      (!capability || m.capabilities.includes(capability as any)) &&
      (!status || m.status === status) &&
      (!fault || m.faultTypes.includes(fault)) &&
      (!domain || m.domains.includes(domain as any)),
  );
  const ms = filteredMechanisms.filter((m) => n.mechanismIds.includes(m.id));
  const es = atlas.events.filter(
    (e) => n.eventIds.includes(e.id) && (!fault || e.type === fault),
  );
  const scales = useMemo(
    () =>
      view === "matrix" && axis === "scale" && result
        ? atlas.scales.map((c) => auditAtlas({ result, events }, c))
        : [atlas],
    [view, axis, result, events, atlas],
  );
  const matrixNodes = shown.filter((v) =>
    leaves ? v.leaf : v.parentId === focused.id,
  );
  const rows = matrixNodes.length
    ? matrixNodes
    : shown.filter((v) => v.id === focused.id);
  const columns =
    axis === "fault"
      ? Object.entries(faultTypeLabels)
      : axis === "scale"
        ? scales.map((s) => [
            String(s.cards),
            s.cards.toLocaleString() +
              "卡" +
              (s.referenceOnly ? "（参考点）" : ""),
          ])
        : filteredMechanisms.map((m) => [m.id, m.name]);
  const max = Math.max(
    0,
    ...rows.flatMap((r) =>
      columns.map(([key]) =>
        Math.abs(matrixCell(atlas, r.id, axis, key, scales).value ?? 0),
      ),
    ),
  );
  useEffect(() => {
    if (!fit || !surface.current) return;
    const el = surface.current;
    const measure = () =>
      setZoom(
        Math.max(
          el.clientWidth < 500 ? 0.75 : 0.4,
          Math.min(1.2, (el.clientWidth - 24) / svgWidth),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, svgWidth, full, view]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    surface.current?.scrollTo(0, 0);
  }, [focus, view]);
  const clear = () => {
    setDomain("");
    setQuery("");
    setFault("");
    setStage("");
    setCapability("");
    setStatus("");
  };
  const selectFrom = (target: HTMLElement) => {
    const id = target
      .closest("[data-atlas-node]")
      ?.getAttribute("data-atlas-node");
    if (id) setSelected(id);
  };
  const exportedSvg =
    view === "matrix"
      ? atlasMatrixSvg(atlas, axis, rows, columns, scales)
      : svg;
  const exportPng = async () => {
    setMessage("");
    const url = URL.createObjectURL(
      new Blob([exportedSvg], { type: "image/svg+xml" }),
    );
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("图像转换失败，请使用SVG导出"));
        img.src = url;
      });
      const factor = Math.min(2, 4096 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(img.width * factor);
      canvas.height = Math.ceil(img.height * factor);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器未提供图像画布，请导出SVG");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG生成失败，请导出SVG");
      download(`remap-atlas-${cards}-${view}.png`, blob);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  let qty: number | null = null;
  try {
    qty = hardwareCount(atlas.architecture, n.id, cards);
  } catch {
    /* solver validates */
  }
  return (
    <section
      className={`audit-atlas ${full ? "atlas-full" : ""}`}
      aria-label="架构故障机制全景"
    >
      <header className="atlas-heading">
        <div>
          <h3>架构 · 故障 · 可靠性机制</h3>
          <p>
            {cards.toLocaleString()}卡 ·{" "}
            {atlas.evaluated ? "已保存计算结果" : "配置预览，尚未计算"} ·
            同一对象逐层对应
          </p>
        </div>
        <button type="button" onClick={() => setFull(!full)}>
          {full ? "退出大屏（Esc）" : "全屏大图"}
        </button>
      </header>
      {atlas.error && (
        <p role="alert">
          {atlas.error}；当前FIT为参考输入，完成数量配置后才可计算。
        </p>
      )}
      <div className="atlas-views" role="group" aria-label="全景显示方式">
        {[
          ...(atlas.architecture.topology ? [["topology", "超节点组网"]] : []),
          ["plan", "平面全景"],
          ["space", "分层空间"],
          ["matrix", "多维热力矩阵"],
        ].map(([id, name]) => (
          <button
            type="button"
            aria-pressed={view === id}
            key={id}
            onClick={() => {
              setView(id);
              setFit(true);
            }}
          >
            {name}
          </button>
        ))}
        <label>
          叠加指标
          <select
            disabled={view === "matrix"}
            aria-label="全景叠加指标"
            value={metric}
            onChange={(e) => setMetric(e.target.value as AtlasMetric)}
          >
            {Object.entries(atlasMetricNames).map(([id, name]) => (
              <option
                key={id}
                value={id}
                disabled={
                  !["structure", "fit", "target", "summary"].includes(id) &&
                  !atlas.evaluated
                }
              >
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="atlas-filter-row">
        <label>
          查看规模
          <select
            aria-label="全景查看规模"
            value={cards}
            onChange={(e) => {
              setCards(Number(e.target.value));
              setFit(true);
            }}
          >
            {[...new Set([...viewScales, inputCards])]
              .sort((a, b) => a - b)
              .map((c) => (
                <option key={c} value={c}>
                  {c.toLocaleString()}卡
                </option>
              ))}
          </select>
        </label>
        <label>
          定位对象
          <input
            aria-label="全景搜索对象"
            placeholder="名称 / 对象ID / 故障ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          功能域
          <select
            aria-label="全景功能域"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          >
            <option value="">全部功能域</option>
            {Object.entries(functionalDomains).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          查看范围
          <select
            aria-label="全景查看层级"
            value={focused.id}
            onChange={(e) => {
              setFocus(e.target.value);
              setSelected(e.target.value);
              setFit(true);
            }}
          >
            {atlas.nodes
              .filter((v) => v.kind !== "overhead")
              .map((v) => (
                <option value={v.id} key={v.id}>
                  {"· ".repeat(v.depth)}
                  {v.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          展开深度
          <select
            aria-label="全景展开深度"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            {[1, 2, 3, 5, 10].map((v) => (
              <option key={v} value={v}>
                {v === 10 ? "全部层级" : v + "层"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={clear}>
          清除筛选
        </button>
      </div>
      <details className="atlas-dimension-filters">
        <summary>按故障与机制定位对象（筛选不改变计算）</summary>
        <div className="atlas-filter-row">
          <label>
            故障类型
            <select
              aria-label="全景故障类型"
              value={fault}
              onChange={(e) => setFault(e.target.value)}
            >
              <option value="">全部类型</option>
              {Object.entries(faultTypeLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            生命周期
            <select
              aria-label="全景生命周期"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="">全部阶段</option>
              {Object.entries(mechanismStages).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            机制能力
            <select
              aria-label="全景机制能力"
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
            >
              <option value="">全部能力</option>
              {Object.entries(mechanismCapabilities).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            部署状态
            <select
              aria-label="全景部署状态"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">已选与候选</option>
              {Object.entries(statusNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <div className="atlas-body">
        <div className="atlas-main">
          <div className="atlas-toolbar">
            <button
              type="button"
              disabled={!focused.parentId}
              onClick={() => {
                setFocus(focused.parentId!);
                setFit(true);
              }}
            >
              上级范围
            </button>
            <button
              type="button"
              onClick={() => {
                setFocus(root.id);
                setFit(true);
              }}
            >
              全系统
            </button>
            {view !== "matrix" && (
              <>
                <button
                  type="button"
                  aria-label="缩小全景"
                  onClick={() => {
                    setFit(false);
                    setZoom(Math.max(0.08, zoom / 1.3));
                  }}
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  aria-label="放大全景"
                  onClick={() => {
                    setFit(false);
                    setZoom(Math.min(3, zoom * 1.3));
                  }}
                >
                  ＋
                </button>
                <button type="button" onClick={() => setFit(true)}>
                  适配显示
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={links}
                    onChange={(e) => setLinks(e.target.checked)}
                  />
                  显示连接
                </label>
              </>
            )}
          </div>
          {view === "space" && (
            <div className="atlas-space-controls">
              <label>
                旋转
                <input
                  aria-label="空间旋转"
                  type="range"
                  min="-65"
                  max="65"
                  value={yaw}
                  onChange={(e) => setYaw(Number(e.target.value))}
                />
              </label>
              <label>
                俯仰
                <input
                  aria-label="空间俯仰"
                  type="range"
                  min="10"
                  max="70"
                  value={pitch}
                  onChange={(e) => setPitch(Number(e.target.value))}
                />
              </label>
              <label>
                层间距
                <input
                  aria-label="空间层间距"
                  type="range"
                  min="80"
                  max="420"
                  value={spacing}
                  onChange={(e) => setSpacing(Number(e.target.value))}
                />
              </label>
            </div>
          )}
          {view !== "matrix" ? (
            <div
              className="atlas-canvas"
              ref={surface}
              tabIndex={0}
              aria-label="可缩放全景画布"
              onPointerDown={(e) => {
                if (e.pointerType === "touch" || e.button !== 0) return;
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  left: e.currentTarget.scrollLeft,
                  top: e.currentTarget.scrollTop,
                  yaw,
                  pitch,
                  moved: false,
                  node:
                    (e.target as Element)
                      .closest("[data-atlas-node]")
                      ?.getAttribute("data-atlas-node") ?? undefined,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const dx = e.clientX - d.x,
                  dy = e.clientY - d.y;
                if (Math.abs(dx) + Math.abs(dy) < 5) return;
                d.moved = true;
                if (view === "space") {
                  setFit(false);
                  setYaw(Math.max(-65, Math.min(65, d.yaw + dx / 5)));
                  setPitch(Math.max(10, Math.min(70, d.pitch + dy / 5)));
                } else {
                  e.currentTarget.scrollLeft = d.left - dx;
                  e.currentTarget.scrollTop = d.top - dy;
                }
              }}
              onPointerUp={(e) => {
                skipClick.current = drag.current?.moved ?? false;
                if (drag.current && !drag.current.moved && drag.current.node)
                  setSelected(drag.current.node);
                drag.current = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onClick={(e) => {
                if (!skipClick.current) selectFrom(e.target as HTMLElement);
                skipClick.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  const el = e.target as HTMLElement;
                  if (el.closest("[data-atlas-node]")) {
                    e.preventDefault();
                    selectFrom(el);
                  }
                }
              }}
            >
              <div
                className="atlas-svg"
                style={{ width: svgWidth * zoom }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          ) : (
            <div className="atlas-matrix">
              <div className="atlas-toolbar">
                <label>
                  矩阵维度
                  <select
                    aria-label="全景矩阵维度"
                    value={axis}
                    onChange={(e) => setAxis(e.target.value)}
                  >
                    <option value="fault">对象 × 故障类型损失</option>
                    <option value="scale" disabled={!result}>
                      对象 × 规模损失
                    </option>
                    <option value="mechanism">对象 × 机制适用关系</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    aria-label="矩阵展开叶层对象"
                    checked={leaves}
                    onChange={(e) => setLeaves(e.target.checked)}
                  />
                  展开叶层对象
                </label>
              </div>
              <p className="note">
                {axis === "mechanism"
                  ? "实色：已选/固定部署；浅色：未选候选；仅表示目录适用关系，不代表成功率或局部贡献。"
                  : `损失单位 h；线性色阶 0～${atlasNumber(max)}，跨规模共用色标；灰色为未计算或数据不完整。`}
              </p>
              <div className="atlas-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>对象 / 功能域</th>
                      {columns.map(([id, name]) => (
                        <th key={id}>{name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <th>
                          <button
                            type="button"
                            onClick={() => setSelected(r.id)}
                          >
                            {r.name}
                          </button>
                          <small>{atlasDomainNames[r.domain]}</small>
                        </th>
                        {columns.map(([key]) => {
                          const c = matrixCell(atlas, r.id, axis, key, scales);
                          const unknown =
                            c.state === "unknown" || c.state === "partial";
                          return (
                            <td
                              key={key}
                              className={unknown ? "unknown" : c.state}
                              style={
                                axis !== "mechanism" && !unknown
                                  ? {
                                      background: `rgba(210,120,55,${0.04 + (max ? (0.65 * (c.value ?? 0)) / max : 0)})`,
                                    }
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                title={c.title}
                                onClick={() => {
                                  setSelected(r.id);
                                  if (axis === "mechanism")
                                    setTab("mechanisms");
                                }}
                              >
                                {c.text}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <p>没有匹配对象。</p>}
              </div>
            </div>
          )}
          <p className="atlas-caption">
            {view === "topology"
              ? "超节点组网参考：代表性层级与区域汇总。板柜密度需项目确认；点击区域关联故障与机制。选择“数量・FIT・可用度”叠加指标查看量化结果；平面全景保留全部自定义连接。"
              : view === "space"
                ? "三维坐标投影：拖动旋转，或用滑块调节；标签保持正向并自动避让。可按层级隔离，避免遮挡。"
                : view === "plan"
                  ? "拖动平移、按钮缩放；小屏保留可读字号，可左右滑动查看。点击或键盘选中模块查看关联明细。容器表示包含，连接依据见证据。"
                  : "行按同级或互斥叶层汇总，不叠加父子层。点击单元格联动右侧详情。"}
          </p>
          <div className="atlas-export" role="group" aria-label="全景导出">
            <button
              type="button"
              onClick={() =>
                download(
                  `remap-atlas-${cards}-${view}.svg`,
                  exportedSvg,
                  "image/svg+xml",
                )
              }
            >
              导出当前视图SVG
            </button>
            <button type="button" onClick={exportPng}>
              导出当前视图PNG
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `remap-atlas-${cards}.json`,
                  JSON.stringify(atlas, null, 2),
                  "application/json",
                )
              }
            >
              导出完整关联数据
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `remap-atlas-${cards}.html`,
                  atlasStandaloneHtml(atlas),
                  "text/html",
                )
              }
            >
              导出全景报告HTML
            </button>
          </div>
          <p className="note">
            图像按当前架构范围与指标导出；完整数据和全景报告保留全部对象，不受筛选裁剪。正式报告同步提供纯架构与诊断数据。
          </p>
          {message && <p role="alert">{message}</p>}
        </div>
        <aside className="atlas-inspector" aria-label="全景对象明细">
          <h4>{n.name}</h4>
          <p className="atlas-path">
            {n.path
              .map((id) => atlas.nodes.find((v) => v.id === id)?.name)
              .join(" → ")}
          </p>
          <button
            type="button"
            onClick={() => {
              setFocus(n.id);
              setFit(true);
            }}
          >
            以此对象为查看范围
          </button>
          <div
            className="atlas-detail-tabs"
            role="group"
            aria-label="对象关联信息"
          >
            {[
              ["object", "对象"],
              ["faults", "故障"],
              ["mechanisms", "机制"],
              ["evidence", "证据"],
            ].map(([id, name]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "object" && (
            <div>
              <dl>
                <dt>物理层级</dt>
                <dd>
                  {hardwareLevels[n.hardwareLevel!] ??
                    (n.parentId ? "自定义对象" : "集群")}
                </dd>
                <dt>主功能域</dt>
                <dd>
                  {atlasDomainNames[n.domain]} · {n.domainBasis}
                </dd>
                <dt>本规模数量</dt>
                <dd>{atlasNumber(qty)}</dd>
                <dt>NPU等效FIT / 区域总事件FIT</dt>
                <dd>
                  {atlasNumber(n.npuEquivalentFit)} /{" "}
                  {atlasNumber(n.aggregateEventFit)}
                </dd>
                <dt>分层目标 / 当前可用度</dt>
                <dd>
                  {n.targetAvailability === null
                    ? "未分配"
                    : (n.targetAvailability * 100).toFixed(4) + "%"}{" "}
                  /{" "}
                  {n.attributedAvailability === null
                    ? "待评估"
                    : (n.attributedAvailability * 100).toFixed(4) + "%"}
                </dd>
              </dl>
              <p className="note">
                区域总事件FIT = NPU等效FIT ×
                实际评估卡数，包含多类故障；当前可用度是系统损失责任投影，非单器件稳态可用度。
                {n.coverageStatus !== "modeled" ? "含未建模故障对象。" : ""}
              </p>
              {onDomainChange && n.kind !== "overhead" && (
                <label>
                  配置主功能域
                  <select
                    aria-label="配置对象主功能域"
                    value={n.functionalDomain ?? ""}
                    onChange={(e) =>
                      onDomainChange(
                        n.id,
                        (e.target.value || undefined) as
                          | FunctionalDomain
                          | undefined,
                      )
                    }
                  >
                    <option value="">按对象 / 子层推导</option>
                    {Object.entries(functionalDomains).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {atlas.evaluated && (
                <div className="atlas-numbers">
                  <div>
                    已建模损失<strong>{atlasNumber(n.actualHours)} h</strong>
                  </div>
                  <div>
                    分层预算
                    <strong>{atlasNumber(n.measured?.allowedHours)} h</strong>
                  </div>
                  <div>
                    对照损失<strong>{atlasNumber(n.baselineHours)} h</strong>
                  </div>
                  <div>
                    减少损失<strong>{atlasNumber(n.improvementHours)} h</strong>
                  </div>
                </div>
              )}
              <p className="note">
                {atlas.comparisonBasis}
                ；对象差值来自事件账，无对象级置信区间。父层与子层不能重复相加。
              </p>
              {n.measured && (
                <p className="note">
                  恢复停机/次 {atlasNumber(n.measured.recoveryPauseSeconds)}{" "}
                  秒；中断事件间隔{" "}
                  {atlasNumber(
                    n.measured.types.find((t: any) => t.type === "hard")
                      ?.intervalHours,
                  )}{" "}
                  小时。事件间隔不是业务中断MTBF。
                </p>
              )}
            </div>
          )}
          {tab === "faults" && (
            <div>
              {es.length ? (
                es.map((e) => (
                  <details key={e.id} open={es.length < 4}>
                    <summary>
                      {e.id} · {faultTypeLabels[e.type]}
                    </summary>
                    <p>{e.description ?? e.domain}</p>
                    <dl>
                      <dt>本规模等效FIT</dt>
                      <dd>
                        {atlasNumber(e.fit)}
                        {atlas.error ? "（参考输入，未完成折算）" : ""}
                      </dd>
                      <dt>事件率 / 非全局停机小时</dt>
                      <dd>{atlasNumber(e.rate)}</dd>
                      <dt>当前 / 对照损失</dt>
                      <dd>
                        {atlasNumber(e.actualLossHours)} /{" "}
                        {atlasNumber(e.baselineLossHours)} h
                      </dd>
                    </dl>
                    <p className="atlas-source">{e.source ?? "来源待补充"}</p>
                  </details>
                ))
              ) : (
                <p>
                  该对象暂无匹配故障。公共开销单独计账，缺少故障数据不代表零风险。
                </p>
              )}
            </div>
          )}
          {tab === "mechanisms" && (
            <div>
              <p className="note">
                可跨对象、域、阶段；适用关系不等于全部覆盖。修改参数后需独立评估。
              </p>
              {ms.map((m) => {
                const contribution = atlas.ranking.find(
                  (r: any) =>
                    r.id === m.id ||
                    r.id ===
                      "policy:" +
                        (
                          {
                            hardDetect: "D-HARD",
                            slowDetect: "D-SLOW",
                            sdcDetect: "D-SDC",
                            step: "R-SDC",
                            replay: "R-REPLAY",
                            process: "R-PROCESS",
                            elastic: "R-ELASTIC",
                            fast: "C-FAST",
                          } as Record<string, string>
                        )[m.id],
                );
                return (
                  <details key={m.id}>
                    <summary>
                      {m.name} · {statusNames[m.status]}
                    </summary>
                    <p>
                      {m.domains.map((d) => atlasDomainNames[d]).join(" / ")} ·{" "}
                      {m.faultTypes.map((t) => faultTypeLabels[t]).join(" / ")}
                    </p>
                    <p>
                      {m.stages.map((v) => mechanismStages[v]).join(" / ")}；
                      {m.capabilities
                        .map((v) => mechanismCapabilities[v])
                        .join(" / ")}
                    </p>
                    <p>{m.effect}</p>
                    <dl>
                      {Object.entries(m.parameters).map(([k, v]) => (
                        <div key={k}>
                          <dt>{parameterLabels[k] ?? k}</dt>
                          <dd>{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                    {!Object.keys(m.parameters).length && (
                      <p>未选候选参数需在方案中明确，未计入本轮。</p>
                    )}
                    {contribution && (
                      <p className="atlas-contribution">
                        本规模全局贡献{" "}
                        {(contribution.statistics.mean * 100).toFixed(4)}{" "}
                        pp；区间 [
                        {(contribution.statistics.ciLow * 100).toFixed(4)},{" "}
                        {(contribution.statistics.ciHigh * 100).toFixed(4)}]
                        pp。不是当前对象的局部Shapley。
                      </p>
                    )}
                    <p className="atlas-source">{m.source}</p>
                    <p className="note">{m.applicability}</p>
                  </details>
                );
              })}
              {!ms.length && <p>当前筛选没有适用机制。</p>}
              <details>
                <summary>本规模完整归因（含改进因子）</summary>
                <p>{atlas.attributionBasis}</p>
                {atlas.ranking.map((r: any) => (
                  <p key={r.id}>
                    {r.name ?? r.id}：{atlasNumber(r.statistics.mean * 100)} pp
                  </p>
                ))}
              </details>
            </div>
          )}
          {tab === "evidence" && (
            <div>
              <p className="atlas-source">{n.source}</p>
              <h5>连接与依赖</h5>
              {atlas.architecture.dependencies
                .filter(
                  (e) =>
                    n.descendants.includes(e.from) ||
                    n.descendants.includes(e.to),
                )
                .map((e, i) => (
                  <p key={i}>
                    {atlas.nodes.find((v) => v.id === e.from)?.name} →{" "}
                    {atlas.nodes.find((v) => v.id === e.to)?.name}：{e.label}
                    <small>{e.source}</small>
                  </p>
                ))}
              <h5>故障传播证据</h5>
              {atlas.propagation
                .filter((p) => n.eventIds.includes(p.eventId))
                .map((p) => (
                  <p key={p.eventId}>
                    {p.eventId}：
                    {p.path
                      .map((id) => atlas.nodes.find((v) => v.id === id)?.name)
                      .join(" → ")}
                    <small>
                      {p.manifestation}；{p.impact}；{p.containment}；{p.source}
                    </small>
                  </p>
                ))}
              <details>
                <summary>计算快照与基础参数</summary>
                <pre>
                  {JSON.stringify(
                    {
                      provenance: atlas.provenance,
                      model: atlas.effectiveModel,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {atlas.notes.map((v) => (
                <p className="note" key={v}>
                  {v}
                </p>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
