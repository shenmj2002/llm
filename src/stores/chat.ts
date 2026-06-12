import { ref, computed } from 'vue'
import { defineStore } from 'pinia'//定义一个store
import type { ChartResult, PendingTableDraft } from '@/types/tableDraft'


// RAG 引用（结构化 citations；兼容旧消息的 docName + text）
export interface RagCitationLocation {
    type: string;
    label?: string;
}

export interface RagSource {
    citationId?: number;
    docId?: string;
    docTitle?: string;
    chunkId?: string;
    location?: RagCitationLocation;
    snippet?: string;
    docName?: string;
    text?: string;
}

/** Agent / MCP：一次工具调用在 UI 中的一条轨迹（服务端按顺序 start → done） */
export interface AgentToolCallRecord {
    id: string;
    name: string;
    status: 'running' | 'done';
    args?: Record<string, unknown>;
    result?: string;
}

// 定义消息类型
interface Message {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    reasoning_content: string;
    files: File[];
    completion_tokens?: string;
    speed: string;
    loading?: boolean;        // 流式输出中为 true，结束后置 false
    ragSources?: RagSource[]; // RAG 检索到的引用来源
    agentToolCalls?: AgentToolCallRecord[];
    pendingTableDraft?: PendingTableDraft;
    chartResult?: ChartResult;
    awaitingUserConfirmation?: boolean;
    chartConfirming?: boolean;
    chartError?: string;
    /** 每次追加/完结一条工具轨迹时递增，供 v-memo 感知「同上一条数，但状态已变」 */
    agentToolTraceVersion?: number;
}
// 定义对话类型
interface Conversation {
    id: string;
    title: string;
    messages: Message[]; //数组类型，子元素是Messa类型ge
    createdAt: number;
}


//创建叫useChatStore的pinia仓库  llm-chat:这个store的id，标识这个 Store
export const useChatStore = defineStore('llm-chat',
    () => {
        const conversations = ref<Conversation[]>([
            {
                id: "1",
                title: '日常问候',
                messages: [],
                createdAt: Date.now(),
            }
        ])
        // 当前选中的对话 ID
        const currentConversationId = ref("1")

        // 获取当前对话
        const currentConversation = computed(() => {
            return conversations.value.find((conv) => conv.id === currentConversationId.value)
        })

        // 获取当前对话的消息,如果currentConversation.value为null或undefined，或者没有messages属性,返回空数组
        const currentMessages = computed(() => currentConversation.value?.messages || [])

        // 创建新对话
        const createConversation = () => {
            const newConversation = {
                id: Date.now().toString(),
                title: '日常问候',
                messages: [],
                createdAt: Date.now(),
            }
            conversations.value.unshift(newConversation)//从数组前面添加
            currentConversationId.value = newConversation.id
        }

        // 切换对话
        const switchConversation = (conversationId: string) => {
            currentConversationId.value = conversationId
        }

        // 添加消息到当前对话
        const addMessage = (message: Message) => {
            if (currentConversation.value) {
                currentConversation.value.messages.push({
                    ...message
                })
            }
        }

        // 加载状态
        const isLoading = ref(false)

        //更改加载状态
        const setIsLoading = (value: boolean) => {
            isLoading.value = value
        }

        //更新最新消息,将得到的response复制到Conversation数组中
        const updateLastMessage = (
            content: string, reasoning_content: string, completion_tokens: string, speed: string) => {
            //先检查messages.length存不存在，再确认是否>0
            if (currentConversation.value?.messages.length && currentConversation.value?.messages.length > 0) {
                const lastMessage = currentConversation.value.messages[currentConversation.value.messages.length - 1]
                lastMessage.content = content
                lastMessage.reasoning_content = reasoning_content
                lastMessage.completion_tokens = completion_tokens
                lastMessage.speed = speed
            }
        }

        const getMessageById = (messageId: number) => {
            return currentConversation.value?.messages.find((message) => message.id === messageId)
        }

        // 设置最后一条消息的 loading 状态
        const setLastMessageLoading = (value: boolean) => {
            const msgs = currentConversation.value?.messages
            if (msgs?.length) msgs[msgs.length - 1].loading = value
        }

        // 设置最后一条消息的 RAG 引用来源
        const setLastMessageSources = (sources: RagSource[]) => {
            const msgs = currentConversation.value?.messages
            if (msgs?.length) msgs[msgs.length - 1].ragSources = sources
        }

        const setLastMessageTableDraft = (draft: PendingTableDraft) => {
            const msgs = currentConversation.value?.messages
            if (!msgs?.length) return
            const lastMessage = msgs[msgs.length - 1]
            lastMessage.pendingTableDraft = draft
            lastMessage.awaitingUserConfirmation = true
            lastMessage.chartConfirming = false
            lastMessage.chartError = ''
        }

        const updateMessageTableDraft = (messageId: number, draft: PendingTableDraft) => {
            const target = getMessageById(messageId)
            if (!target) return
            target.pendingTableDraft = {
                ...draft,
                columns: [...draft.columns],
                rows: draft.rows.map(row => ({
                    ...row,
                    cells: { ...row.cells },
                })),
            }
            target.awaitingUserConfirmation = true
            target.chartError = ''
        }

        const setLastMessageAwaitingConfirmation = (value: boolean, content?: string) => {
            const msgs = currentConversation.value?.messages
            if (!msgs?.length) return
            const lastMessage = msgs[msgs.length - 1]
            lastMessage.awaitingUserConfirmation = value
            if (typeof content === 'string' && content) {
                lastMessage.content = content
            }
        }

        const setMessageChartConfirming = (messageId: number, value: boolean) => {
            const target = getMessageById(messageId)
            if (!target) return
            target.chartConfirming = value
            if (value) target.chartError = ''
        }

        const setMessageChartResult = (messageId: number, chart: ChartResult) => {
            const target = getMessageById(messageId)
            if (!target) return
            target.chartResult = chart
            target.awaitingUserConfirmation = false
            target.chartConfirming = false
            target.chartError = ''
        }

        const setMessageChartError = (messageId: number, error: string) => {
            const target = getMessageById(messageId)
            if (!target) return
            target.chartConfirming = false
            target.chartError = error
        }

        const recoverTransientState = () => {
            isLoading.value = false

            for (const conversation of conversations.value) {
                for (const message of conversation.messages) {
                    if (message.loading) {
                        message.loading = false
                    }

                    if (message.chartConfirming) {
                        message.chartConfirming = false
                    }

                    if (message.agentToolCalls?.length) {
                        message.agentToolCalls = message.agentToolCalls.map(tool => (
                            tool.status === 'running'
                                ? {
                                    ...tool,
                                    status: 'done',
                                    result: tool.result || '上一次工具执行已中断，请重新生成。',
                                }
                                : tool
                        ))
                    }

                    const looksInterruptedAssistantMessage =
                        message.role === 'assistant'
                        && !message.content?.trim()
                        && !message.reasoning_content?.trim()
                        && !message.pendingTableDraft
                        && Boolean(message.agentToolCalls?.length)

                    if (looksInterruptedAssistantMessage) {
                        message.content = '上一次生成未完成，请重新发送消息或重新生成表格草稿。'
                    }
                }
            }
        }

        /** Agent 模式下记录 MCP tool_start / tool_done（新数组赋值，便于 v-memo 与视图刷新） */
        const recordAgentToolEvent = (
            phase: 'start' | 'done',
            toolName: string,
            payload?: Record<string, unknown> | string,
        ) => {
            const msgs = currentConversation.value?.messages
            if (!msgs?.length) return
            const lastMessage = msgs[msgs.length - 1]
            if (lastMessage.role !== 'assistant') return

            const prev = lastMessage.agentToolCalls ?? []
            if (phase === 'start') {
                const row: AgentToolCallRecord = {
                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                    name: toolName,
                    status: 'running',
                }
                if (payload !== undefined && typeof payload === 'object' && payload !== null) {
                    row.args = payload as Record<string, unknown>
                }
                lastMessage.agentToolCalls = [...prev, row]
                lastMessage.agentToolTraceVersion = (lastMessage.agentToolTraceVersion ?? 0) + 1
                return
            }

            /** 服务端当前为串行执行工具：done 对齐「最近一次仍在 running」的条目 */
            const next = prev.map(r => ({ ...r }))
            for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].status !== 'running') continue
                const resultText =
                    typeof payload === 'string'
                        ? payload
                        : payload != null && typeof payload === 'object'
                            ? JSON.stringify(payload, null, 2)
                            : ''
                next[i] = {
                    ...next[i],
                    status: 'done',
                    result: resultText || next[i].result,
                }
                break
            }
            lastMessage.agentToolCalls = next
            lastMessage.agentToolTraceVersion = (lastMessage.agentToolTraceVersion ?? 0) + 1
        }

        //得到最新message
        const getLastMessage = () => {
            if (currentConversation.value?.messages.length && currentConversation.value?.messages.length > 0) {
                return currentConversation.value.messages[currentConversation.value.messages.length - 1]
            }
            return null
        }

        // 从消息内容更新标题
        const updateTitleFromMessage = (content: string) => {
            if (!currentConversation.value) return
            // 去除 Markdown 标记
            // 提取前6个字符作为标题
            let newTitle = content.trim().substring(0, 6)
            // 添加省略号如果内容被截断
            if (content.length > 6) {
                newTitle += '...'
            }
            // 确保标题不为空
            if (!newTitle) {
                newTitle = '日常问候'
            }

            currentConversation.value.title = newTitle
        }

        // 删除对话
        const deleteConversation = (conversationId: string) => {
            const index = conversations.value.findIndex(conversation =>
                conversation.id === conversationId
            )
            if (index !== -1) {
                //在数组中删除
                conversations.value.splice(index, 1)
                // 如果删除后没有对话了，创建一个新对话
                if (conversations.value.length === 0) {
                    createConversation()
                }
                // 如果删除的是当前对话，切换到第一个对话
                else if (conversationId === currentConversationId.value) {
                    currentConversationId.value = conversations.value[0].id
                }

            }
        }


        return {
            conversations,
            currentConversationId,
            currentConversation,
            currentMessages,
            createConversation,
            switchConversation,
            addMessage,
            isLoading,
            setIsLoading,
            updateLastMessage,
            getLastMessage,
            deleteConversation,
            updateTitleFromMessage,
            setLastMessageLoading,
            setLastMessageSources,
            setLastMessageTableDraft,
            updateMessageTableDraft,
            setLastMessageAwaitingConfirmation,
            setMessageChartConfirming,
            setMessageChartResult,
            setMessageChartError,
            recordAgentToolEvent,
            recoverTransientState,
        }// 暴露状态供组件使用
    },
    {
        persist: true,
    },
)
