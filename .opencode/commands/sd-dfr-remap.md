---
description: 读取当前任务，完成现状评估、AGREE改进分配、独立复评与报告比较
---
使用 skill 工具加载 sd-dfr-remap。先读取 task_current、design_get、workflow_state，必要时 run_list / run_status 查找已有结果。按本次明确需求执行，不重复询问方式或重启流程；仅意图缺失时用原生 question 简短澄清。明确全自动只运行第一轮至报告待审核；交互保留六阶段人工确认。默认先评估原六项现状（静默检出95%），再按用户请求 audit_plan 生成基于第一轮Shapley的AGREE分配；生成建议不自动执行第二轮。用户明确要求后 audit_evaluate 单独复评，手动仅改99.5%时保留其他第一轮参数。audit_compare 比较同一第一轮下多次已完成结果，report_export 分别导出。说明各规模目标、实际区间、参数来源和待验证条件。只使用当前任务绑定MCP，不伪造人工确认、不覆盖历史证据。
用户当前需求：$ARGUMENTS
