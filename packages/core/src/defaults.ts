import {
  coreModelVersion,
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
 * - 恢复链：现有评估模型的基线参数（95% 在 10 秒检出、其余 60 秒超时；恢复 180 秒、
 *   成功率 99%、失败后人工追加 2 小时；检查点周期 300 秒、保存 4 秒）。
 * - 措施库：用户给出的四项，加上现有基础机制（8 项）和扩展机制库（16 项）的全部条目。
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

const RESTART = seconds(180);
const RECOVER = RESTART + seconds(0.01 * 7200);
const REWORK = seconds(150);
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
  coverage: 0.95,
  detectHours: seconds(10),
  recoverHours: RECOVER,
  reworkHours: REWORK,
  missedLossHours: seconds(60) + RECOVER + REWORK,
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
  coverage: 0.9,
  detectHours: seconds(1),
  recoverHours: RECOVER,
  reworkHours: REWORK,
  missedLossHours: 48,
  impact: 1,
  evidence,
});
// 亚健康不中断任务，只是降速 5%。检测等待与漏检损失已折算成等效停机时间：
// 检出前 5 分钟 × 5% = 15 秒；漏检持续 24 小时 × 5% = 1.2 小时；处置 3 分钟，不回滚。
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
  coverage: 0.95,
  detectHours: seconds(0.05 * 300),
  recoverHours: RESTART,
  reworkHours: 0,
  missedLossHours: 0.05 * 24,
  impact: 1,
  evidence:
    priorSplit + "；降速 5%，检测等待与漏检损失已按降速比例折算为等效停机时间",
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
/** 基线故障库中可由进程重调度、局部弹性恢复处理的中断。 */
const LOCAL = ["npu-fault", "hbm-uce", "node-fault", "iod-fault"];
const RESTARTED = [...SDC, ...HARD];

const effect = (
  param: MeasureEffect["param"],
  op: MeasureEffect["op"],
  value: number,
): MeasureEffect => ({ param, op, value });
const measure = (
  id: string,
  name: string,
  direction: Measure["direction"],
  modeIds: string[],
  effects: MeasureEffect[],
  rationale: string,
  options: Partial<
    Pick<Measure, "enabled" | "evidence" | "applicability" | "source">
  > = {},
): Measure => ({
  id,
  name,
  direction,
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
  source: "用户方案",
};
const untested = "适用并成功的比例尚无实测，暂取 50%，请按故障注入结果修改。";

/** 默认措施库：可在“基础库”中增删改，也可随时从这里补回缺失的条目。 */
export function defaultMeasures(): Measure[] {
  return [
    // ---------- 提升 MTBF ----------
    measure(
      "hbm-ecc",
      "HBM 纠错增强",
      "mtbf",
      ["hbm-uce"],
      [effect("fit", "reduce", 0.6)],
      "更强的 ECC 与行列修复把一部分不可纠正错误变为可纠正；可覆盖的错误模式需工程核验。",
      user,
    ),
    measure(
      "aicore-screening",
      "AICore 静默故障压测筛查",
      "mtbf",
      ["aicore-sdc"],
      [effect("fit", "reduce", 0.6)],
      "上线前与在网周期压测筛除易产生静默错误的核；只降低 AICore 静默分支的发生率。",
      user,
    ),
    measure(
      "optical-reliability",
      "光模块可靠性提升",
      "mtbf",
      ["optical-fault"],
      [effect("fit", "set", 50)],
      "器件筛选与链路保护把单只光模块失效率从 500 FIT 降到 50 FIT。",
      user,
    ),
    measure(
      "sdc-online-screen",
      "在线压测与异常资源筛除",
      "mtbf",
      SDC,
      [effect("fit", "reduce", 0.25)],
      "运行中周期压测并筛除异常资源，目标是静默故障发生率下降 25%。只对验证过的资源子集成立；压测占用的时间未计入。",
      { source: "扩展机制库 H-SDC-SCREEN" },
    ),
    measure(
      "memory-predict",
      "内存故障预测与主动隔离",
      "mtbf",
      ["hbm-uce"],
      [effect("fit", "reduce", 0.3)],
      "根据可纠正错误的增长趋势提前隔离即将失效的存储单元，把一部分突发故障变成计划内处置。降低 30% 为示例取值，没有现成来源。",
      { source: "示例措施" },
    ),
    measure(
      "power-redundancy",
      "供电冗余与器件降额",
      "mtbf",
      ["power-fault"],
      [effect("fit", "reduce", 0.5)],
      "增加电源冗余并对关键器件降额使用，减少保护后仍然掉电的情况。降低 50% 为示例取值，没有现成来源。",
      { source: "示例措施" },
    ),

    // ---------- 降低 MTTR：检测 ----------
    measure(
      "sdc-detection",
      "静默故障在线检测增强",
      "mttr",
      SDC,
      [effect("coverage", "set", 0.95)],
      "检出率从 90% 提到 95%，漏检分支减半；检出后只需回滚到最近的干净检查点。",
      { ...user, source: "用户方案；基础机制 D-SDC" },
    ),
    measure(
      "fast-detect",
      "中断快速检测",
      "mttr",
      HARD,
      [
        effect("coverage", "set", 0.999),
        effect("detectHours", "set", seconds(1)),
      ],
      "心跳与错误日志联合判定：99.9% 在 1 秒内发现，其余仍由 60 秒超时兜底。未计误报和检测资源开销。",
      { source: "基础机制 D-HARD" },
    ),
    measure(
      "slow-detect",
      "亚健康快速检测",
      "mttr",
      SLOW,
      [
        effect("coverage", "set", 0.99),
        effect("detectHours", "set", seconds(0.05 * 30)),
      ],
      "95% 在 5 分钟发现提到 99% 在 30 秒发现；按降速 5% 折算，等效检测等待为 1.5 秒。需要区分真实亚健康与负载变化。",
      { source: "基础机制 D-SLOW" },
    ),
    measure(
      "sdc-abft",
      "算子 ABFT 实时矩阵校验",
      "mttr",
      ["aicore-sdc"],
      [effect("coverage", "reduce", 0.9), effect("overhead", "add", 0.001)],
      "在算子内做校验，捕获前一道检测剩余漏检中的 90%；代价是正常运行时约 0.1% 的吞吐损失。",
      { source: "扩展机制库 D-ABFT" },
    ),
    measure(
      "sdc-precision",
      "FP8 / FP4 计算路径静默检测",
      "mttr",
      ["aicore-sdc"],
      [effect("coverage", "reduce", 0.95)],
      "为尚未验证的 FP8、FP4 计算路径单独增加检测，目标检出 95%。这两条路径占 AICore 静默风险的份额没有给出，适用比例暂取 0，填入份额后才计收益。",
      { applicability: 0, source: "扩展机制库 D-SDC-FP8、D-SDC-FP4" },
    ),
    measure(
      "net-sdc",
      "网络端到端静默检测",
      "mttr",
      ["other-sdc"],
      [effect("coverage", "reduce", 0.95)],
      "对网络传输做端到端校验，目标检出 95% 的网络静默错误。基线故障库中网络占非 AICore 静默故障约 44%，适用比例据此取值。",
      { applicability: 0.44, source: "扩展机制库 D-NET-SDC" },
    ),
    measure(
      "sdc-audit",
      "漏检静默故障定期校验",
      "mttr",
      SDC,
      [effect("missedLossHours", "set", 12)],
      "定期一致性校验与金标复算把漏检故障的发现时间从 48 小时压到 12 小时。12 小时为设计假设。",
      { source: "本工作台补充" },
    ),

    // ---------- 降低 MTTR：恢复 ----------
    measure(
      "sdc-step-recover",
      "静默故障干净 step 恢复",
      "mttr",
      SDC,
      [
        effect("recoverHours", "set", seconds(1)),
        effect("reworkHours", "set", seconds(1)),
      ],
      "已检出的静默故障从保存在内存里的上一个干净 step 恢复：1 秒恢复，最多重做 1 秒计算。不缩短漏检分支。",
      { source: "基础机制 R-SDC" },
    ),
    measure(
      "replay",
      "通信与算子重执行",
      "mttr",
      ["npu-fault", "hbm-uce", "iod-fault", "optical-fault"],
      [
        effect("recoverHours", "set", seconds(5)),
        effect("reworkHours", "set", 0),
      ],
      "瞬态中断先原地重执行：成功时 5 秒恢复且不回滚。基线成功率 90%，再按各模块瞬态故障的占比折减（HBM 约 70% 为可重放的瞬态错误），适用比例综合取 80%。",
      { applicability: 0.8, source: "基础机制 R-REPLAY" },
    ),
    measure(
      "fast-recover",
      "进程级快速恢复",
      "mttr",
      LOCAL,
      [effect("recoverHours", "set", seconds(60 + (120 * 0.05) / 0.95))],
      "只重建受影响的进程：95% 在 60 秒内恢复；失败时多花 120 秒后退回整任务重启，这部分已摊入目标值。仍需回滚到检查点。",
      { applicability: 0.95, source: "基础机制 R-PROCESS" },
    ),
    measure(
      "elastic-recover",
      "域级弹性恢复",
      "mttr",
      LOCAL,
      [effect("impact", "set", 1 / 50)],
      "把任务分成 50 个数据并行域：98% 的中断只让一个域停下，其余域继续训练；失败时退回全局恢复。",
      { applicability: 0.98, source: "基础机制 R-ELASTIC" },
    ),
    measure(
      "contain",
      "故障隔离与传播抑制",
      "mttr",
      ["iod-fault", "fabric-fault"],
      [effect("recoverHours", "set", seconds(4.6 + 72))],
      "把互联故障限制在一个域内：180 秒全局停止变为 1 秒全局协调加 1/50 的域局部恢复，等效 4.6 秒（人工兜底的 72 秒期望值不变）。是域级弹性恢复的前提。" +
        untested,
      { applicability: 0.5, source: "扩展机制库 I-CONTAIN" },
    ),
    measure(
      "link-local",
      "链路透明恢复",
      "mttr",
      ["iod-fault", "optical-fault", "fabric-fault"],
      [
        effect("detectHours", "set", 0),
        effect("recoverHours", "set", seconds(2)),
        effect("reworkHours", "set", 0),
      ],
      "瞬态链路异常在链路层纠错、重传或重训练，成功后训练继续，总停顿约 2 秒且不回滚。不能覆盖永久损坏。" +
        untested,
      { applicability: 0.5, source: "扩展机制库 R-LINK-LOCAL" },
    ),
    measure(
      "fabric-degrade",
      "网络绕行与降级运行",
      "mttr",
      ["optical-fault", "fabric-fault"],
      [
        effect("detectHours", "set", 0),
        effect("recoverHours", "set", seconds(165.6)),
        effect("reworkHours", "set", 0),
      ],
      "2 秒切换到备用路径后降速运行 30 分钟再恢复，整个降级期等效损失约 165.6 秒，代替 342.5 秒的全局重启。" +
        untested,
      { applicability: 0.5, source: "扩展机制库 R-FABRIC-DEGRADE" },
    ),
    measure(
      "control-continuity",
      "控制面异常下业务连续运行",
      "mttr",
      ["management-fault"],
      [
        effect("detectHours", "set", 0),
        effect("recoverHours", "set", seconds(1)),
        effect("reworkHours", "set", 0),
      ],
      "管理面故障不再升级成训练中断：数据面保持运行，训练停顿预算 0–1 秒。" +
        untested,
      { applicability: 0.5, source: "扩展机制库 H-CONTROL-CONTINUITY" },
    ),
    measure(
      "recovery-classify",
      "故障分类与恢复动作匹配",
      "mttr",
      RESTARTED,
      [effect("recoverHours", "set", seconds(180 + 0.001 * 7200))],
      "按故障类型选择恢复动作，需要 2 小时人工处理的比例从 1% 降到 0.1%，恢复的期望耗时由 252 秒降到 187.2 秒。",
      { source: "扩展机制库 D-RECOVERY-CLASSIFY" },
    ),
    measure(
      "runtime-snapshot",
      "运行时初始化快照",
      "mttr",
      [
        "npu-fault",
        "hbm-uce",
        "node-fault",
        "iod-fault",
        "fabric-fault",
        "software-fault",
      ],
      [effect("recoverHours", "set", RECOVER - seconds(45))],
      "用初始化镜像恢复运行时，启动阶段从 60 秒缩到 15 秒，恢复总时长减少 45 秒。",
      { source: "扩展机制库 R-RUNTIME-SNAPSHOT" },
    ),
    measure(
      "warm-process",
      "预热进程与可信状态接替",
      "mttr",
      ["software-fault"],
      [effect("recoverHours", "set", RECOVER - seconds(40))],
      "保持预热的备用进程，启动阶段从 60 秒缩到 20 秒，恢复总时长减少 40 秒。",
      { source: "扩展机制库 R-WARM-PROCESS" },
    ),
    measure(
      "hccl-elastic",
      "HCCL 通信域弹性重建",
      "mttr",
      ["npu-fault", "iod-fault", "fabric-fault", "software-fault"],
      [effect("recoverHours", "set", RECOVER - seconds(45))],
      "通信重建阶段从 60 秒压到 15 秒，恢复总时长减少 45 秒。",
      { source: "扩展机制库 R-HCCL-ELASTIC" },
    ),
    measure(
      "cann-graph",
      "CANN 图准备与启动缓存",
      "mttr",
      ["npu-fault", "node-fault", "fabric-fault", "software-fault"],
      [effect("recoverHours", "set", RECOVER - seconds(22.5))],
      "缓存图编译与准备结果，图准备阶段从 30 秒降到 7.5 秒，恢复总时长减少 22.5 秒。",
      { source: "扩展机制库 R-CANN-GRAPH" },
    ),
    measure(
      "lossless-checkpoint",
      "无损检查点压缩",
      "mttr",
      RESTARTED,
      [effect("recoverHours", "set", RECOVER - seconds(20))],
      "检查点压缩后读取 30 秒、解压 10 秒，读取阶段从 60 秒降到 40 秒，恢复总时长减少 20 秒。不改变保存周期。",
      { source: "扩展机制库 C-LOSSLESS" },
    ),

    // ---------- 降低 MTTR：检查点 ----------
    measure(
      "fast-checkpoint",
      "更频繁的检查点",
      "mttr",
      RESTARTED,
      [
        effect("reworkHours", "set", seconds(30)),
        effect("overhead", "set", 1 / 61),
      ],
      "检查点周期从 300 秒缩到 60 秒、每次保存 1 秒：平均回滚重算降到 30 秒，保存开销由 1.32% 升到 1.64%。",
      { source: "基础机制 C-FAST" },
    ),
    measure(
      "async-checkpoint",
      "异步检查点保存",
      "mttr",
      RESTARTED,
      [
        effect("overhead", "set", 1 / 301),
        effect("reworkHours", "add", seconds(10)),
      ],
      "每次保存对训练的阻塞从 4 秒降到 1 秒，保存开销由 1.32% 降到 0.33%；数据落盘滞后 10 秒，回滚时多重算 10 秒。",
      { source: "扩展机制库 C-ASYNC" },
    ),
  ];
}

export function defaultCoreModel(): CoreModel {
  const module = (
    id: string,
    groupId: string,
    name: string,
    note: string,
    options: { unitsPerCard?: number; container?: string } = {},
  ) => ({
    id,
    groupId,
    name,
    unitsPerCard: options.unitsPerCard ?? 1,
    importance: 1,
    complexity: null,
    container: options.container ?? "",
    note,
  });
  return {
    schemaVersion: coreModelVersion,
    name: "50 万卡训练集群 · 周度可用度",
    scenario: {
      cards: 500000,
      hours: 168,
      target: 0.95,
      overhead: 4 / 304,
      passRatio: 0.9,
    },
    groups: [
      { id: "compute", name: "计算", layout: "grid" },
      { id: "network", name: "网络", layout: "chain" },
      { id: "storage", name: "存储", layout: "grid" },
      { id: "facility", name: "供电、冷却与管理", layout: "grid" },
      { id: "software", name: "软件与调度", layout: "grid" },
    ],
    modules: [
      module("aicore", "compute", "AICore", "NPU 内的计算核；只承载静默分支", {
        container: "NPU 模组",
      }),
      module(
        "npu",
        "compute",
        "NPU 其余部分",
        "SRAM、逻辑、封装等除 AICore 静默以外的 NPU 故障",
        { container: "NPU 模组" },
      ),
      module("hbm", "compute", "HBM", "按每卡等效 FIT 计，不再乘 HBM 颗数", {
        container: "NPU 模组",
      }),
      module("node", "compute", "节点与板级", "CPU、DDR、SSD、模组与板级连接"),
      module("iod-l1", "network", "IO Die 与 L1 互联", "片内 IO Die、D2D 通路"),
      module(
        "optical",
        "network",
        "光模块",
        "按每卡约 4 只折算，使其占全部故障约 35%；数量待 BOM 确认",
        { unitsPerCard: 4 },
      ),
      module(
        "l2-fabric",
        "network",
        "L2 / Leaf / Spine 与网卡",
        "UB 网卡、IO 转换板、L1/L2 互联设备",
      ),
      module("storage", "storage", "存储系统", "共享检查点与存储服务"),
      module("power", "facility", "供电与冷却", "柜级供电、液冷与风扇"),
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
          "：静默占全部故障 1.4%，AICore 占其中 85%；检出率 90%，漏检恢复 48 小时",
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
      "故障率取自 2026-11-12 周度用户场景；其余模块拆分与恢复链取自现有基线故障库和评估模型，属先验。措施库取自用户方案、现有基础机制和扩展机制库。",
  };
}
