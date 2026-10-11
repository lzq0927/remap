export default function StaticDiagram({
  json,
  method,
}: {
  json: string;
  method: string;
}) {
  let input: any;
  try {
    input = JSON.parse(json);
  } catch {
    return <p className="note">输入合法 JSON 后显示模型图。</p>;
  }
  if (!input.tree) return null;
  const nodes: any[] = [],
    edges: any[] = [];
  let leaf = 0,
    maxDepth = 0;
  function layout(node: any, depth: number, path: string): number {
    if (depth > 30 || nodes.length >= 150)
      throw new Error("图形过大，请缩小查看范围");
    maxDepth = Math.max(maxDepth, depth);
    const children = node.children ?? [];
    const positions = children.map((child: any, i: number) =>
      layout(child, depth + 1, path + "." + i),
    );
    const x = positions.length
      ? positions.reduce((a: number, b: number) => a + b, 0) / positions.length
      : 70 + leaf++ * 130;
    const y = 40 + depth * 90;
    const current = { ...node, x, y, key: path };
    nodes.push(current);
    children.forEach((_: any, i: number) =>
      edges.push({ x1: x, y1: y + 20, x2: positions[i], y2: y + 70 }),
    );
    return x;
  }
  try {
    layout(input.tree, 0, "root");
  } catch (e) {
    return <p className="note">{(e as Error).message}</p>;
  }
  const labels: Record<string, string> = {
    series: "串联",
    parallel: "并联",
    and: "AND",
    or: "OR",
    kofn: "k / n",
    event: "基本事件",
  };
  return (
    <div className="static-diagram">
      <span className="eyebrow">
        {method.toUpperCase()} / 同 ID 基本事件共享
      </span>
      <svg
        role="img"
        aria-label="当前输入的布尔结构图"
        viewBox={`0 0 ${Math.max(300, leaf * 130 + 10)} ${maxDepth * 90 + 90}`}
        style={{ minWidth: Math.max(300, leaf * 130), maxHeight: 400 }}
      >
        {edges.map((e, i) => (
          <path
            key={i}
            d={`M${e.x1} ${e.y1} V${e.y1 + 25} H${e.x2} V${e.y2}`}
            fill="none"
            stroke="#9fb8a9"
          />
        ))}
        {nodes.map((n) => (
          <g key={n.key} transform={`translate(${n.x - 52},${n.y - 20})`}>
            <rect
              width="104"
              height="44"
              rx="4"
              fill={n.type === "event" ? "#f8fbf4" : "#e8f1e8"}
              stroke="#88a68e"
            />
            <text
              x="52"
              y="17"
              textAnchor="middle"
              fontSize="11"
              fill="#31503c"
            >
              {n.id ?? labels[n.type] ?? n.type}
            </text>
            <text x="52" y="33" textAnchor="middle" fontSize="9" fill="#7e9582">
              {n.type === "event"
                ? `P = ${n.probability ?? input.events?.[n.id] ?? "待输入"}`
                : n.type === "kofn"
                  ? `${n.k} / ${n.children?.length}`
                  : labels[n.type]}
            </text>
          </g>
        ))}
      </svg>
      <p className="note">
        图形由当前 tree 生成；编辑连接必须修改
        children，求解使用同一输入。共享事件由精确 BDD 统一处理。
      </p>
    </div>
  );
}
