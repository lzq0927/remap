export const atlas950ReferenceUrl =
  "https://support.huaweicloud.com/resmgmt-modelarts/resmgmt-a5_0003.html";
export const atlas950Evidence = [
  {
    item: "评估单元",
    value: "1024 NPU模组；16计算柜 × 64模组",
    basis: "正文与PDF第1–2页",
    status: "文档明确",
  },
  {
    item: "L1 / L2",
    value: "64个L1刀片 × 32口 → 16台L2 × 128口",
    basis: "正文端口公式；原图L1位于计算柜",
    status: "按公式解释",
  },
  {
    item: "互联柜部署",
    value: "正文：2柜 × 8台L2；图1：编号1…4、每柜画4台L2",
    basis: "PDF第1页正文与第2页图1有差异；可选择部署参照",
    status: "来源冲突",
  },
  {
    item: "互联平面",
    value: "8平面，每平面2台L2；图例采用同柜一对",
    basis: "正文与PDF第2页图1/2；允许任意2台L2组成平面",
    status: "文档明确",
  },
  {
    item: "光模块保护",
    value: "2+2保护组；单光模块故障不中断",
    basis: "正文；不据此假设所有路径独立或满带宽",
    status: "保护语义",
  },
  {
    item: "IO与网卡",
    value: "2个IO刀片/计算柜；每IO选8张UB NIC，也可16张",
    basis: "PDF第1页正文、第2页图1",
    status: "示例配置",
  },
  {
    item: "参数面",
    value: "Spine–Leaf，上行不收敛，各Spine链路数相同",
    basis: "PDF第3页；图例双网络，端口数量与款型相关",
    status: "约束明确",
  },
  {
    item: "板、框与更大集群",
    value: "默认8模组/板与节点；按完整互联单元扩展，尾柜按需部署",
    basis: "ReMAP可编辑工程假设，非指定文档确认的BOM",
    status: "待项目确认",
  },
  {
    item: "逐器件FIT / 维修时间",
    value: "指定组网资料没有提供",
    basis: "故障库等效FIT不可充当新网络子模型的原始设备FIT",
    status: "待补证据",
  },
] as const;

export const atlas950LayoutConflict =
  "原资料存在互联柜差异：正文2柜×8台L2，图1标到4柜且每柜画4台L2。默认沿用正文；改变分柜会改变共因暴露，需以项目BOM确认。";
