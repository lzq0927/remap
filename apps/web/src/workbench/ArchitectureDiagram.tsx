import { createContext, useContext, useState, type ReactNode } from "react";
import {
  diagramSlots,
  type DiagramSlot,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { count, duration, fit, hours, percent, scale, times } from "./format";
import { Status, useTooltip, type Tone } from "./ui";

export type DiagramView = "target" | "baseline" | "design";
const viewNames: Record<DiagramView, string> = {
  target: "目标",
  baseline: "现状",
  design: "设计后",
};
const toneOf = (usage: number): Tone =>
  usage <= 1 ? "good" : usage <= 1.2 ? "warn" : "bad";
const usageLabel = (usage: number) =>
  usage <= 1 ? "占用预算 " + percent(usage, 0) : "超预算 " + times(usage);

// 图上的颜色：绿色系为计算部件，蓝色系为网络部件；状态色只用于器件底色和标记圆点。
const ink = "#101828",
  muted = "#667085",
  frame = "#c9d4e2",
  compute = "#0d7668",
  computeFill = "#e6f4ee",
  computeStroke = "#8dbfae",
  network = "#3b5bbd",
  networkPanel = "#f3f6fd",
  networkStroke = "#bccbe9",
  accent = "#1d5fd0";
/** 损失占比分档（单一暖色由浅到深）；低于第一档不着色。 */
const heatSteps = [
  { from: 0.2, fill: "#f2a56b", label: "20% 以上" },
  { from: 0.1, fill: "#f8c79c", label: "10–20%" },
  { from: 0.03, fill: "#fde7d3", label: "3–10%" },
];
const heatOf = (share: number) =>
  heatSteps.find((step) => share >= step.from) ?? null;
const toneColors: Record<Tone, { fill: string; stroke: string; dot: string }> =
  {
    good: { fill: "#e1f4e7", stroke: "#5fb37c", dot: "#0ca30c" },
    warn: { fill: "#fff0c7", stroke: "#d9a21b", dot: "#e09a00" },
    bad: { fill: "#fcdcd8", stroke: "#d9695f", dot: "#d03b3b" },
    idle: { fill: "", stroke: "", dot: accent },
  };

interface SlotInfo {
  ids: string[];
  name: string;
  availability: number;
  targetAvailability: number;
  fitPerCard: number;
  mtbfHours: number;
  mttrHours: number;
  lossHours: number;
  budgetHours: number;
  usage: number;
  /** 占全部故障损失的比例。 */
  share: number;
  tone: Tone;
}

const T = ({
  x,
  y,
  size = 12,
  weight = 400,
  fill = ink,
  anchor,
  children,
}: {
  x: number;
  y: number;
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: "middle" | "end";
  children: ReactNode;
}) => (
  <text
    x={x}
    y={y}
    fontSize={size}
    fontWeight={weight}
    fill={fill}
    textAnchor={anchor}
  >
    {children}
  </text>
);
const Box = ({
  x,
  y,
  w,
  h,
  fill = "#fff",
  stroke = frame,
  r = 8,
  dashed,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  r?: number;
  dashed?: boolean;
}) => (
  <rect
    x={x}
    y={y}
    width={w}
    height={h}
    rx={r}
    fill={fill}
    stroke={stroke}
    strokeDasharray={dashed ? "5 4" : undefined}
  />
);
const Link = ({
  d,
  color = network,
  dashed,
}: {
  d: string;
  color?: string;
  dashed?: boolean;
}) => (
  <path
    d={d}
    fill="none"
    stroke={color}
    strokeWidth={2.2}
    strokeDasharray={dashed ? "5 4" : undefined}
  />
);

interface TopoContext {
  slots: Record<DiagramSlot, SlotInfo | null>;
  active: DiagramView;
  onSelect?: (moduleId: string) => void;
  bind: ReturnType<typeof useTooltip>["bind"];
  describe: (info: SlotInfo) => string;
  details: (info: SlotInfo) => ReactNode;
}
const Topo = createContext<TopoContext>(null as unknown as TopoContext);

/** 可点击的硬件区域：悬停看明细，点击打开模块。 */
function Hit({ slot, children }: { slot: DiagramSlot; children: ReactNode }) {
  const { slots, onSelect, bind, describe, details } = useContext(Topo),
    info = slots[slot];
  if (!info) return <g>{children}</g>;
  const open = onSelect ? () => onSelect(info.ids[0]) : undefined;
  return (
    <g
      className={"rw-topo-hit" + (open ? " is-button" : "")}
      role={open ? "button" : "group"}
      tabIndex={0}
      aria-label={describe(info)}
      onClick={open}
      onKeyDown={(e) => {
        if (open && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      {...bind(details(info))}
    >
      {children}
    </g>
  );
}
/** 标记：第一行可用度与目标，第二行每卡 FIT、损失与预算。 */
function Tag({
  x,
  y,
  slot,
  w = 206,
}: {
  x: number;
  y: number;
  slot: DiagramSlot;
  w?: number;
}) {
  const { slots, active } = useContext(Topo),
    info = slots[slot];
  if (!info)
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={40}
          rx={6}
          fill="#fff"
          stroke={frame}
          strokeDasharray="4 3"
        />
        <T x={x + 12} y={y + 24} size={11.5} fill={muted}>
          没有模块标注在这里
        </T>
      </g>
    );
  return (
    <g>
      <rect
        className="rw-topo-tag"
        x={x}
        y={y}
        width={w}
        height={40}
        rx={6}
        fill="#fff"
        stroke="#aab6c6"
      />
      <circle
        cx={x + 12}
        cy={y + 13}
        r={4.5}
        fill={toneColors[info.tone].dot}
      />
      {active === "target" ? (
        <>
          <text x={x + 22} y={y + 17.5} fontSize={11.5} fill={muted}>
            目标{" "}
            <tspan fontSize={13.5} fontWeight={700} fill={ink}>
              {percent(info.targetAvailability)}
            </tspan>
          </text>
          <T x={x + 10} y={y + 33} size={11} fill={muted}>
            损失预算 {hours(info.budgetHours)} · 现状{" "}
            {percent(info.availability)}
          </T>
        </>
      ) : (
        <>
          <text
            x={x + 22}
            y={y + 17.5}
            fontSize={13.5}
            fontWeight={700}
            fill={ink}
          >
            {percent(info.availability)}
            <tspan fontSize={11.5} fontWeight={400} fill={muted}>
              {" → 目标 "}
            </tspan>
            <tspan fontSize={12} fontWeight={600}>
              {percent(info.targetAvailability)}
            </tspan>
          </text>
          <T x={x + 10} y={y + 33} size={11} fill={muted}>
            {fit(info.fitPerCard)} FIT · 损失 {hours(info.lossHours)} /{" "}
            {hours(info.budgetHours)}
          </T>
        </>
      )}
    </g>
  );
}

/** 器件底色：有状态时用状态色，否则用所属域的颜色。 */
function usePaint() {
  const { slots, active } = useContext(Topo);
  return (slot: DiagramSlot, domain: "compute" | "network" | "plain") => {
    // 器件底色按“占全部故障损失的比例”分档，越深表示在这里损失的时间越多。
    const step = active === "target" ? null : heatOf(slots[slot]?.share ?? 0);
    if (step) return { fill: step.fill, stroke: "#c98a55" };
    return domain === "compute"
      ? { fill: computeFill, stroke: computeStroke }
      : domain === "network"
        ? { fill: "#fff", stroke: network }
        : { fill: "#f1f4f8", stroke: "#aab6c6" };
  };
}
/** 器件上的文字：底色加深后改用深色，保证看得清。 */
function useLabelColor() {
  const { slots, active } = useContext(Topo);
  return (slot: DiagramSlot, base: string) =>
    active !== "target" && heatOf(slots[slot]?.share ?? 0) ? "#3d2a18" : base;
}
/** 交换设备：带端口刻线的小方框。 */
function Equipment({
  x,
  y,
  w,
  label,
  slot,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  slot: DiagramSlot;
}) {
  const color = usePaint()(slot, "network"),
    text = useLabelColor()(slot, network);
  return (
    <g>
      <rect x={x} y={y} width={w} height={28} rx={4} {...color} />
      <T x={x + 8} y={y + 18.5} size={11.5} weight={600} fill={text}>
        {label}
      </T>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={x + w - 30 + i * 6}
          y={y + 10}
          width={3}
          height={7}
          rx={1}
          fill={text}
        />
      ))}
    </g>
  );
}
function Cell({
  x,
  y,
  w,
  h,
  label,
  slot,
  size = 12,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  slot: DiagramSlot;
  size?: number;
}) {
  const paint = usePaint(),
    text = useLabelColor()(slot, compute);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={5}
        {...paint(slot, "compute")}
      />
      <T
        x={x + w / 2}
        y={y + h / 2 + size * 0.36}
        size={size}
        weight={600}
        fill={text}
        anchor="middle"
      >
        {label}
      </T>
    </g>
  );
}

/** 用状态色或所属域颜色填充的小器件。 */
function Swatch({
  slot,
  domain,
  ...shape
}: {
  slot: DiagramSlot;
  domain: "compute" | "network" | "plain";
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}) {
  return <rect {...shape} {...usePaint()(slot, domain)} />;
}

/**
 * 系统架构图：按 Atlas 950 超节点的硬件拓扑绘制（计算柜、计算板、NPU 模组、
 * L1 / L2 互联、Spine / Leaf、存储、供电冷却与管理面），并把各模块的指标标注在对应硬件上。
 */
export default function ArchitectureDiagram({
  views,
  title,
  hint,
  onSelect,
  actions,
}: {
  /** 可切换的视图；第一个为默认。 */
  views: DiagramView[];
  title: string;
  hint?: string;
  onSelect?: (moduleId: string) => void;
  actions?: ReactNode;
}) {
  const { model, analysis } = useWorkbench(),
    [view, setView] = useState<DiagramView>(views[0]),
    tooltip = useTooltip();
  const active = views.includes(view) ? view : views[0],
    assessed = active === "design" ? analysis.design : analysis.baseline,
    { allocation } = analysis,
    system = assessed.system,
    target = model.scenario.target;

  const infoOf = (ids: string[], name: string): SlotInfo | null => {
    if (!ids.length) return null;
    const parts = assessed.modules.filter((m) => ids.includes(m.id)),
      budgets = allocation.modules.filter((m) => ids.includes(m.id)),
      load = parts.reduce((sum, m) => sum + m.load, 0),
      rate = parts.reduce((sum, m) => sum + m.rate, 0),
      targetLoad = budgets.reduce((sum, m) => sum + m.load, 0),
      usage = targetLoad > 0 ? load / targetLoad : load > 0 ? Infinity : 0;
    return {
      ids,
      name,
      availability: 1 / (1 + load),
      targetAvailability: 1 / (1 + targetLoad),
      fitPerCard: parts.reduce((sum, m) => sum + m.fitPerCard, 0),
      mtbfHours: rate > 0 ? 1 / rate : Infinity,
      mttrHours: rate > 0 ? load / rate : 0,
      lossHours: parts.reduce((sum, m) => sum + m.lossHours, 0),
      budgetHours: budgets.reduce((sum, m) => sum + m.lossHours, 0),
      usage,
      share: parts.reduce((sum, m) => sum + m.share, 0),
      tone: active === "target" ? "idle" : toneOf(usage),
    };
  };
  const slots = Object.fromEntries(
    diagramSlots.map((slot) => {
      const members = model.modules.filter((m) => m.anchor === slot);
      return [
        slot,
        infoOf(
          members.map((m) => m.id),
          members.map((m) => m.name).join("、"),
        ),
      ];
    }),
  ) as Record<DiagramSlot, SlotInfo | null>;
  const unplaced = model.modules.filter(
    (m) => !(diagramSlots as readonly string[]).includes(m.anchor),
  );

  const describe = (info: SlotInfo) =>
    active === "target"
      ? `${info.name}，目标可用度 ${percent(info.targetAvailability)}，损失预算 ${hours(info.budgetHours)}`
      : `${info.name}，${viewNames[active]}可用度 ${percent(info.availability)}，目标 ${percent(info.targetAvailability)}，${usageLabel(info.usage)}`;
  const details = (info: SlotInfo) => (
    <>
      <strong>{percent(info.availability)}</strong>
      <span>
        {info.name} · {active === "design" ? "设计后" : "现状"}可用度
      </span>
      <strong>{percent(info.targetAvailability)}</strong>
      <span>目标可用度</span>
      <strong>{fit(info.fitPerCard)} FIT</strong>
      <span>每卡故障率</span>
      <strong>{duration(info.mtbfHours)}</strong>
      <span>MTBF</span>
      <strong>{duration(info.mttrHours)}</strong>
      <span>单次等效损失</span>
      <strong>
        {hours(info.lossHours)} / {hours(info.budgetHours)}
      </strong>
      <span>损失 / 预算</span>
      {active !== "target" && (
        <>
          <strong>{usageLabel(info.usage)}</strong>
          <span>与分配预算相比</span>
        </>
      )}
    </>
  );

  const context: TopoContext = {
    slots,
    active,
    onSelect,
    bind: tooltip.bind,
    describe,
    details,
  };
  const supernodes = Math.ceil(model.scenario.cards / 1024);

  return (
    <section className="rw-card rw-topo" aria-label={title}>
      <div className="rw-card-head">
        <h2>{title}</h2>
        <div className="rw-topo-tools">
          {actions}
          {views.length > 1 && (
            <div className="rw-tabs" role="tablist" aria-label="架构图显示">
              {views.map((item) => (
                <button
                  key={item}
                  role="tab"
                  aria-selected={item === active}
                  className={item === active ? "is-active" : ""}
                  onClick={() => setView(item)}
                >
                  {viewNames[item]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {hint && <p className="rw-hint">{hint}</p>}
      <div className="rw-topo-scroll">
        <Topo.Provider value={context}>
          <svg
            viewBox="0 0 1280 968"
            role="img"
            aria-label={`系统架构图（${viewNames[active]}）`}
          >
            {/* 跨超节点网络 */}
            <Hit slot="l2">
              <Box x={12} y={12} w={846} h={92} fill="#f5f8fc" />
              <T x={28} y={40} size={15} weight={650}>
                跨超节点网络
              </T>
              <T x={28} y={62} fill={muted}>
                Leaf / Spine 交换机，经 IO 刀片与 UB 网卡接入
              </T>
              <T x={28} y={84} size={11.5} fill={muted}>
                指标与超节点内的 L2 互联合并标注
              </T>
              <Equipment x={430} y={24} w={150} label="Spine" slot="l2" />
              <Equipment x={640} y={60} w={150} label="Leaf" slot="l2" />
              <Link d="M580 38H610V74H640" />
            </Hit>
            {/* 共享存储 */}
            <Hit slot="storage">
              <Box
                x={874}
                y={12}
                w={394}
                h={92}
                fill="#faf8f2"
                stroke="#ddd5c2"
              />
              <T x={890} y={40} size={15} weight={650}>
                共享存储
              </T>
              <T x={890} y={62} fill={muted}>
                检查点与数据集
              </T>
              {[0, 1, 2, 3].map((i) => (
                <Swatch
                  key={i}
                  x={890 + i * 30}
                  y={74}
                  width={24}
                  height={14}
                  rx={3}
                  slot="storage"
                  domain="plain"
                />
              ))}
              <Tag x={1050} y={38} slot="storage" />
            </Hit>

            {/* 代表性超节点 */}
            <Box
              x={12}
              y={120}
              w={1256}
              h={640}
              fill="#fafcfe"
              stroke={frame}
              r={12}
            />
            <T x={28} y={146} size={16} weight={700}>
              代表性超节点 · 1024 NPU 模组
            </T>
            <T x={296} y={146} fill={muted}>
              全集群约 {count(supernodes)} 个
            </T>
            <T x={776} y={146} size={14} weight={650} fill={network}>
              超节点内互联 · 8 平面 · UB 链路
            </T>

            {/* 计算柜 */}
            <Box
              x={28}
              y={158}
              w={716}
              h={92}
              fill="#f3f9f6"
              stroke="#d5e6dc"
            />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const x = 40 + i * 74;
              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={166}
                    width={58}
                    height={76}
                    rx={5}
                    fill="#fff"
                    stroke="#9fbcb7"
                  />
                  {[0, 1, 2, 3, 4].map((j) => (
                    <rect
                      key={j}
                      x={x + 7}
                      y={173 + j * 10.5}
                      width={44}
                      height={7}
                      rx={2}
                      fill="#e9f4ef"
                      stroke="#b9d9cd"
                    />
                  ))}
                  <T
                    x={x + 29}
                    y={238}
                    size={10}
                    fill={compute}
                    anchor="middle"
                  >
                    {i === 7 ? "…柜16" : `柜${i + 1}`}
                  </T>
                </g>
              );
            })}
            <T x={640} y={200} size={12.5} weight={600} fill={compute}>
              16 计算柜
            </T>
            <T x={640} y={219} fill={muted}>
              × 64 模组
            </T>

            {/* 计算柜展开 */}
            <Box x={28} y={262} w={716} h={486} stroke="#bed6ca" />
            <T x={44} y={286} size={13} weight={650} fill={compute}>
              计算柜展开 · 每柜 8 个节点，每节点 8 个 NPU 模组
            </T>
            <Box
              x={44}
              y={298}
              w={336}
              h={74}
              fill="#f5faf7"
              stroke="#cfe2d8"
            />
            <T x={56} y={318} size={12.5} weight={600} fill={compute}>
              计算板 · 8 模组
            </T>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Cell
                key={i}
                x={56 + i * 40}
                y={330}
                w={34}
                h={28}
                label="NPU"
                slot="npu"
                size={10}
              />
            ))}

            {/* NPU 模组内部 */}
            <Box
              x={44}
              y={382}
              w={336}
              h={250}
              fill="#eef7f2"
              stroke="#bed6ca"
            />
            <T x={56} y={404} size={13} weight={650} fill={compute}>
              NPU 模组内部
            </T>
            <Hit slot="aicore">
              <Cell x={56} y={416} w={96} h={42} label="AICore" slot="aicore" />
              <Tag x={162} y={417} slot="aicore" />
            </Hit>
            <Hit slot="npu">
              <Cell
                x={56}
                y={468}
                w={96}
                h={42}
                label="SRAM / 逻辑"
                slot="npu"
                size={11.5}
              />
              <Tag x={162} y={469} slot="npu" />
            </Hit>
            <Hit slot="hbm">
              <Cell x={56} y={520} w={96} h={42} label="HBM" slot="hbm" />
              <Tag x={162} y={521} slot="hbm" />
            </Hit>
            <Cell x={56} y={572} w={96} h={42} label="IO Die" slot="l1" />
            <T x={164} y={590} size={11.5} fill={muted}>
              片内互联出口
            </T>
            <T x={164} y={607} size={11.5} fill={muted}>
              与 L1 互联刀片合并标注 →
            </T>

            {/* 计算节点 */}
            <Hit slot="node">
              <Box
                x={44}
                y={642}
                w={336}
                h={96}
                fill="#f5faf7"
                stroke="#cfe2d8"
              />
              <T x={56} y={663} size={12.5} weight={600} fill={compute}>
                计算节点 · CPU / DDR / SSD / 板级连接
              </T>
              {["CPU", "DDR", "SSD"].map((name, i) => (
                <Cell
                  key={name}
                  x={56 + i * 35}
                  y={686}
                  w={31}
                  h={22}
                  label={name}
                  slot="node"
                  size={9.5}
                />
              ))}
              <Tag x={166} y={677} slot="node" />
            </Hit>

            {/* L1 互联刀片 */}
            <Hit slot="l1">
              <Box
                x={396}
                y={298}
                w={332}
                h={112}
                fill={networkPanel}
                stroke={networkStroke}
              />
              <T x={410} y={320} size={13} weight={650} fill={network}>
                L1 互联刀片 × 4 / 柜
              </T>
              <Equipment x={410} y={330} w={148} label="L1 · P1–P4" slot="l1" />
              <Equipment x={566} y={330} w={148} label="L1 · P5–P8" slot="l1" />
              <Tag x={410} y={364} slot="l1" />
            </Hit>
            {/* IO 刀片与网卡 */}
            <Hit slot="l2">
              <Box
                x={396}
                y={420}
                w={332}
                h={84}
                fill={networkPanel}
                stroke={networkStroke}
              />
              <T x={410} y={442} size={13} weight={650} fill={network}>
                IO 转换刀片 × 2 / 柜 · UB 网卡
              </T>
              <Equipment
                x={410}
                y={452}
                w={148}
                label="IO 1 · 网卡"
                slot="l2"
              />
              <Equipment
                x={566}
                y={452}
                w={148}
                label="IO 2 · 网卡"
                slot="l2"
              />
              <T x={410} y={496} size={11.5} fill={muted}>
                与 L2 / Leaf / Spine 合并标注
              </T>
            </Hit>
            {/* 供电与冷却 */}
            <Hit slot="power">
              <Box x={396} y={514} w={332} h={112} fill="#f7f8fa" />
              <T x={410} y={536} size={13} weight={650}>
                柜级供电与液冷
              </T>
              <Swatch
                x={410}
                y={546}
                width={70}
                height={22}
                rx={4}
                slot="power"
                domain="plain"
              />
              {[0, 1, 2, 3, 4].map((i) => (
                <rect
                  key={i}
                  x={420 + i * 11}
                  y={551}
                  width={5}
                  height={12}
                  rx={1}
                  fill="#7c8797"
                />
              ))}
              <Swatch
                x={488}
                y={546}
                width={70}
                height={22}
                rx={4}
                slot="power"
                domain="plain"
              />
              <path
                d="M496 557q6-8 12 0t12 0 12 0 12 0"
                fill="none"
                stroke="#7c8797"
                strokeWidth={1.6}
              />
              <T x={568} y={561} size={11.5} fill={muted}>
                电源 · 冷却回路
              </T>
              <Tag x={410} y={576} slot="power" />
            </Hit>
            {/* 管理面 */}
            <Hit slot="management">
              <Box x={396} y={636} w={332} h={102} fill="#f7f8fa" />
              <T x={410} y={658} size={13} weight={650}>
                管理刀片 · BMC
              </T>
              <Swatch
                x={410}
                y={667}
                width={70}
                height={20}
                rx={4}
                slot="management"
                domain="plain"
              />
              <T
                x={445}
                y={681}
                size={10.5}
                weight={600}
                fill="#5b6676"
                anchor="middle"
              >
                BMC
              </T>
              <T x={490} y={681} size={11.5} fill={muted}>
                带外管理与监控
              </T>
              <Tag x={410} y={692} slot="management" />
            </Hit>

            {/* 互联柜与 L2 */}
            <Hit slot="l2">
              <Box x={760} y={158} w={492} h={300} stroke="#cbd6e6" />
              {[0, 1].map((cabinet) => {
                const x = 776 + cabinet * 238;
                return (
                  <g key={cabinet}>
                    <Box
                      x={x}
                      y={170}
                      w={222}
                      h={218}
                      fill={networkPanel}
                      stroke="#c2cce6"
                    />
                    <T
                      x={x + 12}
                      y={192}
                      size={12.5}
                      weight={650}
                      fill={network}
                    >
                      互联柜 {cabinet + 1}
                    </T>
                    {[0, 1, 2, 3].map((row) => {
                      const y = 204 + row * 44;
                      return (
                        <g key={row}>
                          <T
                            x={x + 10}
                            y={y + 18.5}
                            size={11.5}
                            weight={600}
                            fill={network}
                          >
                            P{cabinet * 4 + row + 1}
                          </T>
                          <Equipment
                            x={x + 40}
                            y={y}
                            w={84}
                            label="L2"
                            slot="l2"
                          />
                          <Equipment
                            x={x + 130}
                            y={y}
                            w={84}
                            label="L2"
                            slot="l2"
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              <Tag x={776} y={404} slot="l2" />
              <T x={994} y={421} size={11.5} fill={muted}>
                含 L2、Leaf / Spine、
              </T>
              <T x={994} y={438} size={11.5} fill={muted}>
                IO 转换刀片与 UB 网卡
              </T>
            </Hit>
            {/* 光模块 */}
            <Hit slot="optical">
              <Box x={760} y={470} w={492} h={118} stroke="#cbd6e6" />
              <T x={776} y={492} size={13} weight={650} fill={network}>
                光模块 · 每卡约 4 只
              </T>
              <rect
                x={776}
                y={506}
                width={46}
                height={22}
                rx={4}
                fill="#fff"
                stroke={network}
              />
              <T
                x={799}
                y={521}
                size={11}
                weight={600}
                fill={network}
                anchor="middle"
              >
                L1
              </T>
              <Swatch
                x={828}
                y={509}
                width={24}
                height={16}
                rx={3}
                slot="optical"
                domain="network"
              />
              <Link d="M852 517H932" />
              <Swatch
                x={932}
                y={509}
                width={24}
                height={16}
                rx={3}
                slot="optical"
                domain="network"
              />
              <rect
                x={962}
                y={506}
                width={46}
                height={22}
                rx={4}
                fill="#fff"
                stroke={network}
              />
              <T
                x={985}
                y={521}
                size={11}
                weight={600}
                fill={network}
                anchor="middle"
              >
                L2
              </T>
              <Tag x={1030} y={497} slot="optical" />
              <T x={776} y={554} size={11.5} fill={muted}>
                装在 L1 ↔ L2 及出口链路的两端
              </T>
              <T x={776} y={572} size={11.5} fill={muted}>
                标注的是保护后仍会打断任务的失效
              </T>
            </Hit>
            {/* 图例 */}
            <Box
              x={760}
              y={600}
              w={492}
              h={148}
              fill="#f5f7fa"
              stroke="#dde3ec"
            />
            <T x={776} y={624} size={13} weight={650}>
              图上标记怎么读
            </T>
            <T x={776} y={648} fill="#475467">
              {active === "target"
                ? "第一行：分配给该模块的目标可用度"
                : `第一行：模块${active === "design" ? "设计后" : "现状"}可用度 → 分配给它的目标`}
            </T>
            <T x={776} y={670} fill="#475467">
              {active === "target"
                ? "第二行：每个窗口的损失预算 · 现状可用度"
                : "第二行：每卡 FIT · 每个窗口的损失小时 / 损失预算"}
            </T>
            {active === "target" ? (
              <T x={776} y={692} fill="#475467">
                目标由第 1 步的分配方法得到
              </T>
            ) : (
              <g>
                <T x={776} y={692} fill="#475467">
                  圆点：
                </T>
                {(
                  [
                    ["good", "预算内", 822],
                    ["warn", "略超（1.2 倍内）", 888],
                    ["bad", "超预算", 1012],
                  ] as const
                ).map(([tone, label, x]) => (
                  <g key={tone}>
                    <circle cx={x} cy={688} r={5} fill={toneColors[tone].dot} />
                    <T x={x + 10} y={692} fill="#475467">
                      {label}
                    </T>
                  </g>
                ))}
                <T x={776} y={715} fill="#475467">
                  器件底色：占全部故障损失
                </T>
                {[...heatSteps].reverse().map((step, i) => (
                  <g key={step.label}>
                    <rect
                      x={936 + i * 94}
                      y={704}
                      width={18}
                      height={14}
                      rx={3}
                      fill={step.fill}
                      stroke="#c98a55"
                    />
                    <T x={960 + i * 94} y={715} fill="#475467" size={11.5}>
                      {step.label}
                    </T>
                  </g>
                ))}
              </g>
            )}
            <T x={776} y={738} fill={muted} size={11.5}>
              {onSelect
                ? "点击硬件可修改故障模式；悬停查看 MTBF、单次等效损失等明细"
                : "悬停在硬件上查看 MTBF、单次等效损失等明细"}
            </T>

            {/* 连线 */}
            <Link d="M380 344H396" color={compute} />
            <Link d="M152 593h6" color={compute} />
            <Link d="M728 344H744V280H760" />
            <Link d="M728 466H752V88" dashed />
            <Link d="M1006 458V470" />
            <Link d="M1071 104V120" dashed />

            {/* 机房供配电：全系统共用 */}
            <Link d="M217 760V772" color="#98a2b3" />
            <Link d="M562 760V772" color="#98a2b3" />
            <Link d="M1006 760V772" color="#98a2b3" />
            <Hit slot="site-power">
              <Box x={12} y={772} w={1256} h={72} fill="#f7f8fa" />
              <T x={28} y={796} size={14} weight={650}>
                机房供配电 · 全系统共用
              </T>
              {["市电", "UPS", "柴发"].map((name, index) => (
                <g key={name}>
                  <Swatch
                    x={28 + index * 62}
                    y={808}
                    width={54}
                    height={22}
                    rx={4}
                    slot="site-power"
                    domain="plain"
                  />
                  <T
                    x={55 + index * 62}
                    y={823}
                    size={10.5}
                    weight={600}
                    fill="#5b6676"
                    anchor="middle"
                  >
                    {name}
                  </T>
                </g>
              ))}
              <Tag x={236} y={788} slot="site-power" w={236} />
              <T x={496} y={805} size={11.5} fill={muted}>
                向全部机柜供电，数量不随卡数增长
              </T>
              <T x={496} y={823} size={11.5} fill={muted}>
                一次失效打断全部任务并需人工恢复，所以单独指定很高的目标，不按权重分配
              </T>
            </Hit>

            {/* 软件、公共开销与系统合计 */}
            <Hit slot="software">
              <Box x={12} y={856} w={410} h={100} />
              <T x={28} y={880} size={14} weight={650}>
                软件栈 · 调度 / 框架 / 未归因
              </T>
              <Tag x={28} y={898} slot="software" />
              <T x={246} y={916} size={11.5} fill={muted}>
                运行在全部硬件之上
              </T>
              <T x={246} y={933} size={11.5} fill={muted}>
                任何一处出错都打断任务
              </T>
            </Hit>
            <g role="group" aria-label="公共开销">
              <Box x={434} y={856} w={410} h={100} dashed />
              <T x={450} y={880} size={14} weight={650}>
                公共开销 · 保存检查点与在线检测
              </T>
              <T x={450} y={906} fill={muted}>
                与故障无关，占运行时间 {percent(system.overhead)}
              </T>
              <text x={450} y={936} fontSize={15} fontWeight={700} fill={ink}>
                {hours(system.overheadLossHours)}
                <tspan fontSize={12} fontWeight={400} fill={muted}>
                  {" / 预算 " + hours(allocation.overheadLossHours)}
                </tspan>
              </text>
            </g>
            <g role="group" aria-label="系统合计">
              <Box
                x={856}
                y={856}
                w={412}
                h={100}
                fill="#f0f4fb"
                stroke="#bfd0ea"
              />
              <T x={872} y={880} size={14} weight={650}>
                训练集群 · {scale(model.scenario.cards)}（各部分串联）
              </T>
              <text x={872} y={914} fontSize={22} fontWeight={700} fill={ink}>
                {percent(active === "target" ? target : system.availability)}
                <tspan fontSize={12.5} fontWeight={400} fill={muted}>
                  {active === "target"
                    ? "　系统目标 · 现状 " + percent(system.availability)
                    : `　${viewNames[active]} → 目标 ${percent(target)}`}
                </tspan>
              </text>
              <T x={872} y={940} fill="#475467">
                {fit(system.fitPerCard)} FIT / 卡 · 损失{" "}
                {hours(system.lossHours)} / 预算 {hours(allocation.lossHours)}
              </T>
            </g>
          </svg>
        </Topo.Provider>
      </div>
      {unplaced.length > 0 && (
        <div className="rw-topo-extra">
          <strong>没有画在图上的模块</strong>
          {unplaced.map((module) => {
            const info = infoOf([module.id], module.name)!;
            const text =
              active === "target"
                ? `目标 ${percent(info.targetAvailability)} · 预算 ${hours(info.budgetHours)}`
                : `${percent(info.availability)} → 目标 ${percent(info.targetAvailability)} · ${fit(info.fitPerCard)} FIT · 损失 ${hours(info.lossHours)} / ${hours(info.budgetHours)}`;
            return onSelect ? (
              <button
                key={module.id}
                aria-label={describe(info)}
                onClick={() => onSelect(module.id)}
              >
                <b>{module.name}</b>
                {text}
                {active !== "target" && (
                  <Status tone={info.tone}>{usageLabel(info.usage)}</Status>
                )}
              </button>
            ) : (
              <span key={module.id} role="group" aria-label={describe(info)}>
                <b>{module.name}</b>
                {text}
                {active !== "target" && (
                  <Status tone={info.tone}>{usageLabel(info.usage)}</Status>
                )}
              </span>
            );
          })}
          <small>在“基础库配置 → 架构模块”里可以指定它们在图上的位置。</small>
        </div>
      )}
      {tooltip.node}
    </section>
  );
}
