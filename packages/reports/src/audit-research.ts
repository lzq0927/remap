/** Dated first-party evidence. Vendor claims and future plans are never project FIT measurements. */
export const reliabilityEvidence = [
  {
    id: "M2 / M4 / M5",
    name: "Meta Prometheus：备用池与副本级恢复",
    domain: "01 / 02 / 03 / 05",
    source: "Meta Engineering · 2026-10-19",
    publishedAt: "2026-10-19",
    status: "生产实践（厂商披露）",
    url: "https://engineering.fb.com/2026/10/19/data-center-engineering/inside-prometheus-meta-gigawatt-scale-supercluster/",
    claim:
      "已运行的 GB200/GB300 集群采用64/72域内备用、额外机架及PAFT；Rubin仍是后续计划。",
    recommendation:
      "将物理故障位置映射到TP/PP/DP成员；联合评估有限备用池、局部恢复和分级检查点。",
    validation:
      "备用耗尽、拓扑可替换性、状态可信性及资源成本；goodput、MTBI与98.5%目标分别计量。",
  },
  {
    id: "M1 / M3 / M4",
    name: "NVIDIA Rubin：在线自检与互联容错",
    domain: "01 / 02 / 04",
    source: "NVIDIA Technical Blog · 2026-01-05",
    publishedAt: "2026-01-05",
    status: "产品能力（厂商文档）",
    url: "https://developer.nvidia.com/blog/inside-the-nvidia-rubin-platform-six-new-chips-one-ai-supercomputer/",
    claim:
      "披露二代RAS在线检测、SRAM现场修复、遥测预警及NVLink故障绕行；实际效果取决于部署。",
    recommendation:
      "分别建模源FIT、检测覆盖率、误隔离、局部替换和全局升级，避免重复计算收益。",
    validation:
      "按固件/负载验证检测、修复及绕行；厂商描述不直接折算本平台FIT或恢复秒数。",
  },
  {
    id: "M2 / M4 / M5",
    name: "Google Ironwood：可交付容量与训练连续性",
    domain: "01 / 02 / 03 / 05",
    source: "Google Cloud · 2026-05-11",
    publishedAt: "2026-05-11",
    status: "生产实践（厂商披露）",
    url: "https://cloud.google.com/blog/products/compute/cluster-reliability-for-trillion-parameter-models-on-tpus",
    claim:
      "按健康且互联的cube定义可交付规模；框架重配置、节点替换和多层检查点共同支撑训练。",
    recommendation:
      "把“至少k个健康故障单元”的容量成功门与固定窗口有效训练产出分别展示。",
    validation:
      "容量门用BDD/抽样；训练产出需动态模型，共因、重配置与降容开销不能省略。",
  },
  {
    id: "M2 / M3 / M4",
    name: "Atlas 950：故障影响与维修范围",
    domain: "01 / 02 / 04",
    source: "华为云产品文档 · 2026-10-21",
    publishedAt: "2026-10-21",
    status: "产品约束（官方文档）",
    url: "https://support.huaweicloud.com/resmgmt-modelarts/resmgmt-a5_0005.html",
    claim: "公开列出5808故障的超节点闪断、SFU/RoCE板维修范围及参数面监控缺口。",
    recommendation:
      "把闪断、整柜/半柜维修与定位时延纳入传播路径；保留超节点内与跨域共因。",
    validation: "文档2秒闪断只对应特定故障，不能设置为所有中断的通用MTTR。",
  },
  {
    id: "M2",
    name: "AMD Helios：整机架设计与部署计划",
    domain: "01 / 02 / 04",
    source: "AMD · Advancing AI 2026 · 2026-07-23",
    publishedAt: "2026-07-23",
    status: "产品发布 / 客户部署规划",
    url: "https://ir.amd.com/news-events/press-releases/detail/1294/aai-2026-amd-delivers-full-stack-compute-for-the-agentic-ai-era",
    claim:
      "披露72 GPU机架和全栈网络方案；客户上线按具体时间表推进，不能等同现场可靠性验证。",
    recommendation:
      "按GPU、HBM、主机和网络逐项记录数量/容量变化，形成代际BOM与暴露敏感性。",
    validation:
      "没有公开适用FIT/MTTR测量时保留待补；性能、带宽增幅不能冒充可靠性增幅。",
  },
  {
    id: "M2 / M7",
    name: "Meta 后续规划：大规模组网与功率约束",
    domain: "02 / 04",
    source: "Meta Prometheus / Hyperion规划 · 2026-10-19",
    publishedAt: "2026-10-19",
    status: "后续规划（未作达成结论）",
    url: "https://engineering.fb.com/2026/10/19/data-center-engineering/inside-prometheus-meta-gigawatt-scale-supercluster/",
    claim: "已用集群经验继续支撑后续超集群；未来部署规模与能力仍是规划。",
    recommendation:
      "将跨副本公共网络/供电依赖、限功率与持续降速损失加入同一责任账。",
    validation:
      "规划指标作为研究情景输入，需验证共因边界、功率裕量和真实吞吐曲线。",
  },
];
export const foundationalEvidence = [
  {
    source: "ByteCheckpoint · NSDI 2025",
    url: "https://www.usenix.org/conference/nsdi25/presentation/wan-borui",
    use: "异步检查点与重分片的机制基础；持久化和恢复带宽仍需本项目验证。",
  },
  {
    source: "SuperBench · ATC 2024",
    url: "https://www.usenix.org/conference/atc24/presentation/xiong",
    use: "主动筛查方法基础，不能直接移植收益倍率。",
  },
  {
    source: "Meta AI Hardware Reliability · 2025-07-22",
    url: "https://engineering.fb.com/2025/07/22/data-infrastructure/how-meta-keeps-its-ai-hardware-reliable/",
    use: "SDC与硬件可靠性基础，恢复后仍需校验干净状态。",
  },
];

export const parallelismEvidence = {
  source:
    "Training LLMs with Fault Tolerant HSDP on 100,000 GPUs · arXiv v1 2026-01-30",
  url: "https://arxiv.org/abs/2602.00277",
  use: "容错单位为DP副本，依赖动态成员的FTAR和非阻塞追赶。副本可含TP/PP等多个并行组，不能把一个NVL72域或超节点直接等同为一个副本；论文特定实验的训练效率不作为本项目目标值。",
};
