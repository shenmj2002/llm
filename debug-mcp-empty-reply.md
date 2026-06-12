# Debug Session: mcp-empty-reply [OPEN]

## 症状
- 开启 MCP 后，普通对话正常。
- 输入原始观测数据时，界面一直显示生成中，最后回复区域为空白。

## 复现条件
- 开启 Agent / MCP 模式。
- 输入按日期分组、包含百分比材料与数值的原始数据。

## 初始假设
- 假设 1：服务端命中了“自动生成表格草稿”的兜底分支，但 SSE 没有正确结束，导致前端一直 loading。
- 假设 2：服务端已返回 `tool_done` 和 `awaiting_confirmation`，但前端 `handleAgentStream()` 没有正确消费对应事件，导致消息内容和卡片都没挂上。
- 假设 3：`generate_data_table_draft` 实际报错或卡住，后端没有把错误通过前端可见方式呈现出来。
- 假设 4：模型返回了工具调用，但 `finalMessages` / `tool_call_id` 处理方式导致流式阶段进入异常分支，最终出现空白消息。
- 假设 5：当前数据被识别为观测数据后触发了服务端 fallback，但 fallback 返回的结构化结果没有被前端渲染。

## 证据计划
- 在 `/api/agent` 中记录：是否识别为观测数据、是否进入 tool_calls、是否进入 fallback、是否发送 `tool_done` / `awaiting_confirmation` / `done`。
- 在前端 Agent SSE 消费逻辑中记录：是否收到 `tool_done_structured`、`awaiting_confirmation`、`done`。
- 在 MCP 工具中记录：原始文本是否成功解析、生成了多少行数据。

## 当前状态
- 已完成证据收集与最小修复，等待用户验证。

## 证据结论
- 修复前证据：
  - 仅记录到 `Agent request received`，且 `hasObservationDataset = true`。
  - 没有出现 `first-choice`、`tool-call`、`fallback-draft` 等后续日志。
  - 前端最终收到 `error: fetch failed`，并且 `contentLength = 0`。
  - 说明请求卡在首轮 `LLM + tools` 阶段，前端并没有拿到表格草稿。
- 修复后证据：
  - 直接命中 `dataset-shortcut`。
  - MCP 成功解析原始数据，`rowCount = 7`。
  - 服务端成功发出 `dataset-shortcut-done`，并带有 `sessionToken`。
  - 命令行复现已经能立即拿到 `tool_start -> tool_done -> awaiting_confirmation`。

## 确认/排除的假设
- 假设 1：部分成立。不是 SSE 末尾没结束，而是请求在更前面的首轮模型调用阶段卡住，导致前端长时间等待。
- 假设 2：排除。修复前前端没有收到 `tool_done_structured` / `awaiting_confirmation`，不是消费逻辑丢事件。
- 假设 3：排除。MCP 工具本身能成功解析该数据。
- 假设 4：排除。不是 tool_call / fallback 冲突，而是进入工具前的模型首轮请求卡住。
- 假设 5：排除。修复前不存在“已返回但没渲染”的情况。

## 修复方案
- 对已明确识别为“原始观测数据”的消息，不再先走首轮 `LLM + tools` 判断。
- 服务端直接调用 `generate_data_table_draft`，然后返回表格草稿与确认状态。
- 普通对话和其他非观测数据消息链路保持不变。
