---
description: 加载统一可靠性建模、指标分解、机制权衡与验证流程
---
使用 skill 工具加载 sd-dfr-remap。先调用 task_current、design_get、workflow_state 核对当前任务和版本，沿六阶段推进到用户确认点。只使用当前目录绑定的可靠性 MCP；无绑定时返回工作台创建任务主会话。中间产物通过 workflow_save 保存并在工作台显示。
用户当前需求：$ARGUMENTS
