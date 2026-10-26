import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Position,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AuditAtlas } from "../../../packages/analysis/src/audit-atlas";
import {
  atlasMetricNames,
  atlasColors,
  atlasVisible,
  atlasValue,
  atlasNumber,
  type AtlasViewOptions,
} from "../../../packages/reports/src/audit-atlas";
import { atlasDomainNames } from "../../../packages/contracts/src/audit-atlas";

/** One containment level at a time. Edges describe containment, not reliability gates. */
export default function AuditAtlasFlow({
  atlas,
  options,
  selected,
  onSelect,
  onFocus,
}: {
  atlas: AuditAtlas;
  options: AtlasViewOptions;
  selected: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const resize = () =>
      setColumns(el.clientWidth < 500 ? 1 : el.clientWidth < 850 ? 2 : 3);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { nodes, edges, focused } = useMemo(() => {
    const focused =
      atlas.nodes.find((n) => n.id === options.focus) ??
      atlas.nodes.find((n) => !n.parentId)!;
    const visible = atlasVisible(atlas, { ...options, depth: 10 });
    const children = options.query
      ? visible.filter((n) => n.leaf && n.id !== focused.id)
      : visible.filter((n) => n.parentId === focused.id);
    const shown = [focused, ...children];
    const metric = options.metric ?? "structure",
      w = 264,
      h = 142;
    const maxCols = Math.max(1, Math.min(columns, children.length));
    const nodes: Node[] = shown.map((n, i) => {
      const value = atlasValue(n, metric),
        count = atlas.nodes.filter((v) => v.parentId === n.id).length;
      const pct = (v: number | null) =>
        v == null ? "待评估" : `${(v * 100).toFixed(3)}%`;
      return {
        id: n.id,
        width: w,
        height: h,
        position:
          i === 0
            ? { x: ((maxCols - 1) * (w + 38)) / 2, y: 12 }
            : {
                x: ((i - 1) % maxCols) * (w + 38),
                y: 230 + Math.floor((i - 1) / maxCols) * 182,
              },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        selected: selected === n.id,
        style: {
          width: w,
          height: h,
          borderRadius: 10,
          background: "white",
          border: `1.5px solid ${selected === n.id ? "#4775ae" : "#cbd8e6"}`,
          padding: 0,
          boxShadow: "0 4px 12px #223d5c0a",
        },
        data: {
          label: (
            <div className="atlas-flow-card">
              <div
                className="atlas-flow-domain"
                style={{ background: atlasColors[n.domain] }}
              >
                {atlasDomainNames[n.domain]}
                <span>
                  {i === 0 ? "当前层" : count ? `${count}个子层` : "叶对象"}
                </span>
              </div>
              <strong>{n.name}</strong>
              <small>
                {metric === "structure"
                  ? `数量 ${atlasNumber(n.quantity)} · ${n.eventIds.length}类关联故障`
                  : metric === "summary"
                    ? `等效FIT ${atlasNumber(n.npuEquivalentFit)} · A ${pct(n.attributedAvailability)}`
                    : `${atlasMetricNames[metric]} ${["availability", "target"].includes(metric) ? pct(value) : atlasNumber(value)}`}
              </small>
              <div className="atlas-flow-card-actions">
                <button
                  className="nodrag nopan"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(n.id);
                  }}
                >
                  关联详情
                </button>
                {count > 0 && i > 0 && (
                  <button
                    className="nodrag nopan"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocus(n.id);
                    }}
                  >
                    展开此层 →
                  </button>
                )}
              </div>
            </div>
          ),
        },
      };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = children.map((n, i) => ({
      id: `contains-${n.id}`,
      source: focused.id,
      target: n.id,
      type: "smoothstep",
      label: i === 0 ? (options.query ? "范围内匹配" : "包含") : undefined,
      style: { stroke: "#adbdd0", strokeWidth: 1.3 },
      labelStyle: { fill: "#687f98", fontSize: 11 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#adbdd0",
        width: 12,
        height: 12,
      },
    }));
    if (options.links !== false)
      atlas.architecture.dependencies
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .forEach((e, i) =>
          edges.push({
            id: `dependency-${i}`,
            source: e.from,
            target: e.to,
            label: e.label,
            type: "smoothstep",
            style: {
              stroke: "#5375b7",
              strokeWidth: 1.6,
              strokeDasharray: "5 4",
            },
            labelStyle: { fontSize: 10 },
            zIndex: 3,
          }),
        );
    return { nodes, edges, focused };
  }, [atlas, options, selected, onFocus, onSelect, columns]);
  return (
    <div ref={surface}>
      <nav className="atlas-breadcrumb" aria-label="架构层级路径">
        {focused.path.map((id, i) => (
          <span key={id}>
            {i > 0 && " / "}
            <button
              type="button"
              onClick={() => onFocus(id)}
              aria-current={id === focused.id ? "location" : undefined}
            >
              {atlas.nodes.find((n) => n.id === id)?.name}
            </button>
          </span>
        ))}
      </nav>
      <p className="note">
        实线表示包含关系，虚线表示已记录的连接或依赖。逐层展开；可拖动画布，使用小地图定位。
      </p>
      <div className="atlas-flow" aria-label="交互分层拓扑画布">
        <ReactFlow
          key={`${atlas.cards}-${focused.id}-${columns}-${options.query}-${options.domain}`}
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{
            padding: 0.15,
            minZoom: 0.85,
            maxZoom: 1,
            nodes:
              columns === 1
                ? nodes.slice(0, 2).map((n) => ({ id: n.id }))
                : undefined,
          }}
          minZoom={0.3}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, n) => onSelect(n.id)}
          onNodeDoubleClick={(_, n) => onFocus(n.id)}
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": "放大拓扑",
            "controls.zoomOut.ariaLabel": "缩小拓扑",
            "controls.fitView.ariaLabel": "适配拓扑",
            "minimap.ariaLabel": "拓扑导航小地图",
          }}
        >
          <Background color="#d5dfe9" gap={22} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={() => "#c7d9e8"} />
        </ReactFlow>
      </div>
    </div>
  );
}
