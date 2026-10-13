import type { EngineeringModel } from "../../../../packages/modeling/src/schema";
export type ModelEdit = (change: (draft: EngineeringModel) => void) => void;
export const uid = (prefix = "item") =>
  prefix + "-" + crypto.randomUUID().slice(0, 8);
export const labels: Record<string, string> = {
  architecture: "架构与组网",
  deployment: "部署与故障域",
  functional: "功能关系",
  hardware: "硬件",
  software: "软件",
  network: "网络",
  power: "供电",
  interruption: "中断",
  degradation: "降级",
  silent: "静默错误",
  contains: "包含",
  deployedOn: "部署于",
  connectsTo: "连接",
  dependsOn: "依赖",
  implements: "实现",
  flow: "功能流",
  component: "部件",
  service: "服务",
  instance: "部署实例",
  system: "系统",
  function: "功能",
  location: "位置",
  "fault-domain": "故障域",
  candidate: "候选",
  deployed: "已部署",
  disabled: "禁用",
  satisfied: "性质成立（当前检查范围）",
  violated: "发现反例",
  computed: "计算完成",
  inconclusive: "未得出结论",
};
export function download(
  name: string,
  content: BlobPart,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function changes(before: EngineeringModel, after: EngineeringModel) {
  return (Object.keys(before) as Array<keyof EngineeringModel>)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ field: key, before: before[key], after: after[key] }));
}
