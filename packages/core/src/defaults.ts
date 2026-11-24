import {
  coreModelVersion,
  makeLadder,
  type CoreModel,
  type FaultMode,
  type Measure,
  type MeasureEffect,
} from "./model";

const seconds = (value: number) => value / 3600;

/**
 * 默认场景的来源：
 * - 故障率：2026-11-12 周度用户场景（每卡 HBM＋NPU 合计 1700 FIT，各占全部故障 15%；
 *   光模块占 35%；静默故障占 1.4%，其中 AICore 占 85%）。
 * - 其余 35% 的模块拆分：按 2026-10-14 基线故障库各对象的相对构成折算，属先验。
 * - 检测与恢复链：2026-11-24 用户给出的现有措施与预计改进（见下方常量）。
 * - 措施库：用户给出的 10 项默认启用；其余取自现有基础机制和扩展机制库，作为候选。
 * 所有数值都是可编辑的场景输入，不代表厂商实测器件失效率。
 */
const TOTAL_FIT = 1700 / 0.3;
const AICORE_SDC_FIT = TOTAL_FIT * 0.014 * 0.85;
const OTHER_SDC_FIT = TOTAL_FIT * 0.014 * 0.15;
const REST_FIT = TOTAL_FIT * 0.35;
// 2026-10-14 基线故障库：各对象 FIT 的分组合计，以及其中亚健康的部分。
const restBasis = {
  iod: { total: 213.03, slow: 0 }, // IO Die / D2D
  fabric: { total: 227.25, slow: 0 }, // 网卡、IO 转换板、L1/L2 互联设备
  node: { total: 742.99, slow: 13.6 }, // 模组连接、CPU、DDR、SSD
  power: { total: 287.63, slow: 11.09 }, // 柜级供电、液冷与风扇
  management: { total: 138.94, slow: 0 }, // 管理刀片、BMC
  storage: { total: 142.71, slow: 0 },
  software: { total: 436.08, slow: 0 },
};
const restTotal = Object.values(restBasis).reduce((sum, v) => sum + v.total, 0);
const rest = (key: keyof typeof restBasis) =>
  (REST_FIT * restBasis[key].total) / restTotal;
const restSlow = (key: keyof typeof restBasis) =>
  (REST_FIT * restBasis[key].slow) / restTotal;

// ---------- 现有恢复链（2026-11-24 用户给定） ----------
// 进程重调度：成功率 0.3，耗时 240 秒；成功即恢复，失败转弹性恢复。
const PROCESS = { success: 0.3, hours: seconds(240) };
// CKPT 回滚：保存间隔 10 分钟、恢复 10 分钟、成功率 0.99、每次保存阻塞 4 秒。
// 回滚一次的耗时粗看是 间隔 / 2 + 恢复时间。
const CKPT_INTERVAL = seconds(600);
const CKPT_RESTORE = seconds(600);
const CKPT_BLOCK = seconds(4);
const REWORK = CKPT_INTERVAL / 2;
// 人工恢复 4 小时。
const MANUAL = 4;
/**
 * 恢复链：进程重调度成功即恢复，失败走弹性恢复；弹性恢复成功再走 CKPT 回滚，失败转人工；
 * CKPT 回滚失败也转人工。现状没有弹性恢复：它是必经环节，成功率为 0，所以进程重调度
 * 失败后只能转人工，CKPT 回滚要等弹性恢复具备后才走得到。
 * 假设：每一级的尝试时间不论成败都要花掉；进程重调度的 240 秒已含重新加载，不另计回滚重算。
 */
const chain = (withProcess: boolean) =>
  makeLadder({
    ...(withProcess
      ? {
          process: {
            ...PROCESS,
            failHours: PROCESS.hours,
            rollback: false,
          },
        }
      : {}),
    elastic: { success: 0, gate: true, then: "next", onFail: "manual" },
    restart: { success: 0.99, hours: CKPT_RESTORE, failHours: CKPT_RESTORE },
    manual: { success: 1, hours: MANUAL },
  });
const hard = (
  id: string,
  moduleId: string,
  name: string,
  fit: number,
  evidence: string,
): FaultMode => ({
  id,
  moduleId,
  name,
  kind: "hard",
  fit,
  // 95% 在 10 秒内检出，其余由 60 秒超时兜底发现（超时时间为沿用的假设）。
  coverage: 0.95,
  detectHours: seconds(10),
  lateDetectHours: seconds(60),
  reworkHours: REWORK,
  ladder: chain(true),
  impact: 1,
  evidence,
});
const silent = (
  id: string,
  moduleId: string,
  name: string,
  fit: number,
  evidence: string,
): FaultMode => ({
  id,
  moduleId,
  name,
  kind: "sdc",
  fit,
  // 90% 在 10 秒内在线检出；漏检的要到 48 小时后才被发现，期间的训练结果作废。
  coverage: 0.9,
  detectHours: seconds(10),
  lateDetectHours: 48,
  reworkHours: REWORK,
  // 假设：出错的核必须先隔离，重新调度进程无效，所以不走进程重调度。
  ladder: chain(false),
  impact: 1,
  evidence,
});
// 亚健康不中断任务，性能损耗系数 0.1（影响系数）。检出率 0.8，检出后快照 / 降载 300 秒。
// 假设（用户未给出）：检出需要 5 分钟；漏检的降速持续 24 小时后才被发现。
const SLOW_LOSS = 0.1;
const slow = (
  id: string,
  moduleId: string,
  name: string,
  fit: number,
): FaultMode => ({
  id,
  moduleId,
  name,
  kind: "slow",
  fit,
  coverage: 0.8,
  detectHours: seconds(300),
  lateDetectHours: 24,
  reworkHours: 0,
  ladder: makeLadder({
    replay: { success: 1, hours: seconds(300), rollback: false },
  }),
  impact: SLOW_LOSS,
  evidence:
    priorSplit +
    "；用户给定：检出率 0.8、快照 / 降载 300 秒、性能损耗系数 0.1。检出需 5 分钟、漏检持续 24 小时为假设",
});

const userScenario = "2026-11-12 周度用户场景";
const priorSplit =
  "其余 35% 故障按 2026-10-14 基线故障库相对构成折算，属先验，待实测校准";

// 措施作用范围
const HARD = [
  "npu-fault",
  "hbm-uce",
  "node-fault",
  "iod-fault",
  "optical-fault",
  "fabric-fault",
  "storage-fault",
  "power-fault",
  "management-fault",
  "software-fault",
];
const SDC = ["aicore-sdc", "other-sdc"];
const SLOW = ["node-slow", "power-slow"];
/** 走“进程重调度 → 弹性恢复 → CKPT 回滚 → 人工”这条恢复链的故障模式。 */
const CHAINED = [...HARD, ...SDC];

const effect = (
  param: MeasureEffect["param"],
  op: MeasureEffect["op"],
  value: number,
): MeasureEffect => ({ param, op, value });
const measure = (
  id: string,
  name: string,
  category: Measure["category"],
  modeIds: string[],
  effects: MeasureEffect[],
  rationale: string,
  options: Partial<
    Pick<Measure, "enabled" | "evidence" | "applicability" | "source">
  > = {},
): Measure => ({
  id,
  name,
  category,
  modeIds,
  effects,
  applicability: options.applicability ?? 1,
  enabled: options.enabled ?? false,
  evidence: options.evidence ?? "assumed",
  rationale,
  source: options.source ?? "",
});
const user = {
  enabled: true,
  evidence: "planned" as const,
  source: "用户方案（2026-11-24）",
};
/** 扩展机制库按 180 秒的全局恢复给出各阶段节省；这里按相同比例折算到现在的恢复时间。 */
const RESTART_180 = 180;

/** 默认措施库：可在“基础库”中增删改，也可随时从这里补回缺失的条目。 */
export function defaultMeasures(): Measure[] {
  return [
    // ---------- 组件级高可用：降低失效率 ----------
    measure(
      "aicore-screening",
      "AICore 静默故障压测",
      "prevent",
      ["aicore-sdc"],
      [effect("fit", "reduce", 0.6)],
      "上线前与在网周期压测筛除易产生静默错误的核，AICore 静默故障消减 60%。",
      user,
    ),
    measure(
      "hbm-ecc",
      "HBM 新纠错技术",
      "prevent",
      ["hbm-uce"],
      [effect("fit", "reduce", 0.6)],
      "新的纠错技术把一部分不可纠正错误变为可纠正，HBM 不可纠正错误消减 60%。",
      user,
    ),
    measure(
      "optical-reliability",
      "Hi-One 下一代光模块",
      "prevent",
      ["optical-fault"],
      [effect("fit", "reduce", 0.9)],
      "下一代光模块把单只失效率消减 90%（500 FIT → 50 FIT）。",
      user,
    ),
    measure(
      "online-screen",
      "在线压测增强与筛查",
      "prevent",
      ["node-fault", "npu-fault", "hbm-uce", "aicore-sdc"],
      [effect("fit", "reduce", 0.1)],
      "运行中周期压测并筛除异常资源，主要对 CPU、DDR、SSD 和 NPU 模组，失效率消减 10%。压测占用的时间未计入。",
      user,
    ),
    measure(
      "memory-predict",
      "内存故障预测与主动隔离",
      "prevent",
      ["hbm-uce"],
      [effect("fit", "reduce", 0.3)],
      "根据可纠正错误的增长趋势提前隔离即将失效的存储单元，把一部分突发故障变成计划内处置。降低 30% 为示例取值，没有现成来源。",
      { source: "示例措施" },
    ),
    measure(
      "power-redundancy",
      "供电冗余与器件降额",
      "prevent",
      ["power-fault"],
      [effect("fit", "reduce", 0.5)],
      "增加电源冗余并对关键器件降额使用，减少保护后仍然掉电的情况。降低 50% 为示例取值，没有现成来源。",
      { source: "示例措施" },
    ),
    measure(
      "site-power-backup",
      "机房双路市电与后备电源",
      "prevent",
      ["site-power-outage"],
      [effect("fit", "reduce", 0.9)],
      "两路独立市电加 UPS 与柴油发电机，单路失电不再造成整个机房掉电。降低 90% 为示例取值，没有现成来源。",
      { source: "示例措施" },
    ),

    // ---------- 系统级：检测 ----------
    measure(
      "sdc-detection",
      "静默故障在线检测",
      "detect",
      SDC,
      [effect("coverage", "set", 0.95)],
      "针对静默类故障：检出率从 90% 提到 95%，检测时间保持 10 秒；漏检分支减半。",
      user,
    ),
    measure(
      "slow-detect",
      "亚健康检测",
      "detect",
      SLOW,
      [effect("coverage", "set", 0.9)],
      "针对亚健康类故障：检出率从 0.8 提到 0.9；检出后快照 / 降载 300 秒，性能损耗系数 0.1。需要区分真实亚健康与负载变化。",
      user,
    ),
    measure(
      "fast-detect",
      "故障检测",
      "detect",
      HARD,
      [effect("coverage", "set", 0.99)],
      "针对中断类故障：检出率从 95% 提到 99%，其余仍由超时兜底。",
      user,
    ),
    measure(
      "sdc-abft",
      "算子 ABFT 实时矩阵校验",
      "detect",
      ["aicore-sdc"],
      [effect("coverage", "reduce", 0.9), effect("overhead", "add", 0.001)],
      "在算子内做校验，捕获前一道检测剩余漏检中的 90%；代价是正常运行时约 0.1% 的吞吐损失。",
      { source: "扩展机制库 D-ABFT" },
    ),
    measure(
      "sdc-precision",
      "FP8 / FP4 计算路径静默检测",
      "detect",
      ["aicore-sdc"],
      [effect("coverage", "reduce", 0.95)],
      "为尚未验证的 FP8、FP4 计算路径单独增加检测，目标检出 95%。这两条路径占 AICore 静默风险的份额没有给出，适用比例暂取 0，填入份额后才计收益。",
      { applicability: 0, source: "扩展机制库 D-SDC-FP8、D-SDC-FP4" },
    ),
    measure(
      "net-sdc",
      "网络端到端静默检测",
      "detect",
      ["other-sdc"],
      [effect("coverage", "reduce", 0.95)],
      "对网络传输做端到端校验，目标检出 95% 的网络静默错误。基线故障库中网络占非 AICore 静默故障约 44%，适用比例据此取值。",
      { applicability: 0.44, source: "扩展机制库 D-NET-SDC" },
    ),
    measure(
      "sdc-audit",
      "漏检静默故障定期校验",
      "detect",
      SDC,
      [effect("lateDetectHours", "set", 12)],
      "定期一致性校验与金标复算把漏检故障的发现时间从 48 小时压到 12 小时。12 小时为设计假设。",
      { source: "本工作台补充" },
    ),

    // ---------- 系统级：恢复链，粒度从小到大 ----------
    // 就地恢复：成功后任务不回滚
    measure(
      "replay",
      "通信与算子重执行",
      "recover",
      ["npu-fault", "hbm-uce", "iod-fault", "optical-fault"],
      [
        effect("replay.success", "set", 0.8),
        effect("replay.hours", "set", seconds(5)),
        effect("replay.failHours", "set", seconds(10)),
      ],
      "瞬态中断先原地重执行：成功时 5 秒恢复且不回滚，失败白费 10 秒后走进程重调度。基线成功率 90%，再按各模块瞬态故障的占比折减（HBM 约 70% 为可重放的瞬态错误），综合取 80%。",
      { source: "基础机制 R-REPLAY" },
    ),
    measure(
      "link-local",
      "链路透明恢复",
      "recover",
      ["iod-fault", "optical-fault", "fabric-fault"],
      [
        effect("replay.success", "set", 0.5),
        effect("replay.hours", "set", seconds(2)),
      ],
      "瞬态链路异常在链路层纠错、重传或重训练，成功后训练继续，总停顿约 2 秒且不回滚。不能覆盖永久损坏。成功率尚无实测，暂取 50%，请按故障注入结果修改。",
      { source: "扩展机制库 R-LINK-LOCAL" },
    ),
    measure(
      "sdc-step-recover",
      "静默故障干净 step 恢复",
      "recover",
      SDC,
      [
        effect("replay.success", "set", 0.9),
        effect("replay.hours", "set", seconds(2)),
      ],
      "已检出的静默故障从保存在内存里的上一个干净 step 恢复：1 秒恢复，再重做 1 秒计算，不回滚。漏检后才发现的故障没有干净 step 可用，成功率按检出比例取 90%。",
      { source: "基础机制 R-SDC" },
    ),
    // 进程重调度
    measure(
      "fast-recover",
      "进程重调度增强",
      "recover",
      HARD,
      [
        effect("process.success", "set", 0.95),
        effect("process.hours", "set", seconds(60)),
        effect("process.failHours", "set", seconds(60)),
      ],
      "把进程重调度的成功率从 0.3 提到 0.95、耗时从 240 秒压到 60 秒。取值来自基础机制的设计目标，用户方案里没有这一项，用来看“提高进程重调度成功率”值多少。",
      { source: "基础机制 R-PROCESS（设计目标）" },
    ),
    // 弹性恢复
    measure(
      "elastic-recover",
      "弹性恢复",
      "contain",
      CHAINED,
      [
        effect("elastic.success", "set", 0.99),
        effect("elastic.hours", "set", seconds(60)),
        effect("elastic.failHours", "set", seconds(60)),
      ],
      "以前没有。隔离并替换故障资源、重建通信域，成功率 0.99，耗时 60 秒；成功后再走 CKPT 回滚，失败转人工。用户说明当前参数粒度较粗。",
      user,
    ),
    measure(
      "contain",
      "故障隔离与传播抑制",
      "contain",
      ["iod-fault", "fabric-fault"],
      [
        effect("replay.success", "set", 0.5),
        effect("replay.hours", "set", seconds(4.6)),
      ],
      "把互联故障限制在一个域内：全局停止变为 1 秒全局协调加 1/50 的域局部恢复，等效 4.6 秒，不回滚。成功率尚无实测，暂取 50%，请按故障注入结果修改。",
      { source: "扩展机制库 I-CONTAIN" },
    ),
    measure(
      "fabric-degrade",
      "网络绕行与降级运行",
      "contain",
      ["optical-fault", "fabric-fault"],
      [
        effect("replay.success", "set", 0.5),
        effect("replay.hours", "set", seconds(165.6)),
      ],
      "2 秒切换到备用路径后降速运行 30 分钟再恢复，整个降级期等效损失约 165.6 秒（相当于 30 分钟内损失 9.2% 的产能），不回滚。成功率尚无实测，暂取 50%，请按故障注入结果修改。",
      { source: "扩展机制库 R-FABRIC-DEGRADE" },
    ),
    measure(
      "control-continuity",
      "控制面异常下业务连续运行",
      "contain",
      ["management-fault"],
      [
        effect("replay.success", "set", 0.5),
        effect("replay.hours", "set", seconds(1)),
      ],
      "管理面故障不再升级成训练中断：数据面保持运行，训练停顿预算 0–1 秒，不回滚。成功率尚无实测，暂取 50%，请按故障注入结果修改。",
      { source: "扩展机制库 H-CONTROL-CONTINUITY" },
    ),
    // CKPT 回滚
    measure(
      "recovery-classify",
      "故障分类与恢复动作匹配",
      "recover",
      CHAINED,
      [effect("restart.success", "set", 0.999)],
      "按故障类型选择恢复动作，CKPT 回滚的成功率由 99% 提到 99.9%，转人工的比例从 1% 降到 0.1%。",
      { source: "扩展机制库 D-RECOVERY-CLASSIFY" },
    ),
    measure(
      "runtime-snapshot",
      "运行时初始化快照",
      "recover",
      [
        "npu-fault",
        "hbm-uce",
        "node-fault",
        "iod-fault",
        "fabric-fault",
        "software-fault",
      ],
      [effect("restart.hours", "reduce", 45 / RESTART_180)],
      "用初始化镜像恢复运行时，启动阶段从 60 秒缩到 15 秒。原库按 180 秒的全局恢复给出，这里按相同比例（25%）折算到现在的恢复时间，待核实。",
      { source: "扩展机制库 R-RUNTIME-SNAPSHOT" },
    ),
    measure(
      "warm-process",
      "预热进程与可信状态接替",
      "recover",
      ["software-fault"],
      [effect("restart.hours", "reduce", 40 / RESTART_180)],
      "保持预热的备用进程，启动阶段从 60 秒缩到 20 秒。原库按 180 秒的全局恢复给出，这里按相同比例（22%）折算，待核实。",
      { source: "扩展机制库 R-WARM-PROCESS" },
    ),
    measure(
      "hccl-elastic",
      "HCCL 通信域弹性重建",
      "recover",
      ["npu-fault", "iod-fault", "fabric-fault", "software-fault"],
      [effect("restart.hours", "reduce", 45 / RESTART_180)],
      "通信重建阶段从 60 秒压到 15 秒。原库按 180 秒的全局恢复给出，这里按相同比例（25%）折算，待核实。",
      { source: "扩展机制库 R-HCCL-ELASTIC" },
    ),
    measure(
      "cann-graph",
      "CANN 图准备与启动缓存",
      "recover",
      ["npu-fault", "node-fault", "fabric-fault", "software-fault"],
      [effect("restart.hours", "reduce", 22.5 / RESTART_180)],
      "缓存图编译与准备结果，图准备阶段从 30 秒降到 7.5 秒。原库按 180 秒的全局恢复给出，这里按相同比例（12.5%）折算，待核实。",
      { source: "扩展机制库 R-CANN-GRAPH" },
    ),
    measure(
      "lossless-checkpoint",
      "无损检查点压缩",
      "recover",
      CHAINED,
      [effect("restart.hours", "reduce", 20 / RESTART_180)],
      "检查点压缩后读取 30 秒、解压 10 秒，读取阶段从 60 秒降到 40 秒。原库按 180 秒的全局恢复给出，这里按相同比例（11%）折算，待核实。不改变保存周期。",
      { source: "扩展机制库 C-LOSSLESS" },
    ),
    // 人工恢复
    measure(
      "fault-agent",
      "智能故障管理 Agent",
      "recover",
      CHAINED,
      [effect("manual.hours", "set", 1)],
      "自动定位并给出处置方案，人工恢复时间从 4 小时缩到 1 小时。静默故障漏检后仍要 48 小时才被发现，不在这一项里改变。",
      user,
    ),

    // ---------- 系统级：检查点 ----------
    measure(
      "fast-checkpoint",
      "CKPT 回滚优化",
      "checkpoint",
      CHAINED,
      [
        effect("reworkHours", "set", seconds(120) / 2),
        effect("restart.hours", "set", seconds(300)),
        effect("restart.failHours", "set", seconds(300)),
        effect("overhead", "set", seconds(0.1) / seconds(120)),
      ],
      "保存间隔从 10 分钟缩到 2 分钟（平均回滚重算 5 分钟 → 1 分钟），恢复时间从 10 分钟缩到 5 分钟，每次保存的阻塞从 4 秒降到 0.1 秒（保存开销 0.66% → 0.08%）。CKPT 回滚成功率 0.99 不变。",
      user,
    ),
  ];
}

export function defaultCoreModel(): CoreModel {
  const module = (
    id: string,
    groupId: string,
    name: string,
    note: string,
    options: {
      unitsPerCard?: number;
      anchor?: string;
      scaling?: "per-card" | "fixed";
      fixedTarget?: number;
    } = {},
  ) => ({
    id,
    groupId,
    name,
    unitsPerCard: options.unitsPerCard ?? 1,
    scaling: options.scaling ?? ("per-card" as const),
    fixedTarget: options.fixedTarget ?? null,
    importance: 1,
    complexity: null,
    anchor: options.anchor ?? id,
    note,
  });
  return {
    schemaVersion: coreModelVersion,
    name: "50 万卡训练集群 · 周度可用度",
    scenario: {
      cards: 500000,
      hours: 168,
      target: 0.95,
      // 用户给定：10 万卡 99%、50 万卡 95%。
      targetCurve: [
        { cards: 100000, target: 0.99 },
        { cards: 500000, target: 0.95 },
      ],
      // CKPT 保存：每 10 分钟阻塞 4 秒。
      overhead: CKPT_BLOCK / (CKPT_INTERVAL + CKPT_BLOCK),
      passRatio: 0.9,
    },
    groups: [
      { id: "compute", name: "计算" },
      { id: "network", name: "网络" },
      { id: "storage", name: "存储" },
      { id: "facility", name: "供电、冷却与管理" },
      { id: "software", name: "软件与调度" },
    ],
    modules: [
      module("aicore", "compute", "AICore", "NPU 内的计算核；只承载静默分支"),
      module(
        "npu",
        "compute",
        "NPU 其余部分",
        "SRAM、逻辑、封装等除 AICore 静默以外的 NPU 故障",
      ),
      module("hbm", "compute", "HBM", "按每卡等效 FIT 计，不再乘 HBM 颗数"),
      module("node", "compute", "节点与板级", "CPU、DDR、SSD、模组与板级连接"),
      module(
        "iod-l1",
        "network",
        "IO Die 与 L1 互联",
        "片内 IO Die、D2D 通路",
        {
          anchor: "l1",
        },
      ),
      module(
        "optical",
        "network",
        "光模块",
        "按每卡约 4 只折算，使其占全部故障约 35%；数量待 BOM 确认",
        { unitsPerCard: 4, anchor: "optical" },
      ),
      module(
        "l2-fabric",
        "network",
        "L2 / Leaf / Spine 与网卡",
        "UB 网卡、IO 转换板、L1/L2 互联设备",
        { anchor: "l2" },
      ),
      module("storage", "storage", "存储系统", "共享检查点与存储服务"),
      module("power", "facility", "柜级供电与冷却", "柜级供电、液冷与风扇"),
      module(
        "site-power",
        "facility",
        "机房供配电",
        "市电、变配电、UPS。一次中断全集群停机数小时，目标单独指定，不参与按权重分配",
        { scaling: "fixed", fixedTarget: 0.99999 },
      ),
      module("management", "facility", "管理面", "管理刀片、BMC"),
      module("software", "software", "软件与未归因", "调度、框架及未归因故障"),
    ],
    modes: [
      silent(
        "aicore-sdc",
        "aicore",
        "静默数据错误",
        AICORE_SDC_FIT,
        userScenario +
          "：静默占全部故障 1.4%，AICore 占其中 85%；检出率 90%，漏检后 48 小时才发现",
      ),
      hard(
        "npu-fault",
        "npu",
        "运行中断",
        TOTAL_FIT * 0.15 - AICORE_SDC_FIT,
        userScenario + "：NPU 占 15%，扣除 AICore 静默分支",
      ),
      hard(
        "hbm-uce",
        "hbm",
        "不可纠正错误",
        TOTAL_FIT * 0.15,
        userScenario + "：HBM 占 15%",
      ),
      hard(
        "node-fault",
        "node",
        "节点与板级中断",
        rest("node") - restSlow("node"),
        priorSplit,
      ),
      slow("node-slow", "node", "节点亚健康降速", restSlow("node")),
      hard("iod-fault", "iod-l1", "IO Die 通路失效", rest("iod"), priorSplit),
      hard(
        "optical-fault",
        "optical",
        "光模块失效",
        500,
        "用户给定单只 500 FIT；" + userScenario + "：光模块占 35%",
      ),
      hard(
        "fabric-fault",
        "l2-fabric",
        "互联设备与网卡中断",
        rest("fabric"),
        priorSplit,
      ),
      hard(
        "storage-fault",
        "storage",
        "存储服务故障",
        rest("storage"),
        priorSplit,
      ),
      hard(
        "power-fault",
        "power",
        "掉电与过热保护",
        rest("power") - restSlow("power"),
        priorSplit,
      ),
      slow("power-slow", "power", "散热异常降频", restSlow("power")),
      {
        id: "site-power-outage",
        moduleId: "site-power",
        name: "机房级供电中断",
        kind: "hard",
        // 示例假设：5 年一遇。FIT 按“一个机房一套供配电”计，不随卡数变化。
        fit: 1e9 / (5 * 8760),
        coverage: 1,
        detectHours: 0,
        lateDetectHours: 0,
        reworkHours: REWORK,
        // 不能自动恢复：需要人工恢复供电并重新拉起整个集群。
        ladder: makeLadder({ manual: { success: 1, hours: MANUAL } }),
        impact: 1,
        evidence:
          "示例假设：5 年一遇、人工恢复 4 小时。请替换为机房供配电的实际运行记录",
      },
      hard(
        "management-fault",
        "management",
        "管理面异常影响作业",
        rest("management"),
        priorSplit,
      ),
      hard(
        "software-fault",
        "software",
        "软件与未归因中断",
        rest("software") - OTHER_SDC_FIT,
        priorSplit + "；已扣除非 AICore 静默分支",
      ),
      silent(
        "other-sdc",
        "software",
        "其余静默数据错误",
        OTHER_SDC_FIT,
        userScenario + "：静默故障中非 AICore 的 15%，部件归属待补",
      ),
    ],
    measures: defaultMeasures(),
    allocation: { method: "agree", complexityBasis: "fit", customWeights: {} },
    source:
      "故障率取自 2026-11-12 周度用户场景，其余模块拆分取自现有基线故障库，属先验。检测与恢复链取自 2026-11-24 用户给出的现有措施与预计改进。措施库取自用户方案、现有基础机制和扩展机制库。",
  };
}
