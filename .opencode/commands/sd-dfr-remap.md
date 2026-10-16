---
description: 读取当前任务，完成现状评估、AGREE改进分配、独立复评与报告比较
---
使用 skill 工具加载 sd-dfr-remap。先读取 task_current、design_get、workflow_state，必要时 run_list / run_status 查找已有结果。按本次明确需求执行，不重复询问方式或重启流程；仅意图缺失时用原生 question 简短澄清。明确全自动只运行第一轮至报告待审核；交互保留六阶段人工确认。先按已保存的架构、故障唯一归属、分层目标参照、实际措施与证据评估现状，解释各规模薄弱点、MTBF、恢复与损失；再按用户请求 audit_plan 生成基于第一轮Shapley的AGREE分配；生成建议不自动执行第二轮。用户明确要求后 audit_evaluate 单独复评，手动参数试验只携带用户明确的改动，保留其他现状参数。audit_compare 比较同一第一轮下多次已完成结果，report_export 分别导出。说明各规模目标、实际区间、参数来源和待验证条件。只使用当前任务绑定MCP，不伪造人工确认、不覆盖历史证据。
用户当前需求：$ARGUMENTS
