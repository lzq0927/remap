import { useEffect, useRef, useState } from "react";
import FullscreenLayer from "./FullscreenLayer";
import {
  decisionPageSvg,
  decisionViews,
  type DecisionView,
} from "../../../packages/reports/src/audit-decision-pages";
import "./audit-atlas.css";
export default function AuditDecisionDiagram({ result }: { result: any }) {
  const [view, setView] = useState<DecisionView>("architecture"),
    [cards, setCards] = useState(result.request?.cards ?? 500000),
    [detail, setDetail] = useState("");
  const [full, setFull] = useState(false),
    [zoom, setZoom] = useState(0.5),
    [fit, setFit] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const svg = decisionPageSvg(result, cards, view);
  const width = Number(svg.match(/width="([^"]+)"/)?.[1] ?? 2400);
  useEffect(() => {
    if (!fit || !viewport.current) return;
    const el = viewport.current,
      measure = () => setZoom(Math.min(1, (el.clientWidth - 20) / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, full, width]);
  if (!svg) return null;
  const content = (
    <section
      className={`decision-diagram ${full ? "decision-diagram-full" : ""}`}
      aria-label="三档综合决策图"
    >
      <div className="decision-diagram-toolbar">
        <strong>架构、损失与改进要求</strong>
        <select
          aria-label="决策图规模"
          value={cards}
          onChange={(e) => {
            setCards(Number(e.target.value));
            setDetail("");
          }}
        >
          {(
            result.topologyDecision?.scales ??
            result.architectureDiagnosis?.scales ??
            []
          ).map((s: any) => (
            <option key={s.cards} value={s.cards}>
              {s.cards / 10000}万卡
            </option>
          ))}
        </select>
        <div
          className="decision-view-tabs"
          role="group"
          aria-label="决策图视图"
        >
          {decisionViews.map((v) => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
                setFit(true);
                setDetail("");
              }}
            >
              {v.name}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const u = URL.createObjectURL(
              new Blob([svg], { type: "image/svg+xml" }),
            );
            const a = document.createElement("a");
            a.href = u;
            a.download = `ReMAP-${view}-${cards}.svg`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          }}
        >
          导出当前图 SVG
        </button>
        <button type="button" onClick={() => setFull(!full)}>
          {full ? "退出总图全屏（Esc）" : "全屏查看三档总图"}
        </button>
        <button
          type="button"
          aria-label="缩小决策图"
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
          aria-label="放大决策图"
          onClick={() => {
            setFit(false);
            setZoom(Math.min(3, zoom * 1.3));
          }}
        >
          ＋
        </button>
        <button type="button" onClick={() => setFit(true)}>
          适配宽度
        </button>
        <small>拖动画布 / 触屏滚动 · 放大查看模块数值</small>
      </div>
      {detail && (
        <p role="status" className="decision-node-detail">
          {detail}
          <button onClick={() => setDetail("")}>关闭详情</button>
        </p>
      )}
      <div
        onClick={(e) => {
          const target = (e.target as Element).closest("[data-decision-node]");
          if (target) setDetail(target.textContent ?? "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            const target = (e.target as Element).closest(
              "[data-decision-node]",
            );
            if (target) {
              e.preventDefault();
              setDetail(target.textContent ?? "");
            }
          }
        }}
        className="decision-diagram-viewport"
        ref={viewport}
        tabIndex={0}
        aria-label="三档总图画布"
        onPointerDown={(e) => {
          if (
            e.pointerType === "touch" ||
            e.button !== 0 ||
            (e.target as Element).closest("[data-decision-node]")
          )
            return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: e.currentTarget.scrollLeft,
            top: e.currentTarget.scrollTop,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            e.currentTarget.scrollLeft = d.left + d.x - e.clientX;
            e.currentTarget.scrollTop = d.top + d.y - e.clientY;
          }
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          style={{ width: width * zoom }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </section>
  );
  return full ? (
    <FullscreenLayer label="三档决策总图全屏" onClose={() => setFull(false)}>
      {content}
    </FullscreenLayer>
  ) : (
    content
  );
}
