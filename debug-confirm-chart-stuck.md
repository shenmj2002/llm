# Debug Session: confirm-chart-stuck [OPEN]

## 症状
- 用户点击“确认并生成折线图”后，界面表现为卡住或按钮点不动。
- 当前截图中可见页面停留在“内容生成中...”和 `generate_data_table_draft` 执行中状态。

## 初步假设
- 假设 1：并不是“确认出图”按钮失效，而是当前消息还停留在表格草稿生成阶段，前端 `loading` 没有结束。
- 假设 2：服务端 `/api/agent` 在表格草稿生成后没有正确发送 `tool_done / awaiting_confirmation / done`，导致前端一直认为正在生成。
- 假设 3：前端收到了表格草稿相关事件，但没有把 `pendingTableDraft` 和 `awaitingUserConfirmation` 正确挂到最后一条助手消息。
- 假设 4：最近新增的本地 `table-to-paper-plot` 服务改动间接影响了原有表格草稿链路，使消息状态机异常。
- 假设 5：用户实际点击的是一个仍处于禁用状态的按钮，根因仍是上一轮流式响应未结束，而不是确认接口本身故障。

## 证据计划
- 读取现有调试日志，确认这次请求是否真正走到了确认出图阶段。
- 检查 `/api/agent` 是否发送了 `tool_done / awaiting_confirmation / done`。
- 检查前端 SSE 消费是否收到 `awaiting_confirmation`，以及 `isLoading` 是否被复位。

## 当前状态
- 待读取运行时证据。
