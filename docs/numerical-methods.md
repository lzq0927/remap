# 数值模块说明与复现

## 月度训练：固定专家 V4 口径

来源为 [zy009197/ai-cluster-reliability](https://github.com/zy009197/ai-cluster-reliability/tree/683afe829313bfdcb249bc593e48df5b29813666)，固定提交 `683afe829313bfdcb249bc593e48df5b29813666`。验收入口为仓库根目录 `正确有效产出改进分析.html` 的 `precomputed` 数据，模型版本 `4.0-domain-ledger`。

交付指标为 `delivery = delivered / T`，其中 `delivered = epoch ? 0 : correct`。结束时仍存在未解决污染，污染前的正确工作也全部计入 `terminalDiscard`，交付为零。`effective` 是不同指标，不能代替交付。`catalogs/review-2026-10-09` 保留干净检查点的口径不适用于本次验收。

基线计算周期为 7200 秒、保存阻塞 10 秒。完整输入分别保存在 `references/expert-v4/config.json` 和 `baseline.json`，直接从 HTML 提取。`manifest.json` 记录固定提交和 SHA256；运行使用两个字节不变的 CommonJS 源码副本，文件名改变但源文件内容不变。

固定提交中的独立 `正确有效产出改进分析数据.json` 与 HTML 内嵌数据不同：1000 卡基线均值分别为 0.9793583278785303 与 **0.984938646066475**。回归测试明确使用 HTML 内嵌数据作为基准；独立 JSON 仅保留为来源证据。

适配器按 `(seed + imul(trial+1,2654435761) + cards) uint32` 生成轨迹种子。测试逐条核对原引擎和适配器在 1000、10000、500000 卡，以及基线、单项改进、全项改进下的交付值，并复现 1000 卡 2048 次的 HTML 基线均值与交付账本。

所有损失项和交付按等效训练小时记账，账本残差必须接近零。预期故障事件总量限制为五百万；单次请求限制 8192 条轨迹、8760 小时、一百万卡。示例轨迹保留最多 2000 条记录，高故障率下使用同一随机种子的有限前缀，输出 `traceHours` 和 `traceTruncated`。固定原引擎没有实际使用 `retentionHours`，适配器因此仅接受 `null`，非空值明确拒绝，避免将未生效的参数作为有效配置。模型及配置键使用自有属性白名单检查，继承属性名也不能绕过未知键校验。

## 统计与分析

分位数采用 type-7 线性插值。均值区间是固定样本 Student-t 95% 区间：自由度不超过 10 使用表值，其余使用渐近分位数展开。它是近似区间，不是序贯停止规则。目标达成比例按每条轨迹是否达到目标计算，比例区间采用 Wilson 95% 区间。

这些区间只反映蒙特卡洛抽样误差。FIT、恢复成功率、检测延迟、拓扑和模型假设的不确定性需另行提供参数分布、场景范围或现场证据，不能被蒙特卡洛区间覆盖。

比较和敏感性分析使用配对种子，直接对每条轨迹的差值计算区间。参数变化可以改变事件序列对齐，因此配对种子不意味着相同的现实故障。比较、搜索和 Shapley 在执行任何轨迹前汇总预期事件量，累计上限为两千万；每个训练子请求仍受五百万事件和原有时间、卡数、轨迹数约束。搜索预算包括候选筛选和最昂贵候选的验证开销。

Shapley 枚举全部可计算的组合，保留负贡献，并检查贡献之和等于组合总收益。最多八项训练干预，组合轨迹总量最多 131072。组合无效时显式失败；不会将无效组合当作零收益。损失账本是会计分解，Shapley 是指定模型内的干预比较，两者含义不同。

Poisson 故障率估计为 `事件数 / 暴露小时`，FIT 为每十亿小时故障数。零事件给出精确单侧上界 `-ln(1-confidence)/exposure`：零事件、一百万小时、95% 单侧上界为 2995.73227355 FIT；两事件、一百万小时的点估计为 2000 FIT。目前非零事件的精确 Garwood 区间未实现，输出明确说明该限制。

## 有限设计搜索与证书

搜索只枚举用户给定的有限集合，最多八个维度、1024 个候选。筛选与验证的实际 `trialSeed` 集合必须无交集，仅检查两次请求的起始种子不同并不足够。默认验证起始种子为 `(base.seed + imul(base.trials,2654435761)) uint32`，使用选择种子序列之后的样本；用户显式种子若发生集合重叠则拒绝。验证按均值区间下限是否达到目标判定。`no_candidate_found` 表示本次采样没有找到候选，不能作为不可行证明。

周期性保存的连续运行占空比为 `compute / (compute + save)`。300 秒计算、4 秒保存对应 98.6842105263%。有限任务窗口另按完整周期和最后不完整周期计算无故障上界，`upperBound` 与 `finiteHorizonUpperBound` 返回该有限窗口上界；`checkpointDutyCycle` 单独返回连续运行占空比。例如仅运行一秒、300/4 策略时，有限窗口上界是 1，而非 0.986842。只有全部候选关闭即时静默 step 恢复（`silentDetect=0`），或没有静默故障（`silentPct=0`），或单卡等效 FIT 总和为零时，才能使用干净检查点回退的上界证书：这种回退不能保留未提交计算并跳过保存。默认专家基线满足该条件；300/4、99% 目标可输出 `proven_infeasible`。

即时 step 恢复可能保留部分计算并重置保存阶段，连续占空比此时不是通用上界。原引擎实测例：1000 卡、20 次静默故障/小时、100% 即时检出、零检测及恢复准备延迟、300/4 周期、720 小时、100 条轨迹，均值约 99.2153%，超过 98.6842%。因此这类候选只输出条件性占空比参考，禁止给出该不可行证书。相关反例已加入回归测试。

## 静态模型、分配与可修复系统

RBD、FTA、BDD 共用精确的约简有序二叉决策图，避免将重复基本事件误当作独立副本。串联、并联、k-out-of-n、AND、OR 均可计算。不同事件仍假设独立；输入相关性时显式拒绝，要求联合概率模型。事件最多 64 个、树节点最多 2000 个、深度最多 100、BDD 节点最多十万个。

任务可靠度分配采用指数任务模型。等分方法按总故障率预算等分，ARINC 按基线故障率归一化，零总基线时拒绝；两者使用统一任务时长，单项 `operatingHours` 若不同于请求 `hours` 则拒绝。AGREE 明确版本为 `agree.nasa2016-rate`，公式为 `lambda_i = n_i*(-ln R)/(N*E_i*t_i)`，其中 `N=sum n_i`，每个模块使用自己的重要度与任务运行时间；`E_i=0` 或 `t_i=0` 拒绝。保留旧 `agree` 方法名作为兼容别名，输出仍明确版本和近似解释。非单位重要度会改变简单故障率预算的解释，不能将其结果直接当作普通独立串联预算。

可用度分配版本为 `availability.log-budget.v1`。无约束时按权重分配 `A_i=A_target^w_i`；支持数值 `locked` 和 `bounds:{min,max}`，先从 `-ln(A_target)` 扣除锁定模块的 `-ln(A_i)`，再对自由模块执行有界加权对数预算分配。锁定值越界、总目标不可行等冲突显式报错。equal、ARINC、AGREE 暂不支持约束，收到约束时明确拒绝，不能静默忽略。availability 只接受 `steady-state-availability` 指标，其余分配方法只接受 `task-reliability`；缺省时自动选择对应指标，未知或不匹配的显式指标拒绝。这些方法不适用于训练正确交付。availability 的当前值只来自显式 `items[].baselineAvailability`（有限数值，范围含端点 `[0,1]`），差距为分配目标减当前可用度；缺少该字段时 `current` 和 `gap` 均为 `null`，仅有 `baselineRate` 不能推得稳态可用度。任务可靠度分配的当前值仍按 `exp(-baselineRate*operatingHours)` 计算（运行时长缺省使用请求 `hours`），不会改用可用度基线。

传统示例为两模块可修复串联系统，模块故障率 0.01/小时、修复率 1/小时。稳态可用度为 `(1/1.01)^2 = 0.9802960494069208`；10 小时无中断任务可靠度为 `exp(-0.2) = 0.8187307530779818`。示例输入在 `scenarios/traditional-repairable/two-module-series.json`。

## CTMC 插件

Python/SciPy 按行生成矩阵约定计算 `p(t)=p0 exp(Q t)`，校验非负非对角率、零行和、初始分布、时间和奖励向量。仅支持指数停留时间：`distribution` 可省略或为 `exponential`，其他分布拒绝。请求只允许 `Q`、`p0`、`times`、`rewards`、`distribution` 五个键；Node 入口和 Python CLI 都拒绝未知键。通过矩阵指数计算瞬态概率，通过增广矩阵指数计算从零到最后请求时刻的累计奖励。稳态唯一性通过正转移率图的强通信类及闭合类数量判断，要求且只允许一个闭合通信类；不会使用浮点矩阵秩阈值将 `1e-18` 等微小正转移率误判为零。稳态解在唯一闭合类内计算，暂态类的稳态质量为零。最多 128 个状态、1000 个时间点、30 秒运行时间。

随附 Python 本次未预装 SciPy，因此将 SciPy 1.17.1、NumPy 2.5.3 和 pytest 9.0.2 安装到工作区内被忽略的 `solvers/ctmc/.python-deps`，未改系统包。插件将该目录加入子进程 `PYTHONPATH`；其他机器通过 `RELIABILITY_PYTHON` 指定 Python，并使用 `requirements.txt` 安装本地依赖。完整约定见 `solvers/ctmc/README.md`。

## 已执行的复现命令

在仓库根目录运行：

```powershell
node node_modules/vitest/vitest.mjs run packages/solvers/tests packages/allocation/tests packages/analysis/tests tests/expert
node node_modules/eslint/bin/eslint.js packages/solvers/src/*.ts packages/solvers/tests packages/analysis packages/allocation tests/expert
$env:PYTHONPATH=(Resolve-Path solvers/ctmc/.python-deps).Path
python -m pytest solvers/ctmc/test_solver.py -q
```

实测结果：33 个 Vitest 测试通过，5 个 Python 测试通过，作者维护的数值源码和测试 ESLint 检查通过，项目 `tsc --noEmit` 通过。原始第三方源码应排除在风格检查之外，以保留字节一致的来源证据。界面与集成测试由主任务统一执行。
