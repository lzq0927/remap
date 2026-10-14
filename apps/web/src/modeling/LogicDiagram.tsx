import type {
  EngineeringModel,
  Logic,
  AnalysisCase,
} from "../../../../packages/modeling/src/schema";
type Box = { width: number; height: number };
export default function LogicDiagram({
  logic,
  model,
  method,
  analysisCase,
}: {
  logic: Logic;
  model: EngineeringModel;
  method: string;
  analysisCase?: AnalysisCase;
}) {
  const parameters = (n: Logic) => {
    const f = model.failureModes.find((f) => f.id === n.id);
    if (!f) return ["参数待补充"];
    const effects = model.mechanisms
      .filter((m) => analysisCase?.mechanismRefs.includes(m.id))
      .flatMap((m) => m.effects.filter((e) => e.failureId === f.id));
    if (effects.length > 1) return ["参数作用冲突，请校验"];
    const effect = effects[0],
      rate = effect?.rate ?? f.rate;
    const formatRate = (r: typeof rate) =>
      r ? `${r.value} ${r.unit}` : "失效率待补充";
    const lines = [
      analysisCase?.metric === "probability"
        ? f.probability === null
          ? "失效概率待补充"
          : `失效概率 ${(f.probability * 100).toFixed(3)}%`
        : effect?.rate
          ? `${formatRate(f.rate)} → ${formatRate(rate)}`
          : formatRate(rate),
    ];
    if (analysisCase?.metric === "availability") {
      const from = f.recoveryHours ?? "待补充",
        to = effect?.recoveryHours;
      lines.push(
        `MTTR ${from}${to !== undefined && to !== from ? ` → ${to}` : ""} h`,
      );
    }
    return lines;
  };
  const eventLabel = (n: Logic) => {
    const failure = model.failureModes.find((f) => f.id === n.id);
    const entity = model.entities.find((e) => e.id === failure?.entityId);
    return (
      (method === "rbd" ? entity?.name : undefined) ??
      failure?.name ??
      n.id ??
      "未选事件"
    );
  };
  const label = (n: Logic) =>
    n.type === "event"
      ? eventLabel(n)
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
    if (n.type === "event") return { width: 170, height: 96 };
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
          <title>
            {[
              label(n),
              `故障模式：${model.failureModes.find((f) => f.id === n.id)?.name ?? n.id}`,
              ...parameters(n),
            ].join("；")}
          </title>
          <rect
            x={x}
            y={y + box.height / 2 - 36}
            width="170"
            height="72"
            rx="5"
            fill="#f4f9f4"
            stroke="#5d8f78"
          />
          <text
            x={x + 85}
            y={y + box.height / 2 - 13}
            textAnchor="middle"
            fontSize="12"
          >
            {label(n)}
          </text>
          {parameters(n).map((line, i) => (
            <text
              key={i}
              x={x + 85}
              y={y + box.height / 2 + 5 + i * 16}
              textAnchor="middle"
              fontSize="10"
              fill="#426451"
            >
              {line}
            </text>
          ))}
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
        <p className="note">
          方框表示对象提供服务的成功条件；FIT 对应本案例引用的故障模式，MTTR
          为平均恢复时间。
        </p>
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
      y = 45 + depth * 110;
    nodes.push({ n, x, y, key });
    children.forEach((cx) => edges.push({ x, y, cx, cy: y + 110 }));
    return x;
  };
  layout(logic, 0, "root");
  return (
    <div className="eng-logic">
      <svg
        role="img"
        aria-label="故障树"
        viewBox={`0 0 ${Math.max(200, leaf * 185)} ${depthMax * 110 + 100}`}
        style={{ minWidth: Math.min(leaf * 185, 1800) }}
      >
        {edges.map((e, i) => (
          <path
            key={i}
            d={`M${e.x} ${e.y + 22} V${e.y + 53} H${e.cx} V${e.cy - 22}`}
            stroke="#9a7867"
            fill="none"
          />
        ))}
        {nodes.map(({ n, x, y, key }) => (
          <g key={key}>
            <title>
              {[label(n), ...(n.type === "event" ? parameters(n) : [])].join(
                "；",
              )}
            </title>
            <rect
              x={x - 75}
              y={y - (n.type === "event" ? 36 : 22)}
              width="150"
              height={n.type === "event" ? 72 : 44}
              rx={n.type === "event" ? 20 : 3}
              fill={n.type === "event" ? "#fff8f1" : "#eee6dc"}
              stroke="#a6836c"
            />
            <text
              x={x}
              y={y + (n.type === "event" ? -13 : 4)}
              textAnchor="middle"
              fontSize="12"
            >
              {label(n)}
            </text>
            {n.type === "event" &&
              parameters(n).map((line, i) => (
                <text
                  key={i}
                  x={x}
                  y={y + 5 + i * 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#795640"
                >
                  {line}
                </text>
              ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
