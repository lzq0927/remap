import { useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { EngineeringModel } from "../../../../packages/modeling/src/schema";
import { labels, uid, download, type ModelEdit } from "./shared";

export default function ModelCanvas({
  model,
  edit,
  selected,
  onSelect,
  revision,
  dirty,
}: {
  model: EngineeringModel;
  edit: ModelEdit;
  selected: string;
  onSelect: (id: string) => void;
  revision: number;
  dirty: boolean;
}) {
  const [viewId, setViewId] = useState(model.views[0]?.id ?? "architecture");
  const [category, setCategory] = useState(""),
    [impact, setImpact] = useState(""),
    [query, setQuery] = useState("");
  const [nodeState, setNodeState, onNodesChange] = useNodesState<Node>([]);
  const view = model.views.find((v) => v.id === viewId) ?? model.views[0];
  const entities = model.entities.filter(
    (e) =>
      (!view || !view.entityRefs.length || view.entityRefs.includes(e.id)) &&
      (!query || e.name.toLowerCase().includes(query.toLowerCase())) &&
      ((!category && !impact) ||
        model.failureModes.some(
          (f) =>
            f.entityId === e.id &&
            (!category || f.category === category) &&
            (!impact || f.impacts.includes(impact)),
        )),
  );
  const nodes: Node[] = entities.map((e, i) => ({
    id: e.id,
    position: view?.positions[e.id] ?? {
      x: (i % 3) * 220 + 50,
      y: Math.floor(i / 3) * 120 + 50,
    },
    data: {
      label: (
        <>
          <strong>{e.name}</strong>
          <small>{labels[e.kind] ?? e.kind}</small>
          <small>
            {model.failureModes
              .filter((f) => f.entityId === e.id)
              .map((f) =>
                f.rate ? `${f.rate.value} ${f.rate.unit}` : "失效率待配置",
              )
              .join(" · ")}
          </small>
          <span>
            {model.mechanisms
              .filter((m) => m.entityRefs.includes(e.id))
              .map((m) => (
                <em key={m.id}>{m.name}</em>
              ))}
          </span>
        </>
      ),
    },
    selected: selected === e.id,
    style: {
      width: 190,
      borderColor: selected === e.id ? "#1f675c" : "#adc6bc",
      background: "#fff",
      borderRadius: 10,
    },
    ariaLabel: e.name,
  }));
  useEffect(
    () =>
      setNodeState((current) =>
        nodes.map((n) => ({
          ...n,
          measured: current.find((old) => old.id === n.id)?.measured,
        })),
      ),
    [model, view, category, impact, query, selected, setNodeState],
  );
  const edges: Edge[] = model.relations
    .filter(
      (r) =>
        entities.some((e) => e.id === r.source) &&
        entities.some((e) => e.id === r.target) &&
        (view?.kind === "deployment"
          ? ["contains", "deployedOn", "dependsOn"].includes(r.kind)
          : view?.kind === "functional"
            ? ["flow", "implements", "dependsOn"].includes(r.kind)
            : true),
    )
    .map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      label: r.label || labels[r.kind],
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: "#56867a",
        strokeDasharray: r.kind === "dependsOn" ? "5 3" : undefined,
      },
    }));
  const ensureView = (draft: EngineeringModel) => {
    let v = draft.views.find((v) => v.id === (view?.id ?? viewId));
    if (!v) {
      v = {
        id: viewId,
        name: labels[viewId] ?? "系统视图",
        kind: "architecture",
        entityRefs: [],
        positions: {},
      };
      draft.views.push(v);
    }
    return v;
  };
  const exportSvg = () => {
    const minX = Math.min(0, ...nodes.map((n) => n.position.x)),
      minY = Math.min(0, ...nodes.map((n) => n.position.y));
    const exportNodes = nodes.map((n) => ({
      ...n,
      position: { x: n.position.x - minX, y: n.position.y - minY },
    }));
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          })[c]!,
      );
    const w = Math.max(900, ...exportNodes.map((n) => n.position.x + 240)),
      h = Math.max(400, ...exportNodes.map((n) => n.position.y + 180));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f6faf7"/><text x="20" y="24" font-size="16">${escape(model.name)} · v${revision}${dirty ? " 草稿" : ""} · ${escape(view?.name ?? "系统图")}</text>${edges
      .map((e) => {
        const s = exportNodes.find((n) => n.id === e.source)!,
          t = exportNodes.find((n) => n.id === e.target)!;
        return `<path d="M${s.position.x + 95},${s.position.y + 95} L${t.position.x + 95},${t.position.y + 45}" stroke="#56867a" fill="none"/>`;
      })
      .join(
        "",
      )}${exportNodes.map((n) => `<g transform="translate(${n.position.x},${n.position.y + 40})"><rect width="190" height="65" rx="8" fill="white" stroke="#56867a"/><text x="12" y="28" font-size="14">${escape(model.entities.find((e) => e.id === n.id)!.name)}</text><text x="12" y="48" font-size="11">${escape(n.id)}</text></g>`).join("")}</svg>`;
    return svg;
  };
  return (
    <section className="eng-canvas-panel">
      <div className="eng-toolbar">
        <label>
          新增视图
          <select
            aria-label="新增视图"
            value=""
            onChange={(e) => {
              const kind = e.target
                .value as EngineeringModel["views"][number]["kind"];
              const id = uid("view");
              edit((d) =>
                d.views.push({
                  id,
                  name: labels[kind] + " " + (d.views.length + 1),
                  kind,
                  entityRefs: [],
                  positions: {},
                }),
              );
              setViewId(id);
            }}
          >
            <option value="">选择图类型</option>
            {(["architecture", "deployment", "functional"] as const).map(
              (k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          设计视图
          <select
            aria-label="设计视图"
            value={view?.id ?? viewId}
            onChange={(e) => setViewId(e.target.value)}
          >
            {model.views.length ? (
              model.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))
            ) : (
              <option value="architecture">架构与组网</option>
            )}
          </select>
        </label>
        <label>
          故障来源
          <select
            aria-label="显示故障来源"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部来源</option>
            {[...new Set(model.failureModes.map((f) => f.category))].map(
              (c) => (
                <option key={c} value={c}>
                  {labels[c] ?? c}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          功能影响
          <select
            aria-label="显示功能影响"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
          >
            <option value="">全部影响</option>
            {[...new Set(model.failureModes.flatMap((f) => f.impacts))].map(
              (c) => (
                <option key={c} value={c}>
                  {labels[c] ?? c}
                </option>
              ),
            )}
          </select>
        </label>
        <input
          aria-label="搜索对象"
          placeholder="搜索对象"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="eng-canvas" aria-label="系统设计画布">
        <ReactFlow
          nodes={nodeState}
          edges={edges}
          fitView
          minZoom={0.2}
          maxZoom={2}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onSelect(n.id)}
          onNodeDragStop={(_, n) =>
            edit((d) => {
              ensureView(d).positions[n.id] = n.position;
            })
          }
          onConnect={(c) => {
            if (c.source && c.target)
              edit((d) =>
                d.relations.push({
                  id: uid("relation"),
                  source: c.source!,
                  target: c.target!,
                  kind: "connectsTo",
                  label: "",
                  sourceRefs: [],
                }),
              );
          }}
          deleteKeyCode={null}
        >
          <Background gap={20} color="#d5e1db" />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <div className="actions">
        {selected &&
          model.entities.some((e) => e.id === selected) &&
          (["x", "y"] as const).map((axis) => (
            <label key={axis}>
              对象 {axis.toUpperCase()}
              <input
                aria-label={"对象位置 " + axis.toUpperCase()}
                type="number"
                style={{ width: 80 }}
                value={
                  nodes.find((n) => n.id === selected)?.position[axis] ?? 0
                }
                onChange={(e) =>
                  edit((d) => {
                    const v = ensureView(d);
                    v.positions[selected] = {
                      ...(v.positions[selected] ??
                        nodes.find((n) => n.id === selected)?.position ?? {
                          x: 0,
                          y: 0,
                        }),
                      [axis]: Number(e.target.value),
                    };
                  })
                }
              />
            </label>
          ))}
        <button
          onClick={() =>
            edit((d) => {
              const v = ensureView(d);
              d.entities.forEach(
                (e, i) =>
                  (v.positions[e.id] = {
                    x: (i % 3) * 250 + 50,
                    y: Math.floor(i / 3) * 150 + 50,
                  }),
              );
            })
          }
        >
          自动排版
        </button>
        <button
          onClick={() =>
            download("system-view.svg", exportSvg(), "image/svg+xml")
          }
        >
          导出 SVG
        </button>
        <button
          onClick={() => {
            const img = new Image(),
              url = URL.createObjectURL(
                new Blob([exportSvg()], { type: "image/svg+xml" }),
              );
            img.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = img.width;
              canvas.height = img.height;
              canvas.getContext("2d")!.drawImage(img, 0, 0);
              canvas.toBlob((b) => {
                if (b) download("system-view.png", b, "image/png");
                URL.revokeObjectURL(url);
              });
            };
            img.src = url;
          }}
        >
          导出 PNG
        </button>
        <span className="note">
          显示 {entities.length}/{model.entities.length}{" "}
          个对象；筛选不改变分析范围
        </span>
      </div>
    </section>
  );
}
