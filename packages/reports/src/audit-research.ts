/** Public evidence supports mechanism feasibility, not project-specific FIT or benefit. */
export const reliabilityEvidence = [
  {
    id: "M1",
    name: "主动筛查与隔离",
    domain: "01 / 02 / 03",
    source: "SuperBench · ATC 2024",
    url: "https://www.usenix.org/conference/atc24/presentation/xiong",
    recommendation:
      "按器件、链路、工作负载分层压测；将误报、退役容量和维护开销共同计入。",
    validation: "对照观察期内故障率及灰故障；不能直接移植论文收益倍率。",
  },
  {
    id: "M2",
    name: "跨故障域冗余与容量成功门",
    domain: "02 / 03 / 04",
    source: "Jupiter Evolving · SIGCOMM 2022",
    url: "https://research.google/pubs/jupiter-evolving-transforming-googles-datacenter-network-via-optical-circuit-switches-and-software-defined-networking/",
    recommendation:
      "比较多路径与跨柜部署；将光模块、上游供电/控制和带宽门槛纳入共享事件。",
    validation: "BDD与独立MC交叉核验；倒换瞬态和重配置成本另入动态模型。",
  },
  {
    id: "M3 / M4",
    name: "快速检测与进程内 / 作业内恢复",
    domain: "01–05",
    source: "NVIDIA Megatron Bridge / NVRx",
    url: "https://docs.nvidia.com/nemo/megatron-bridge/0.4.1/training/resiliency.html",
    recommendation:
      "从心跳、hang检测、定位到温备替换逐段计时；小故障优先局部重启，大故障升级。",
    validation: "故障注入测覆盖率、P95/P99恢复时延、失败升级及恢复后正确性。",
  },
  {
    id: "M5",
    name: "分级异步检查点与快速重分片",
    domain: "01–06",
    source: "ByteCheckpoint · NSDI 2025",
    url: "https://www.usenix.org/conference/nsdi25/presentation/wan-borui",
    recommendation:
      "内存/本地SSD/远端持久层分级；与存储副本、网络带宽及重建流量共同规划。",
    validation: "周期×吞吐、持久化窗口与相关故障；零阻塞不表示零资源成本。",
  },
  {
    id: "M6 / M7",
    name: "正确性检测与慢节点定位",
    domain: "01–05",
    source: "MegaScale · NSDI 2024",
    url: "https://www.usenix.org/conference/nsdi24/presentation/jiang-ziheng",
    recommendation:
      "算子及通信遥测发现慢节点；正确性校验和SDC检测需独立补充覆盖证据。",
    validation:
      "灰故障注入与定界时间；MegaScale可观测性不等于99.91%静默检出率证明。",
  },
  {
    id: "基线",
    name: "事件范围与运维归因校准",
    domain: "01–05",
    source: "The Llama 3 Herd of Models · 2024",
    url: "https://arxiv.org/html/2407.21783v3",
    recommendation:
      "区分计划维护、硬件、软件与网络中断；使用设备小时及事件暴露归一化。",
    validation:
      "跨平台原始事件数不能直接转为昇腾器件FIT；保留删失、共因与置信区间。",
  },
];
