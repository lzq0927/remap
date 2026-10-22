# 超节点组网参考、规模数量与量化区域

## 架构与证据

新任务默认`architecture.topology.kind='supernode-reference'`；这是可校准参考模板，历史快照和原硬件/功能模板仍按原样解释。用户提供的1024卡组网页面作为待核对来源；补充华为官方资料验证了板内/板间/柜间互联及多种超节点产品，但不同型号的板柜密度不能混用。默认64卡/柜、8卡/节点与板、32超节点/Pod是工程假设，不是已确认A5 BOM。

主图区分计算组成、超节点内高速互联、超节点间扩展网络、光链路、存储、供电/冷却/管理、软件与公共开销。原BOXIO、FABRIC等粗粒度故障组的映射是可编辑归属，不能将其称为已拆分的逐交换机故障。Leaf新增故障未知，不能从原FABRIC复制一份FIT。组成层级修改后自动使用通用包含图，避免用固定参考布局误示已修改的包含关系。所有自定义连接见平面全景及证据。

## 数量

`topology`记录cardsPerSupernode/cardsPerRack/cardsPerNode/cardsPerBoard/supernodesPerPod；容量逐层整除。交换设备参数为scaleUpSwitchesPerRack、scaleOutLeavesPerSupernode、scaleOutSpinesPerPod；光链路为opticalLinksPerNode、opticalLinksPerSupernode。后五项null表示未知，0表示明确不存在。必须记录source。

`inventory.topologyQuantity`引用cards/boards/nodes/racks/supernodes/pods/scaleUpSwitches/scaleOutLeaves/scaleOutSpines/scaleOutSwitches/opticalModules。优先级：各规模显式totals → 配置的拓扑公式 → 每上级组成比例。使用公式的节点保存时保留该字段，用户可关闭公式。千卡1000与参考单元1024是两个不同规模。图中各层汇总数量，不将父子层相加。

超节点数=ceil(实际卡数/单超节点容量)，最后一个可未满；使用中机柜按实际卡数占用，整超节点预留容量另列。默认50万卡为489个超节点、7813个使用中机柜、62500个节点；整超节点预留容量500736卡，不能用预留卡数替换故障暴露。光模块数=2×（节点数×每节点光链路数+超节点数×跨域光链路数），仅统计已明确的链路范围；铜缆、重复端点与其他链路需按BOM校准。

## 量化与后续方法

图中同时提供数量、NPU等效FIT、区域总事件FIT、分层目标与当前可用度。区域总事件FIT=当前规模等效FIT×实际评估卡数，包含中断/亚健康/静默；不是实测器件FIT或业务中断率，不能再乘设备数量。单器件等效FIT仅在rateModel与数量映射有依据时推导。默认加载拓扑只改变数量与归属，不改变原仿真和Shapley；显式启用rateModel后，全部求解入口共用数量折算一次。

分层目标=1−该层允许损失/窗口，当前可用度=1−该层已建模损失/窗口，为业务损失责任投影，非模块稳态可用度；不能把这些区域百分比连乘。叶层互斥计账，父层汇总，未知故障标为不完整。预览时当前可用度待评估；1000参考点及未指定目标的1024预览不补造分层目标。

从该架构继续确认分层预算（均分/权重/AGREE有限窗口适配），沿故障唯一归属查频率、恢复及其他损失；机制按对象/功能域/故障类型/阶段/能力/参数匹配。第一轮全局Shapley形成初始重要度，再做AGREE责任分配与参数候选，用户启动后独立复评；不从图形或高FIT臆造局部Shapley或冗余收益。输入拓扑/数量/传播修改从第二阶段复核，预算修改从第三阶段；冻结第一轮不被改写。

SVG/PNG可导出当前视图；JSON/HTML保留完整关联和来源，正式HTML/Markdown报告保留数量、两类FIT与可用度口径。图中的仿真值与规划参数需按各轮独立说明，测试/快速采样不是实测或达标证明。
