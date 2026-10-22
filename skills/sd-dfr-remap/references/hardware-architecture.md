# 硬件组成、数量与传播诊断

## 输入与确认

默认主视图为硬件架构，`architecture.view='hardware'`，仍兼容version='1'及原功能分组。模板名称/层级不等于已验证部署；尤其Pod、机柜、超节点的包含顺序、每板NPU数、网络连接和共享故障域必须来自当前设计。四个卡数是并列规模，不是四层硬件包含关系。

节点可带hardwareLevel（component/chip/module/board/node/rack/supernode/pod/network/storage/facility/other）、inventory和rateModel。inventory={totals:{规模卡数:该类硬件总数量},topologyQuantity?,unitsPerParent?,source}。优先级为显式总数量、已配置拓扑公式、每上级数量比例；未知为null，不从规模猜光模块/交换机数量。新超节点模板与公式详见[supernode-topology.md](supernode-topology.md)。根节点表示一个被评估集群。每个根故障唯一归属一个叶节点，上层自身新增故障另设叶节点；父层只汇总，不能同时累计整体FIT与内部FIT。

连接/共享故障域在dependencies保存，kind=dependency/connection/shared-domain；不从连线推断独立串并联、传播概率或冗余收益。propagations记录{eventId,path,manifestation,impact,containment,source}；path从故障归属叶节点开始，不能重复节点或引用未知节点。一个故障一条记录，可编辑路径及影响说明；传播记录不产生第二份损失账。

结构、数量和传播更新进入第二阶段复核，分层预算第三阶段确认。从design_get保存的完整输入修改，不用新模板覆盖用户架构；历史结果继续读取原快照。

## 数量外推口径

默认保持NPU等效业务影响FIT。只有rateModel={referenceCards,referenceCount,source}明确启用后，才使用：

    本规模等效FIT = 参考目录FIT × 当前数量/参考数量 × 参考卡数/当前卡数

数量由该故障的归属叶节点确定，全部评估和敏感性规模必须可解析；缺失直接报错，参考数量与参考规模配置冲突也拒绝。参考FIT×参考卡数/参考数量仅为推得的每件等效FIT，不能称实测器件FIT。

第一轮、敏感性、Shapley、规划、独立改进共用该折算。修改FIT方案仍相对参考目录表达，再按数量折算一次。禁止把某规模scaleEvents中已折算的FIT直接回填为源FIT，否则重复乘数量。需要从某规模目标倒推参考FIT时，显式除以该数量倍率并记录依据；零数量不能反推出非零事件目标。

## 结果与建议

architectureDiagnosis.scales[].nodes增加quantity、dataStatus（modeled/partial/unknown）、missingObjects、targetAvailability、attributedAvailability、types[].lossHours、mechanismEffects和propagationRecords。targetAvailability/attributedAvailability为折算至业务口径的损失责任，不是独立模块稳态可用度。未知对象不能报告绿色达标；原仿真总量只是已建模结果。

rows[].scaleEvents在启用数量折算时保存该规模实际使用的目录；architectureDiagnosis.scales[].scaleEvents统一保存本规模诊断目录。源events保持参考目录；历史没有新字段时沿原模型解释，不补造数量或确认记录。

分别解释原事件间隔、检测与恢复停机、回滚/污染/降速/局部容量损失。businessMtbfHours当前为null，需要业务中断定义及独立观测，不用硬件FIT或恢复次数冒充。降低失效率是提高MTBF；快速倒换仍中断时是缩短MTTR，满足连续性判据才可解释为业务故障屏蔽。不能重复计入两种收益。

措施建议先核对对象和故障适用范围，再解释作用于发生率、传播/影响范围、检测、恢复还是进度损失。引用实际参数、专家库依据、预算和Shapley；仅凭高FIT或高历史贡献不能推出唯一优化方案。保持原第一轮冻结，audit_plan只规划，用户启动audit_evaluate后才生成新结果及增量贡献。
