import { coreModelVersion, type CoreModel, type FaultMode } from "./model";

const seconds = (value: number) => value / 3600;

/**
 * 默认场景的来源：
 * - 故障率：2026-11-12 周度用户场景（每卡 HBM＋NPU 合计 1700 FIT，各占全部故障 15%；
 *   光模块占 35%；静默故障占 1.4%，其中 AICore 占 85%）。
 * - 其余 35% 的模块拆分：按 2026-10-14 基线故障库各对象的相对构成折算，属先验。
 * - 恢复链：现有评估模型的基线参数（95% 在 10 秒检出、其余 60 秒超时；恢复 180 秒、
 *   成功率 99%、失败后人工追加 2 小时；检查点周期 300 秒、保存 4 秒）。
 * 所有数值都是可编辑的场景输入，不代表厂商实测器件失效率。
 */
const TOTAL_FIT = 1700 / 0.3;
const AICORE_SDC_FIT = TOTAL_FIT * 0.014 * 0.85;
const OTHER_SDC_FIT = TOTAL_FIT * 0.014 * 0.15;
const REST_FIT = TOTAL_FIT * 0.35;
// 2026-10-14 基线故障库中各对象（中断＋亚健康＋静默）FIT 的分组合计。
const restBasis = {
  interconnect: 440.2,
  node: 742.9,
  facility: 426.5,
  storage: 142.7,
  software: 436.1,
};
const restTotal = Object.values(restBasis).reduce((sum, v) => sum + v, 0);
const rest = (key: keyof typeof restBasis) =>
  (REST_FIT * restBasis[key]) / restTotal;

const RECOVER = seconds(180 + 0.01 * 7200);
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

const userScenario = "2026-11-12 周度用户场景";
const priorSplit =
  "其余 35% 故障按 2026-10-14 基线故障库相对构成折算，属先验，待实测校准";

export function defaultCoreModel(): CoreModel {
  const module = (
    id: string,
    groupId: string,
    name: string,
    note: string,
    unitsPerCard = 1,
  ) => ({
    id,
    groupId,
    name,
    unitsPerCard,
    importance: 1,
    complexity: null,
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
      { id: "compute", name: "计算" },
      { id: "network", name: "网络" },
      { id: "storage", name: "存储" },
      { id: "facility", name: "供电与冷却" },
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
        "optical",
        "network",
        "光模块",
        "按每卡约 4 只折算，使其占全部故障约 35%；数量待 BOM 确认",
        4,
      ),
      module("interconnect", "network", "互联设备", "IO Die、L1/L2、网卡"),
      module("storage", "storage", "存储系统", "共享检查点与存储服务"),
      module("facility", "facility", "供电、冷却与管理", "柜级供电、液冷、BMC"),
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
      hard("node-fault", "node", "节点与板级故障", rest("node"), priorSplit),
      hard(
        "optical-fault",
        "optical",
        "光模块失效",
        500,
        "用户给定单只 500 FIT；" + userScenario + "：光模块占 35%",
      ),
      hard(
        "interconnect-fault",
        "interconnect",
        "互联设备故障",
        rest("interconnect"),
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
        "facility-fault",
        "facility",
        "供电冷却故障",
        rest("facility"),
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
    measures: [
      {
        id: "hbm-ecc",
        name: "HBM 纠错增强",
        direction: "mtbf",
        modeIds: ["hbm-uce"],
        effects: [{ param: "fit", op: "reduce", value: 0.6 }],
        enabled: true,
        evidence: "planned",
        rationale:
          "更强的 ECC 与行列修复把一部分不可纠正错误变为可纠正；可覆盖的错误模式需工程核验。",
      },
      {
        id: "aicore-screening",
        name: "AICore 静默故障压测筛查",
        direction: "mtbf",
        modeIds: ["aicore-sdc"],
        effects: [{ param: "fit", op: "reduce", value: 0.6 }],
        enabled: true,
        evidence: "planned",
        rationale:
          "上线前与在网周期压测筛除易产生静默错误的核；只降低 AICore 静默分支的发生率。",
      },
      {
        id: "optical-reliability",
        name: "光模块可靠性提升",
        direction: "mtbf",
        modeIds: ["optical-fault"],
        effects: [{ param: "fit", op: "set", value: 50 }],
        enabled: true,
        evidence: "planned",
        rationale:
          "器件筛选与链路保护把单只光模块失效率从 500 FIT 降到 50 FIT。",
      },
      {
        id: "sdc-detection",
        name: "静默故障在线检测增强",
        direction: "mttr",
        modeIds: ["aicore-sdc", "other-sdc"],
        effects: [{ param: "coverage", op: "set", value: 0.95 }],
        enabled: true,
        evidence: "planned",
        rationale:
          "检出率从 90% 提到 95%，漏检分支减半；检出后只需回滚到最近的干净检查点。",
      },
      {
        id: "sdc-audit",
        name: "漏检静默故障定期校验",
        direction: "mttr",
        modeIds: ["aicore-sdc", "other-sdc"],
        effects: [{ param: "missedLossHours", op: "set", value: 12 }],
        enabled: false,
        evidence: "assumed",
        rationale:
          "定期一致性校验与金标复算把漏检故障的发现时间从 48 小时压到 12 小时。",
      },
      {
        id: "fast-detect",
        name: "中断快速检测",
        direction: "mttr",
        modeIds: [
          "npu-fault",
          "hbm-uce",
          "node-fault",
          "optical-fault",
          "interconnect-fault",
          "storage-fault",
          "facility-fault",
          "software-fault",
        ],
        effects: [
          { param: "coverage", op: "set", value: 0.999 },
          { param: "detectHours", op: "set", value: seconds(1) },
        ],
        enabled: false,
        evidence: "assumed",
        rationale:
          "心跳与错误日志联合判定：99.9% 在 1 秒内发现，其余仍由 60 秒超时兜底。",
      },
      {
        id: "fast-recover",
        name: "进程级快速恢复",
        direction: "mttr",
        modeIds: [
          "aicore-sdc",
          "other-sdc",
          "npu-fault",
          "hbm-uce",
          "node-fault",
          "optical-fault",
          "interconnect-fault",
          "storage-fault",
          "facility-fault",
          "software-fault",
        ],
        effects: [
          {
            param: "recoverHours",
            op: "set",
            value: seconds(0.95 * 60 + 0.05 * (120 + 252)),
          },
        ],
        enabled: false,
        evidence: "assumed",
        rationale:
          "只重启受影响进程：95% 在 60 秒内恢复，失败后 120 秒退回整任务重启。",
      },
      {
        id: "fast-checkpoint",
        name: "快速检查点",
        direction: "mttr",
        modeIds: [
          "aicore-sdc",
          "other-sdc",
          "npu-fault",
          "hbm-uce",
          "node-fault",
          "optical-fault",
          "interconnect-fault",
          "storage-fault",
          "facility-fault",
          "software-fault",
        ],
        effects: [
          { param: "reworkHours", op: "set", value: seconds(30) },
          { param: "overhead", op: "set", value: 1 / 61 },
        ],
        enabled: false,
        evidence: "assumed",
        rationale:
          "检查点周期从 300 秒缩到 60 秒、保存 1 秒：平均回滚重算降到 30 秒，保存开销略升。",
      },
      {
        id: "elastic-recover",
        name: "域级弹性恢复",
        direction: "mttr",
        modeIds: [
          "npu-fault",
          "hbm-uce",
          "node-fault",
          "optical-fault",
          "interconnect-fault",
          "storage-fault",
          "facility-fault",
          "software-fault",
        ],
        effects: [{ param: "impact", op: "set", value: 0.98 / 50 + 0.02 }],
        enabled: false,
        evidence: "assumed",
        rationale:
          "把任务分成 50 个数据并行域：98% 的中断只让一个域停下，其余域继续训练；失败时退回全局恢复。",
      },
    ],
    allocation: { method: "agree", complexityBasis: "fit", customWeights: {} },
    source:
      "故障率取自 2026-11-12 周度用户场景；其余模块拆分与恢复链取自现有基线故障库和评估模型，属先验。",
  };
}
