import { z } from "zod";

/** Auxiliary L2 capacity model. These rates must NOT be residual FABRIC FIT. */
export const networkStudySchema = z
  .object({
    version: z.literal("1"),
    planes: z.number().int().min(1).max(8),
    requiredPlanes: z.number().int().min(1).max(8),
    cabinets: z.number().int().min(2).max(4),
    deviceFit: z.number().finite().min(0).max(1e9),
    deviceRepairHours: z.number().finite().positive().max(87600),
    cabinetFit: z.number().finite().min(0).max(1e9),
    cabinetRepairHours: z.number().finite().positive().max(87600),
    trials: z.number().int().min(1000).max(200000),
    seed: z.number().int().min(1).max(2147483647),
    evidence: z.enum(["demonstration", "project"]),
    source: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine((x) => x.requiredPlanes <= x.planes, "所需平面不能超过配置平面");
export type NetworkStudy = z.infer<typeof networkStudySchema>;

export const networkStudyDemo: NetworkStudy = {
  version: "1",
  planes: 8,
  requiredPlanes: 8,
  cabinets: 2,
  deviceFit: 100000,
  deviceRepairHours: 8,
  cabinetFit: 20000,
  cabinetRepairHours: 4,
  trials: 50000,
  seed: 20261025,
  evidence: "demonstration",
  source:
    "方法演示：人为提高失效概率以便观察同柜共因与跨柜冗余的差异；不是厂家指标、专家测量或项目预测。",
};

export const networkStudyLimits = [
  "仅包含 L2 设备与互联柜共同故障域；L1、光模块、供电上游、路由、带宽竞争和倒换瞬态需另行建模。",
  "一个平面至少一条 L2 路径存活才算可用；所需平面数是容量成功条件，需项目确认单路径剩余带宽。",
  "不同基本事件独立，重复机柜 ID 为同一共因；设备与机柜故障率需来自互不重叠的原因清单。",
  "BDD 使用 A=1/(1+FIT×10⁻⁹×维修小时)；蒙特卡洛为独立稳态快照抽样，不是动态维修或倒换仿真。",
  "跨规模连乘假定全部超节点同时必需且相互独立；不含跨超节点公共依赖，不等于训练可用度。",
  "结果不自动改写事件库，尤其不能在已含保护收益的 FABRIC 残余 FIT 上重复扣除冗余。",
];
