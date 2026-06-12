# 数据生成表格与折线图 MCP 工具实施计划

## Summary
- 目标是在现有 Agent / MCP 体系中新增一个“数据生成表格与图像”工具链路。
- 本期范围聚焦流程骨架：`生成表格 -> 用户确认 -> 生成折线图`。
- 表格业务逻辑暂不定稿，只定义可扩展的数据协议、状态流转和前端交互槽位。
- 折线图生成不在本地代码内完成，明确直接依赖用户后续提供的 Skill。
- 用户可编辑表格本期不实现，但在数据结构、事件接口和 UI 状态上预留扩展点。

## Current State Analysis

### 现有 MCP / Agent 后端
- `server/mcp-server.js`
  - 当前只注册了 `get_current_time` 一个 MCP 工具。
  - 说明 MCP 侧新增工具的接入点已经非常明确，改动范围可控。
- `server/index.js`
  - `/api/agent` 路由负责两阶段 Agent 调用：
    - 第一次请求模型，让模型决定是否调用工具。
    - 执行 MCP 工具后，将 tool message 拼回消息历史。
    - 第二次流式请求模型，产出最终回答。
  - 当前工具结果只按纯文本 `toolResultText` 回传，不支持结构化表格状态或“等待用户确认”的中断式工作流。

### 现有前端消息与工具展示
- `src/components/ChatMessage.vue`
  - 已有 `agentToolCalls` 的展示面板，可显示工具名、参数和文本结果。
  - 当前没有表格确认按钮、也没有“工具返回结构化 UI 卡片”的展示能力。
- `src/stores/chat.ts`
  - 已支持记录 `tool_start` / `tool_done`。
  - 当前 `AgentToolCallRecord.result` 为字符串，不适合承载结构化表格、确认状态、下载链接等数据。
- `src/views/Layout.vue`
  - 负责发送消息、消费 Agent SSE、更新最后一条 assistant 消息。
  - 当前流程是“一次用户发言 -> 一次助手完整回复”，没有“用户先确认表格，再继续生成图”的半流程状态管理。

### 现有表格 / 图像能力
- `src/markdown/components/Table.vue`
  - 已支持 Markdown 表格展示，可作为兜底展示方式。
  - 但不支持确认按钮、可编辑表格、下载文件等专用交互。
- `package.json`
  - 当前没有图表库、制图库、CSV/XLSX 处理库。
  - 这与当前决策一致：本期折线图不本地生成，而是走外部 Skill。

## Assumptions & Decisions
- 工具形态：作为 **MCP 工具** 接入 Agent 模式，不做普通聊天链路版本。
- 本期范围：先实现流程骨架，不落具体复杂表格业务规则。
- 确认方式：用户通过 **按钮确认** 表格无误后，再触发折线图生成。
- 图像呈现：折线图生成后同时支持：
  - 在聊天消息中展示图片；
  - 提供可下载资源。
- 表格编辑：本期不实现编辑器，仅预留后续接口和状态扩展位。
- Skill 方案：
  - 表格生成不依赖 Skill；
  - 折线图生成 **直接依赖用户后续提供的 Skill**。
- 本期默认用户提供的 Skill 能接受“表格数据 + 图片偏好/素材提示”，并返回可展示图片及可下载结果。

## Proposed Changes

### 1. 在 MCP Server 增加“表格草稿生成”工具
- 文件：`server/mcp-server.js`
- 改动：
  - 新增 MCP 工具，例如 `generate_data_table_draft`。
  - 工具职责仅限：
    - 接收用户需求文本；
    - 产出结构化表格草稿；
    - 返回表格元数据与状态，不生成图。
- 返回协议建议：
  - `status`: `draft_ready`
  - `title`: 表格标题
  - `columns`: 列定义数组
  - `rows`: 行数据数组
  - `editable`: `false`
  - `canConfirm`: `true`
  - `chartPending`: `true`
  - `sessionToken`: 本次表格草稿标识，后续确认与出图使用
- 为什么：
  - 把“表格生成”和“图像生成”拆成两个阶段，天然支持用户确认。
  - 即使后续表格逻辑变复杂，结构化协议依然稳定。

### 2. 在 Agent SSE 中支持结构化工具结果，而不只是文本
- 文件：`server/index.js`
- 改动：
  - 扩展 `/api/agent` 中 `tool_done` 的返回载荷。
  - 当前 `tool_done` 只发送 `{ name, result: string }`；需改成支持结构化 JSON。
  - 对 `callMcpTool()` 返回结果增加解析层：
    - 若返回纯文本，则沿用现有逻辑；
    - 若返回表格草稿结构，则通过 SSE 发给前端。
- 同时补充一个“等待用户确认”的中断协议：
  - 当工具返回 `draft_ready` 时，Agent 不应立刻继续生成最终自然语言结论。
  - 需要让当前 assistant 消息停留在“表格已生成，等待确认”状态。
- 为什么：
  - 现有两段式 Agent 流程是线性自动完成的，不支持 human-in-the-loop。
  - 本需求的核心就是在工具和最终图表之间插入人工确认。

### 3. 为“等待确认”增加专用后端接口
- 文件：`server/index.js`
- 改动：
  - 新增一个确认接口，例如 `POST /api/agent/table-chart/confirm`。
  - 入参建议：
    - `conversationId`
    - `messageId`
    - `sessionToken`
    - `tablePayload`
    - `chartPrompt` 或 `chartStyleRequest`
  - 职责：
    - 校验当前表格草稿状态；
    - 调用用户后续提供的折线图 Skill；
    - 返回图片展示地址、下载地址、补充说明。
- 为什么：
  - “确认后再继续”不适合继续塞回一次旧的 SSE 流里。
  - 单独确认接口更容易做状态校验、重试、失败提示、后续编辑扩展。

### 4. 设计折线图 Skill 适配层
- 文件：`server/` 下新增适配模块，例如 `server/chartSkillAdapter.js`
- 改动：
  - 封装调用外部 Skill 的单一入口。
  - 输入：
    - 表格列与行
    - X/Y 映射信息
    - 用户传入的图片偏好/图片提示
    - 可选标题、副标题、单位等
  - 输出：
    - `imageUrl`
    - `downloadUrl`
    - `mimeType`
    - `width/height`（可选）
    - `summary`（可选）
  - 错误处理：
    - Skill 不可用
    - Skill 返回结果不完整
    - 图片地址失效
- 为什么：
  - 用户明确要求折线图直接依赖 Skill。
  - 通过适配层隔离 Skill 的未来接口变化，减少前后端耦合。

### 5. 扩展前端消息模型，支持结构化表格卡片
- 文件：`src/stores/chat.ts`
- 改动：
  - 为 assistant 消息增加结构化工具产物字段，例如：
    - `pendingTableDraft`
    - `pendingChartTask`
    - `chartResult`
  - 扩展 `AgentToolCallRecord`，使 `result` 支持字符串之外的结构化结果。
  - 补充确认状态字段，例如：
    - `awaitingUserConfirmation`
    - `confirmationSessionToken`
- 为什么：
  - 当前消息模型只能承接文本与简单工具轨迹，无法表达“卡片+按钮+后续产物”。

### 6. 在消息区增加“表格草稿确认卡片”
- 文件：`src/components/ChatMessage.vue`
- 改动：
  - 当 assistant 消息包含 `pendingTableDraft` 时，渲染独立卡片，而不是只放在 `tool_done` 文本里。
  - 卡片内容建议包括：
    - 表格标题
    - 规范化表格预览
    - 状态标签：待确认
    - 操作按钮：`确认并生成折线图`
    - 预留按钮位：`编辑表格（暂未开放）`
  - 图片生成成功后，同一卡片区域或紧随其后展示：
    - 折线图图片
    - 下载按钮
- 为什么：
  - 现有 `agent-tool-panel` 偏调试风格，不适合承接正式用户交互。
  - 表格确认卡片是本需求的核心 UX。

### 7. 在前端增加确认动作的数据流
- 文件：`src/views/Layout.vue`
- 改动：
  - 新增确认表格的方法，例如 `handleConfirmTableDraft(...)`。
  - 触发 `POST /api/agent/table-chart/confirm`。
  - 在确认期间更新消息状态：
    - 按钮 loading
    - 禁止重复点击
    - 失败重试提示
  - 确认成功后更新当前 assistant 消息：
    - 清除待确认状态
    - 挂载 `chartResult`
    - 如需要，再补充一段自然语言说明
- 为什么：
  - 当前 `Layout.vue` 已是消息发送和响应编排中心，适合承接此交互。

### 8. 规范前端表格展示协议，为未来编辑预留扩展
- 文件：
  - `src/components/ChatMessage.vue`
  - 可新增类型文件，例如 `src/types/tableDraft.ts`
- 改动：
  - 定义前端使用的表格协议：
    - `columns[]`
    - `rows[]`
    - `cellMeta`
    - `validation`
    - `editable`
  - 本期只渲染只读表格，但在协议中保留：
    - 单元格唯一 key
    - 单元格校验信息
    - patch/update 事件接口占位
- 为什么：
  - 用户已提出后续可能支持修改表格。
  - 本期若不先规范协议，后续扩展会破坏消息结构。

### 9. 调整工具展示策略，区分“调试轨迹”和“正式产物”
- 文件：
  - `src/components/ChatMessage.vue`
  - `src/utils/messageHandle.ts`
- 改动：
  - 保留 `agent-tool-panel` 作为调试轨迹，但弱化其对正式产物的承载。
  - 对表格草稿工具结果增加专门识别分支：
    - 工具轨迹里只显示“已生成表格草稿”
    - 正式内容区展示表格卡片和确认按钮
- 为什么：
  - 避免用户看到一堆 JSON / 调试文本，降低产品感。

### 10. 为“论文格式表格”保留后续升级位
- 文件：
  - 本期主要体现在类型、注释与适配接口设计中
- 改动：
  - 计划中明确：后续如果用户自建 Skill 或额外模板系统成熟，可以将表格生成切换为：
    - 本地规则生成
    - Skill 辅助格式化
    - 二者混合
  - 但本期不将表格生成绑定到 Skill。
- 为什么：
  - 当前用户只明确折线图必须走 Skill；表格逻辑还未确定。
  - 这样既不阻塞本期，也给后续论文风格升级留出了清晰演进路径。

## Data Flow
1. 用户在 Agent 模式下提出“生成某数据表格/趋势图”的请求。
2. LLM 决定调用 `generate_data_table_draft` MCP 工具。
3. MCP 工具返回结构化表格草稿。
4. 服务端通过 `tool_done` SSE 将结构化草稿发给前端，并将当前 assistant 消息置为“等待确认”。
5. 前端在消息区展示表格卡片和“确认并生成折线图”按钮。
6. 用户点击确认按钮。
7. 前端调用 `POST /api/agent/table-chart/confirm`。
8. 服务端读取表格草稿，并调用外部折线图 Skill。
9. Skill 返回图片资源。
10. 前端将折线图嵌入聊天消息，并提供下载入口。

## Edge Cases & Failure Modes
- MCP 工具返回表格为空：
  - 前端显示“未生成有效表格”，不出现确认按钮。
- 用户重复点击确认：
  - 按钮进入 loading 并禁用；服务端幂等校验 `sessionToken`。
- Skill 调用失败：
  - 保留已确认表格；
  - 在卡片内展示错误提示与重试按钮。
- Skill 返回无展示链接但有文件：
  - 仅显示下载按钮。
- Skill 返回图片但链接过期：
  - 前端展示加载失败状态；
  - 提供重新生成入口。
- 表格未来支持编辑时：
  - 需保证确认接口总是以“最新表格草稿快照”为准，而不是旧缓存。

## Verification Steps
- 静态验证
  - 确认 `server/mcp-server.js` 新工具注册成功。
  - 确认 `/api/agent` 能区分纯文本工具结果与结构化工具结果。
  - 确认前端消息模型可承载待确认表格与图表结果。
- 交互验证
  - Agent 请求后成功展示表格草稿卡片。
  - 点击“确认并生成折线图”后进入 loading 状态。
  - Skill 成功时，聊天区展示图像并可下载。
  - Skill 失败时，错误可见且可重试。
- 兼容验证
  - 现有 `get_current_time` 工具不受影响。
  - 普通非 Agent 聊天链路不受影响。
  - 现有 RAG 与消息流式展示不受影响。

## Out of Scope
- 复杂表格业务逻辑本身
- 完整表格编辑器
- 本地图表绘制能力
- 表格论文格式 Skill 的正式接入实现

