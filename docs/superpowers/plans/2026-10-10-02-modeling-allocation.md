# 子计划 02：可靠性计算与目标分解实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Follow T08—T16. Treat reference outputs as versioned evidence, not universal constants.

**Goal:** 从固定产品目标生成组件与机制要求，执行可靠性计算、方案权衡和验证，输出有条件、有证据的达标判断。

**Architecture:** 方法注册表声明输入、适用条件与支持语义；分配器生成候选要求，求解器正向评估，分析模块处理统计、归因与搜索。专家 V4 通过独立适配器保留行为；CTMC 以科学计算进程提供服务。

**Tech Stack:** TypeScript/Vitest、独立 Node 求解进程；Python/NumPy/SciPy/pytest 用于 CTMC；JSON 输入输出协议。

---

依赖 T01—T03 的契约与指标，完整服务接入依赖 T07。所有路径相对 `D:\code\sys_reliability`。数值基准在编码前写入测试，不能用被测实现自动生成期望值。

## T08 指定专家 V4 的可复现适配

**文件：** `references/expert-v4/{manifest.json,README.md}`、`scripts/fetch-expert-reference.ts`、`packages/solvers/src/expert-v4/{adapter,config-map}.ts`、`tests/expert/{metric,baseline,coalitions}.test.ts`、`tests/fixtures/expert-v4/`。

- [ ] 锁定提交 `683afe829313bfdcb249bc593e48df5b29813666`，获取根目录 HTML、场景与证据模块、月度训练仿真引擎、Shapley 模块及实际依赖。逐文件记录来源、摘要、使用说明；不执行参考仓库自动安装钩子，不修改原始快照。
- [ ] 抽取 HTML 的 `precomputed` JSON，断言 `version='4.0-domain-ledger'`、`metric='delivery'`、`hours=720`。提取原始配置而不是手工复制最新审核分支参数。
- [ ] 建立完整配置映射，区分秒/分钟/小时、百分数/比率、单卡等效 FIT/附加共享 FIT、运行/日历时钟、检查点周期语义与 step 状态。未支持的通用场景语义返回 `UNSUPPORTED_SEMANTICS`，禁止丢字段后继续求解。
- [ ] 创建以下结果断言，核对参考返回字段与通用指标映射：

```ts
expect(htmlSnapshot.metric).toBe('delivery');
expect(mapReferenceResult({delivery: 0, effective: 0.8, uptime: 0.95}).metricValue).toBe(0);
expect(mapReferenceResult({delivery: 0.6, effective: 0.6, uptime: 0.95}).metricValue).toBe(0.6);
```

`mapReferenceResult` 在 adapter.ts 导出，只接收这三个诊断值并将 `delivery` 映射至主指标；其他返回字段另由完整运行结果装配，不能替换主指标。

- [ ] 在 1 万卡与 10 万卡、基线与关键组合、固定种子集合 `[9137, 42, 20261010]` 上直接比较参考模块与适配器逐轨迹结果；核对 delivery 和各账本项。再执行指定配置的聚合回归，保存运行环境和耗时。
- [ ] 运行 `pnpm test:expert`；预期指定版本一致，不以近似“相差不大”替代逐轨迹适配一致性。原始参考和新增模型的验证状态分别记录。

## T09 通用训练场景与透明损失账本

**文件：** `packages/solvers/src/training/{model-compiler,event-process,topology,recovery,ledger,adapter}.ts`、`packages/solvers/test/training-ledger.test.ts`、`scenarios/training/{manifest,baseline-v4,user-targets}.json`。

- [ ] 建立组件→故障域→作业影响映射，把组件数量、硬件 FIT 和模式比例分别保存；共享故障作为独立根因源，不能重复按每张卡累计。
- [ ] 从专家复现层向通用层增量映射；保持原样参考适配器用于回归。仅对已声明的可支持拓扑运行通用模型；先实现全局和有界局部恢复域，显式拒绝尚未实现的网络/传播动态。
- [ ] 实现运行暴露与日历暴露的两个时钟；故障真值与策略可观测信息分离。参考中的真值辅助恢复标为理想能力，不能冒充已验证的真实检测策略。
- [ ] 统一账本包含 pause、checkpointSave、unavailableCapacity、slowdown、monitoring、replaySlowdown、rollback、unrecoveredCorruptWork、terminalDiscard、delivered，全部以等效理想工作量计。
- [ ] 先测试确定性时间线：T=100、停顿=10、保存=5、其他损失=0、期末干净时 delivered=85；同样轨迹期末污染时 terminalDiscard=85、delivered=0。恢复重算只增加当前净进度，不同时作为新增产出和额外损失再次计算。
- [ ] 增加机制覆盖、失败回退与并发修复资源样例；两事件重叠停顿计并集，等待队列时长不能再作为整体停顿重复扣除。永久故障未隔离前不能因一次重算自动清除根因。
- [ ] 运行 `pnpm exec vitest run packages/solvers/test/training-ledger.test.ts` 和 `pnpm test:expert`，新能力不得改变参考模式原有结果。

## T10 指标分配方法与适用性

**文件：** `packages/allocation/src/{types,registry,equal,availability,arinc,agree,validate}.ts`、`packages/allocation/test/{methods,eligibility}.test.ts`、`docs/methods/allocation.md`。

- [ ] 定义 `AllocationRequest`：metricId、target、missionHours、items（id、baselineRate、complexity、importance、operatingHours、locked、bounds）、assumptions、budgetType。输出逐项分配、方法版本、适用性、假设、限制及待正向验证标记。
- [ ] 对独立串联且同任务时长的可靠度，使用总失效率预算 `B=-ln(R_target)/T`。Equal：`λ_i=B/n`；ARINC：`λ_i=B*λ_i0/Σλ_j0`。基线和为零时 ARINC 返回数据不足，不静默改成 Equal；可建议用户选择 Equal。
- [ ] Availability 策略以独立串联运行可用度为对象，`A_i=A_target^w_i`，其中非负权重和为 1。若已锁定项，先扣除其对数预算，再分配剩余项；不能满足上下界时报告约束冲突。
- [ ] AGREE 首先实现明确命名的 `agree.nasa2016-rate`：`λ_i = n_i*(-ln R_target)/(N*E_i*t_i)`。记录复杂度 n、重要度 E、运行时间 t 的定义；E=0、t=0 不直接除法求解，返回不适用或从关键任务分配集合排除并说明。E 远离 1 或有冗余时标明近似限制，最终用对应结构模型回算，不直接保证目标。
- [ ] 保留 Equal 的“训练损失预算均分”单独方法 ID：其输出是理想产出损失额度，不是组件可靠度；每条预算需有工程参数映射后才能提交正向评估。
- [ ] 使用以下已知样例作为测试期望，先运行失败，再实现公式与边界检查。

```ts
// 独立串联任务可靠度 R=exp(-0.04)，T=10 h，总失效率 0.004/h。
expect(equalRates({target: Math.exp(-0.04), hours: 10, count: 2}))
  .toEqual([expect.closeTo(0.002, 12), expect.closeTo(0.002, 12)]);
expect(arincRates({target: Math.exp(-0.04), hours: 10, baselineRates: [0.001, 0.003]}))
  .toEqual([expect.closeTo(0.001, 12), expect.closeTo(0.003, 12)]);
expect(allocateAvailability({target: 0.9801, weights: [0.5, 0.5]}))
  .toEqual([expect.closeTo(0.99, 12), expect.closeTo(0.99, 12)]);
```

上述函数分别由 equal.ts、arinc.ts、availability.ts 导出。AGREE 测试使用同一 R、复杂度 `[1,3]`、重要度 `[1,1]`、运行小时 `[10,10]`，期望失效率 `[0.001,0.003]`。

- [ ] 运行 `pnpm exec vitest run packages/allocation/test`；输入 `training.correct_delivery_ratio` 到传统可靠度分配器时必须返回 `METHOD_INAPPLICABLE`，只能通过明确子模型调用。

方法依据：[NASA/TM-2016-218488](https://ntrs.nasa.gov/api/citations/20160013858/downloads/20160013858.pdf)。不同 AGREE 公式版本不能使用同一方法 ID。

## T11 RBD、FTA 与 BDD

**文件：** `packages/solvers/src/{rbd,fta,bdd,importance}.ts`、`packages/solvers/test/static-models.test.ts`、`tests/fixtures/static-models.json`、`docs/methods/static-models.md`。

- [ ] RBD 支持独立串并联和 k-out-of-n 的无重复组件结构；遇到重复组件引用转为统一布尔事件表示，不能当作两个独立设备相乘。
- [ ] FTA 支持 AND/OR 和明确基本事件 ID。构造有序 BDD，合并同构节点，memoize apply；概率按变量唯一 ID 计算。BDD 本身不自动解决相关故障，共因关系必须显式建模后计算。
- [ ] 为资源控制设置初始上限 100000 BDD 节点、20 个基本事件用于全真值表交叉验算；超过节点上限返回 `RESOURCE_LIMIT`，不把部分计算当精确结果。
- [ ] 数值验收：串联 0.9×0.8=0.72；并联 1-(0.1×0.2)=0.98；三个可靠度 0.9 的 2-out-of-3=0.972；FTA `A OR (A AND B)`、P(A)=0.1、P(B)=0.2，结果必须为 0.1。
- [ ] 在不超过 12 个基本事件的固定样例上枚举真值表，与 BDD 比较误差 ≤1e-10。输出最小割集时限制条目数，截断明确标识，不能宣称完整。
- [ ] 运行 `pnpm exec vitest run packages/solvers/test/static-models.test.ts`；检查图形对象 ID 与求解输入可互相定位。

## T12 CTMC 科学求解插件

**文件：** `solvers/ctmc/pyproject.toml`、`solvers/ctmc/src/sysrel_ctmc/{__init__,__main__,solver}.py`、`solvers/ctmc/tests/test_solver.py`、`packages/solvers/src/ctmc-process.ts`。

- [ ] 建立 Python 包及 test 可选依赖 pytest；输入包含 Q、初始概率 p0、时间点、状态奖励和指标定义，输出状态概率、奖励值、数值诊断与输入摘要。Node 通过参数数组启动进程，不拼接用户 shell 命令。
- [ ] 校验 Q 行和为零、非对角项非负、p0 非负且和为 1；非指数分布请求返回不适用并建议离散事件模型。初始状态上限 5000，稀疏非零元上限 200000，超限提示改粒度或方法。
- [ ] 使用 `scipy.sparse.linalg.expm_multiply(Q.T * t, p0)` 计算瞬态；稳态解 `Q.T*pi=0` 加归一条件，并检查唯一性。多个闭合类时拒绝输出不依赖初始条件的唯一稳态。
- [ ] 用两态系统进行独立解析测试：λ=0.01/h、μ=1/h、初始 up，稳态 up=1/1.01，瞬态 `P_up(t)=μ/(λ+μ)+λ/(λ+μ)*exp(-(λ+μ)*t)`。

```python
def test_two_state_availability():
    import math
    from sysrel_ctmc.solver import solve
    result = solve(q=[[-0.01, 0.01], [1.0, -1.0]], p0=[1.0, 0.0], times=[2.0])
    expected = 1 / 1.01 + 0.01 / 1.01 * math.exp(-1.01 * 2.0)
    assert abs(result["transient"][0][0] - expected) < 1e-10
    assert abs(result["stationary"][0] - 1 / 1.01) < 1e-10
```

- [ ] 实现上述 `solve` 和 JSON stdin/stdout 包装，stderr 仅输出诊断；运行 `uv run --project solvers/ctmc --extra test pytest`。增加负概率、无效 Q、非唯一稳态三个错误测试。

## T13 产品目标反推与联合参数搜索

**文件：** `packages/analysis/src/{feasibility,budget-map,candidate-generator,search,pareto}.ts`、`packages/analysis/test/search.test.ts`、`scenarios/training/design-space.example.json`。

- [ ] 输入产品目标、可调整参数、离散机制组合、参数边界、锁定项和资源/成本约束；先计算已知无故障上界，再生成候选。
- [ ] 把 1-A 的损失预算映射到对象、模式与机制要求；每个要求记录推导方法和回算结果。多个机制影响同一损失时使用同一场景联合求解，不把单项收益相加。
- [ ] 首版使用可复现有限网格/枚举搜索，记录搜索范围、候选数、评估样本、seed 和预算；随后可增加优化器，但不能将有限搜索结果标为全局最优。
- [ ] 参数含不超过 12 个候选机制时仍须检查前置依赖/互斥，设置最多 4096 个合法机制集合；连续网格与集合乘积超过运行预算时返回分批/缩小范围建议。筛选与正式候选验证使用不同种子集。
- [ ] 核心测试：计算300秒、阻塞保存4秒且无法调整时，理想上界约0.986842，小于0.99，返回 `infeasible_under_model`；只有降低故障率不能解决。若允许保存开销改变，求解器可进入搜索，不直接宣称达标。
- [ ] 另一测试在全部候选未达标且没有上界证明时返回 `no_candidate_found`，附最大已评估值与搜索范围。成本缺失时返回可靠性/资源权衡，不报告“最低成本”。
- [ ] 运行 `pnpm exec vitest run packages/analysis/test/search.test.ts`，核对每个推荐均有已完成独立验证 run 引用。

## T14 收益归因与敏感性

**文件：** `packages/analysis/src/{shapley,sensitivity,comparison}.ts`、`packages/analysis/test/attribution.test.ts`、`docs/methods/attribution.md`。

- [ ] 输出单项收益、最后加入收益、Shapley 贡献和交互，不混用。前置依赖不成立的组合先分组为可实现策略；不能给无效子集编造收益后计算普通 Shapley。
- [ ] 8 个方向采用完整 256 子集枚举，复核专家实现；方向增多时提供排列采样及单独归因采样误差，明确计算规模。
- [ ] 测试合作游戏：v(∅)=0、v(A)=1、v(B)=2、v(AB)=5，φA=2、φB=3；含负收益的机制不得裁剪为0。
- [ ] 敏感性先支持单参数区间扫描和成对交互扫描；固定证据范围并给出排序变化。没有数据支持的范围标为假设，不把采样误差当参数不确定性。
- [ ] 运行 `pnpm exec vitest run packages/analysis/test/attribution.test.ts`；组合贡献之和与总提升误差≤1e-10，跨指标或终态规则的实验不能直接做机制归因。

## T15 统计、达标结论与不确定性传播

**文件：** `packages/analysis/src/{statistics,uncertainty,decision,parameter-estimation}.ts`、`packages/analysis/test/statistics.test.ts`、`packages/analysis/test/parameter-estimation.test.ts`、`docs/methods/uncertainty.md`。

- [ ] 记录固定样本量、随机数算法与种子策略。首版分位数使用线性插值 type 7，均值使用样本标准误和95% Student-t近似区间（明确近似性质），单次达标比例使用95% Wilson区间。只有一个样本时均值区间标记不可估计；常量样本的经验标准误为0，但不能据此证明罕见故障不存在。
- [ ] 增加有界[0,1]指标的可选保守 Hoeffding 均值界：半宽 `sqrt(log(2/alpha)/(2*n))`，裁剪到合法范围；它与经验t区间分别命名。对极端偏斜、全零或全一结果同时显示稀有事件证据限制，不能用零样本方差证明精确值。
- [ ] 均值评估提供点估计达标状态和数值证据状态：区间跨目标时显示估计达标/不达标及判定尚不稳定，不自行改变用户的均值目标为概率目标。
- [ ] 参数不确定性用外层参数抽样、内层过程仿真；相关参数须共享抽样或显式相关模型。不具备输入分布时只做区间敏感性，不输出伪造的概率可信区间。
- [ ] 实现最小台账估计：按根因去重和适用条件分层，恒定事件率模型下 `lambda=k/暴露量`；硬件FIT=`lambda*1e9`。零事件必须保留暴露量及单侧95%上界 `-ln(0.05)/暴露量`，不作为无故障证据。按调用/任务失败用二项分母估计并报告区间；缺失时间戳、右删失恢复样本单列，首版不擅自填补或混入完整时延样本。
- [ ] 确定性统计样例 `[0,0.5,1]`：均值0.5，阈值0.5达标比例2/3；常量样例均值区间宽度为0；空样本报错。用独立科学库/手算样例核对区间和分位数实现。
- [ ] 使用产品目标万卡0.99、十万卡0.943验证目标匹配：同规模不同代际读取同一目标，但输入基线和理想吞吐各自记录。
- [ ] 运行 `pnpm exec vitest run packages/analysis/test/statistics.test.ts packages/analysis/test/parameter-estimation.test.ts`；额外验证两次根因事件/1e6设备小时给出2000 FIT、零事件/1e6设备小时的单侧95%上界约2995.732 FIT。报告明确区分所有不确定性来源与估计假设。

## T16 方法/粒度推荐与非训练验证

**文件：** `packages/domain/src/{method-registry,recommendation,granularity}.ts`、`scenarios/traditional-repairable/{manifest,scenario}.json`、`tests/integration/non-training.test.ts`、`docs/methods/capabilities.md`。

- [ ] 每个方法声明 supportedMetrics、requiredInputs、assumptions、limits、verificationRefs；仅通过案例验证的方法标记 ready，其他状态可见但不可假装返回结果。
- [ ] 推荐规则：静态结构优先RBD/FTA/BDD；指数状态恢复可选CTMC；进度回退、污染和非指数时间优先DES。所有推荐附可解释条件，用户可以改选适用方法。
- [ ] 粒度从系统/子系统开始，以参数敏感性、结构不确定性和方案排序是否变化决定细化建议；不同粒度独立版本，不能静默换模型。
- [ ] 非训练案例采用两个独立串联可修复模块：每个 λ=0.01/h、μ=1/h。独立两态可用度组合为 `(1/1.01)^2`，与四状态CTMC稳态结果一致；指标为运行可用度，不出现训练检查点或正确交付字段的硬性要求。
- [ ] 运行 `pnpm exec vitest run tests/integration/non-training.test.ts` 与 CTMC pytest；更换场景包即可使用同一任务、参数、分配、报告流程，不改前端核心代码。

## 本子计划退出条件

- [ ] 指定专家版本能复现，严格交付指标与其他指标未混用。
- [ ] 四类分配策略、模型搜索、回算与差距解释可独立调用。
- [ ] RBD/FTA/BDD/CTMC 和训练DES具备有界、可验证能力。
- [ ] 参数/过程/采样不确定性分开，归因与预算分开。
- [ ] 非训练案例复用公共契约成功，未宣称未经实测证明的预测准确度。
