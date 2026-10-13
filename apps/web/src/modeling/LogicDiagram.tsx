import type {
  EngineeringModel,
  Logic,
} from "../../../../packages/modeling/src/schema";
type Box = { width: number; height: number };
export default function LogicDiagram({
  logic,
  model,
  method,
}: {
  logic: Logic;
  model: EngineeringModel;
  method: string;
}) {
  const label = (n: Logic) =>
    n.type === "event"
      ? (model.failureModes.find((f) => f.id === n.id)?.name ??
        n.id ??
        "未选事件")
      : n.type === "kofn"
        ? `${n.k} / ${n.children?.length}`
        : (
            {
              series: "串联",
              parallel: "并联",
              and: "AND",
              or: "OR",
            } as Record<string, string>
          )[n.type];
  const shape = (n: Logic): Box => {
    if (n.type === "event") return { width: 170, height: 75 };
    const children = (n.children ?? []).map(shape);
    if (!children.length) return { width: 170, height: 75 };
    return n.type === "series"
      ? {
          width:
            children.reduce((a, b) => a + b.width, 0) +
            40 * (children.length - 1),
          height: Math.max(...children.map((c) => c.height)),
        }
      : {
          width: Math.max(...children.map((c) => c.width)) + 100,
          height:
            children.reduce((a, b) => a + b.height, 0) +
            35 * (children.length - 1) +
            25,
        };
  };
  const drawRbd = (
    n: Logic,
    x: number,
    y: number,
    key: string,
  ): React.ReactNode => {
    const box = shape(n);
    if (n.type === "event")
      return (
        <g key={key}>
          <rect
            x={x}
            y={y + box.height / 2 - 24}
            width="170"
            height="48"
            rx="5"
            fill="#f4f9f4"
            stroke="#5d8f78"
          />
          <text
            x={x + 85}
            y={y + box.height / 2 + 4}
            textAnchor="middle"
            fontSize="12"
          >
            {label(n)}
          </text>
        </g>
      );
    if (n.type === "series") {
      let dx = x;
      return (
        <g key={key}>
          {(n.children ?? []).map((c, i) => {
            const cb = shape(c),
              cx = dx;
            dx += cb.width + 40;
            return (
              <g key={i}>
                {i > 0 && (
                  <line
                    x1={cx - 40}
                    x2={cx}
                    y1={y + box.height / 2}
                    y2={y + box.height / 2}
                    stroke="#527465"
                  />
                )}
                {drawRbd(
                  c,
                  cx,
                  y + (box.height - cb.height) / 2,
                  key + "." + i,
                )}
              </g>
            );
          })}
        </g>
      );
    }
    let dy = y + 25;
    return (
      <g key={key}>
        <text
          x={x + box.width / 2}
          y={y + 13}
          textAnchor="middle"
          fontSize="12"
        >
          {label(n)}
        </text>
        {(n.children ?? []).map((c, i) => {
          const cb = shape(c),
            cy = dy;
          dy += cb.height + 35;
          return (
            <g key={i}>
              <path
                d={`M${x} ${y + box.height / 2} V${cy + cb.height / 2} H${x + 50} M${x + 50 + cb.width} ${cy + cb.height / 2} H${x + box.width} V${y + box.height / 2}`}
                fill="none"
                stroke="#527465"
              />
              {drawRbd(c, x + 50, cy, key + "." + i)}
            </g>
          );
        })}
      </g>
    );
  };
  if (method === "rbd") {
    const box = shape(logic);
    return (
      <div className="eng-logic">
        <svg
          role="img"
          aria-label="可靠性成功路径框图"
          viewBox={`0 0 ${box.width + 100} ${box.height + 40}`}
          style={{ minWidth: Math.min(box.width + 100, 1800) }}
        >
          <circle cx="15" cy={box.height / 2 + 20} r="6" fill="#527465" />
          <line
            x1="21"
            x2="45"
            y1={box.height / 2 + 20}
            y2={box.height / 2 + 20}
            stroke="#527465"
          />
          {drawRbd(logic, 45, 20, "root")}
          <line
            x1={45 + box.width}
            x2={80 + box.width}
            y1={box.height / 2 + 20}
            y2={box.height / 2 + 20}
            stroke="#527465"
          />
          <circle
            cx={85 + box.width}
            cy={box.height / 2 + 20}
            r="6"
            fill="#527465"
          />
        </svg>
      </div>
    );
  }
  const nodes: Array<{ n: Logic; x: number; y: number; key: string }> = [],
    edges: Array<{ x: number; y: number; cx: number; cy: number }> = [];
  let leaf = 0,
    depthMax = 0;
  const layout = (n: Logic, depth: number, key: string): number => {
    depthMax = Math.max(depthMax, depth);
    const children =
      n.children?.map((c, i) => layout(c, depth + 1, key + "." + i)) ?? [];
    const x = children.length
        ? children.reduce((a, b) => a + b, 0) / children.length
        : 85 + leaf++ * 185,
      y = 35 + depth * 95;
    nodes.push({ n, x, y, key });
    children.forEach((cx) => edges.push({ x, y, cx, cy: y + 95 }));
    return x;
  };
  layout(logic, 0, "root");
  return (
    <div className="eng-logic">
      <svg
        role="img"
        aria-label="故障树"
        viewBox={`0 0 ${Math.max(200, leaf * 185)} ${depthMax * 95 + 90}`}
        style={{ minWidth: Math.min(leaf * 185, 1800) }}
      >
        {edges.map((e, i) => (
          <path
            key={i}
            d={`M${e.x} ${e.y + 22} V${e.y + 47} H${e.cx} V${e.cy - 22}`}
            stroke="#9a7867"
            fill="none"
          />
        ))}
        {nodes.map(({ n, x, y, key }) => (
          <g key={key}>
            <rect
              x={x - 75}
              y={y - 22}
              width="150"
              height="44"
              rx={n.type === "event" ? 20 : 3}
              fill={n.type === "event" ? "#fff8f1" : "#eee6dc"}
              stroke="#a6836c"
            />
            <text x={x} y={y + 4} textAnchor="middle" fontSize="12">
              {label(n)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
