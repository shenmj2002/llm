<script setup lang="ts">
import Sidebar from "@/components/Sidebar.vue"
import ChatMessage from "@/components/ChatMessage.vue"
import ChatInput from "@/components/ChatInput.vue"
import SettingsPanel from "@/components/SettingsPanel.vue"
import { ChatDotRound, Document, Setting } from "@element-plus/icons-vue"
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useChatStore } from "@/stores/chat.ts"
import { messageHandle } from "@/utils/messageHandle.ts"
import { createChatCompletion, createAgentCompletion, confirmAgentTableChart } from "@/utils/api.ts"
import { useSettingStore } from "@/stores/settings"
import type { PendingTableDraft } from "@/types/tableDraft"


//定义仓库chatStore
const chatStore = useChatStore()
const settingStore = useSettingStore()

//导出聊天信息
const currentMessages = computed(() => chatStore.currentMessages)
const isLoading = computed(() => chatStore.isLoading)

// #region debug-point F:debug-reporter
function reportDebugEvent(hypothesisId: string, location: string, msg: string, data: Record<string, unknown> = {}, runId = 'pre') {
    fetch('http://127.0.0.1:7778/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: 'confirm-chart-stuck',
            runId,
            hypothesisId,
            location,
            msg,
            data,
            ts: Date.now(),
        }),
    }).catch(() => { })
}
// #endregion

//创建settingDrawer以导入设置面板实例  类型可能是SettingsPanel实例也可能是null
const settingDrawer = ref<InstanceType<typeof SettingsPanel> | null>(null);
//只有settingDrawer.value存在，才执行openDrawer
const openSettings = () => settingDrawer.value?.openDrawer();

const handleConfirmTableDraft = async (payload: { messageId: number; draft: PendingTableDraft }) => {
    const { messageId, draft } = payload
    try {
        chatStore.setMessageChartConfirming(messageId, true)
        const result = await confirmAgentTableChart({
            conversationId: chatStore.currentConversationId,
            messageId,
            sessionToken: draft.sessionToken,
            tablePayload: draft,
            chartStyleRequest: draft.chartPrompt || '',
            model: settingStore.settings.model,
        })
        chatStore.setMessageChartResult(messageId, result.chart)
    } catch (error: any) {
        chatStore.setMessageChartError(messageId, error?.message || '折线图生成失败')
    }
}

const handleUpdateTableDraft = (payload: { messageId: number; draft: PendingTableDraft }) => {
    chatStore.updateMessageTableDraft(payload.messageId, payload.draft)
}


// 把 图片 读成 base64 Data URL
function readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

// 把文本文件读成字符串
function readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsText(file, 'utf-8')
    })
}

// 根据文件列表构建发送给 API 的消息 content
// 图片 → 多模态数组，文本文件 → 注入到文字消息里
async function buildApiContent(text: string, files: File[]) {
    if (files.length === 0) return text

    const images = files.filter(f => f.type.startsWith('image/'))
    const textFiles = files.filter(f => !f.type.startsWith('image/'))

    // 文本文件内容拼接到消息前面
    let fullText = text
    for (const file of textFiles) {
        const content = await readAsText(file)
        fullText = `文件内容（${file.name}）：\n\`\`\`\n${content}\n\`\`\`\n\n${fullText}`
    }

    // 没有图片时直接返回字符串
    if (images.length === 0) return fullText

    // 有图片：构建多模态内容数组（OpenAI Vision 格式）
    const parts: any[] = []
    for (const img of images) {
        const base64 = await readAsDataURL(img)
        parts.push({ type: 'image_url', image_url: { url: base64 } })
    }
    parts.push({ type: 'text', text: fullText })
    return parts
}

//发送消息
const handleSend = async (messageContent: { text: string; files: any[]; rawFiles: File[] }) => {
    try {
        // 添加用户消息到 store（展示用，保留 blob URL 用于气泡中预览）
        chatStore.addMessage(
            messageHandle.formatMessage("user", messageContent.text, " ", messageContent.files)
        )
        chatStore.updateTitleFromMessage(messageContent.text)
        // 添加空的助手消息占位，loading=true 表示生成中
        chatStore.addMessage(
            messageHandle.formatMessage("assistant", "", "", [], true)
        )
        chatStore.setIsLoading(true)

        // 取历史消息（去掉刚加的空 assistant）作为上下文
        const history = chatStore.currentMessages
            .slice(0, -2)
            .map(({ role, content }) => ({ role, content }))

        // 处理当前用户消息的文件，构建多模态 content
        const currentContent = await buildApiContent(messageContent.text, messageContent.rawFiles)
        const sendMessages = [...history, { role: 'user' as const, content: currentContent }]

        if (settingStore.settings.agentEnabled) {
            // Agent 模式：走 /api/agent，支持 MCP 工具调用
            const response = await createAgentCompletion(sendMessages)
            await messageHandle.handleAgentStream(
                response,
                (content: string, reasoning: string, tokens: string, speed: string) => {
                    chatStore.updateLastMessage(content, reasoning, tokens, speed)
                },
                (phase: 'start' | 'done', name: string, extra: Record<string, unknown> | string | undefined) => {
                    chatStore.recordAgentToolEvent(phase, name, extra as any)
                },
                (eventType: string, payload: any) => {
                    if (eventType === 'tool_done_structured' && payload?.kind === 'table_draft') {
                        chatStore.setLastMessageTableDraft(payload.draft)
                    }
                    if (eventType === 'awaiting_confirmation') {
                        chatStore.setLastMessageAwaitingConfirmation(true, payload?.message || '')
                    }
                },
            )
        } else {
            // 普通模式：走 /api/chat
            const response = await createChatCompletion(sendMessages)
            await messageHandle.handleResponse(
                response,
                settingStore.settings.stream,
                (content: string, reasoning_content: string, completion_tokens: string, speed: string) => {
                    chatStore.updateLastMessage(content, reasoning_content, completion_tokens, speed)
                },
                // RAG 来源回调：sources 在 LLM 流式输出前到达，立即挂到当前助手消息
                (sources: any[]) => {
                    chatStore.setLastMessageSources(sources)
                }
            )
        }
    } catch (error) {
        console.log('Failed to send message:', error)
        chatStore.updateLastMessage('抱歉，发生了一些错误，请稍后重试。', " ", " ", " ")
    } finally {
        chatStore.setIsLoading(false)
        // 流式结束，关闭 loading 状态（触发 ChatMessage 里的防抖立即刷新）
        chatStore.setLastMessageLoading(false)
    }
}


// 虚拟列表触发阈值：已定稿消息数量达到此数字才启用虚拟滚动
const VIRTUAL_THRESHOLD = 30

// 仅当消息数量 >= 阈值 且 当前不在流式输出时启用虚拟列表
const useVirtualScroll = computed(
    () => currentMessages.value.length >= VIRTUAL_THRESHOLD && !isLoading.value
)

// 普通模式的滚动容器
const listContainer = ref<HTMLElement | null>(null)
// 虚拟列表实例
const scrollerRef = ref<any>(null)

/** 距底部多少 px 内视为「在底部」，才跟随新消息自动滚动 */
const SCROLL_BOTTOM_THRESHOLD = 80
/** 用户是否在底部附近（主动上滑查看历史时为 false） */
const shouldAutoScroll = ref(true)

function getScrollElement(): HTMLElement | null {
    if (useVirtualScroll.value) {
        return (scrollerRef.value?.$el as HTMLElement) ?? null
    }
    return listContainer.value
}

function isNearBottom(): boolean {
    const el = getScrollElement()
    if (!el) return shouldAutoScroll.value
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    return distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD
}

function onMessagesScroll() {
    shouldAutoScroll.value = isNearBottom()
}

function scrollToBottom() {
    nextTick(() => {
        if (useVirtualScroll.value) {
            scrollerRef.value?.scrollToBottom()
        } else if (listContainer.value) {
            listContainer.value.scrollTop = listContainer.value.scrollHeight
        }
    })
}

function scrollToBottomIfNeeded() {
    if (shouldAutoScroll.value) {
        scrollToBottom()
    }
}

// 监听消息变化：仅当用户本来在底部附近时才跟随滚动
watch(currentMessages, scrollToBottomIfNeeded, { deep: true })

// 流式结束或普通/虚拟列表切换时，新容器默认在顶部，需在「仍贴底」时恢复到底部
watch(isLoading, (loading) => {
    if (!loading) {
        nextTick(() => {
            if (shouldAutoScroll.value) scrollToBottom()
        })
    }
})

watch(useVirtualScroll, () => {
    nextTick(() => {
        if (shouldAutoScroll.value) scrollToBottom()
    })
})

onMounted(() => {
    chatStore.recoverTransientState()
    // #region debug-point F:layout-mounted
    const lastMessage = currentMessages.value[currentMessages.value.length - 1]
    reportDebugEvent('F', 'src/views/Layout.vue:onMounted', '[DEBUG] Layout mounted with persisted chat state', {
        isLoading: isLoading.value,
        messageCount: currentMessages.value.length,
        lastRole: lastMessage?.role || '',
        lastLoading: lastMessage?.loading === true,
        lastAwaitingConfirmation: lastMessage?.awaitingUserConfirmation === true,
        lastHasTableDraft: Boolean(lastMessage?.pendingTableDraft),
        lastToolCallCount: Array.isArray(lastMessage?.agentToolCalls) ? lastMessage.agentToolCalls.length : 0,
        lastRunningToolCount: Array.isArray(lastMessage?.agentToolCalls)
            ? lastMessage.agentToolCalls.filter((tool: any) => tool?.status === 'running').length
            : 0,
    })
    // #endregion
    scrollToBottom()
    if (chatStore.conversations.length === 0) {
        chatStore.createConversation()
    }
})

</script>

<template>
    <!-- 聊天容器 -->
    <div class="chat-container">
        <!-- 左边侧边栏 -->
        <div class="container-left">
            <Sidebar />
        </div>
        <!-- 右边主体 -->
        <div class="container-right">
            <!-- 头部 -->
            <div class="header">
                <div class="header-left">
                    <div class="brand-mark">
                        <el-icon><ChatDotRound /></el-icon>
                    </div>
                    <div>
                        <p>Clay Agent</p>
                    </div>
                </div>
                <div class="header-right">
                    <button class="settings-btn" @click="openSettings">
                        <el-icon><Setting /></el-icon>
                        <span>设置</span>
                    </button>
                </div>
            </div>
            <!-- 路径 1：无消息 → 欢迎页 -->
            <div v-if="currentMessages.length === 0" class="messages-container chat-message-begin-wrapper">
                <div class="chat-message-begin">
                    <div class="hero-tag">AI Assistant Workspace</div>
                    <div class="greet">
                        <p><span>你好，准备好开始一次更高效的对话了吗？</span></p>
                        <p>支持多轮问答、文件理解、参数调节和知识库增强，让你的聊天界面更像一个真正的工作台。</p>
                    </div>
                    <div class="cards">
                        <div class="card">
                            <div class="card-icon">
                                <el-icon><ChatDotRound /></el-icon>
                            </div>
                            <p><b>智能对话</b></p>
                            <p>自然流畅的多轮交互，专注问题本身，不被界面打断。</p>
                        </div>
                        <div class="card">
                            <div class="card-icon">
                                <el-icon><Document /></el-icon>
                            </div>
                            <p><b>文件支持</b></p>
                            <p>上传文本与图片，把上下文一并带给模型，减少来回补充说明。</p>
                        </div>
                        <div class="card">
                            <div class="card-icon">
                                <el-icon><Setting /></el-icon>
                            </div>
                            <p><b>个性化设置</b></p>
                            <p>模型、流式输出、知识库和 Agent 模式都可以按场景自由切换。</p>
                        </div>
                    </div>
                    <div class="hero-note">
                        建议先发一个问题，或上传文件后让模型结合内容一起分析。
                    </div>
                </div>
            </div>

            <!-- 路径 2：有消息，普通渲染（消息数 < 阈值 或 正在流式输出） -->
            <div v-else-if="!useVirtualScroll" class="messages-container" ref="listContainer" @scroll="onMessagesScroll">
                <!-- v-memo：只有这三个值变化时才重渲染该条目，流式时非末尾消息直接跳过 -->
                <ChatMessage
                    v-for="msg in currentMessages"
                    :key="msg.id"
                    :message="msg"
                    @confirm-table="handleConfirmTableDraft"
                    @update-table-draft="handleUpdateTableDraft"
                    v-memo="[msg.content, msg.reasoning_content, msg.loading, msg.ragSources, msg.agentToolTraceVersion, msg.pendingTableDraft, msg.awaitingUserConfirmation, msg.chartConfirming, msg.chartResult, msg.chartError]"
                />
            </div>

            <!-- 路径 3：有消息，数量达到阈值且不在流式输出 → 虚拟列表 -->
            <DynamicScroller
                v-else
                ref="scrollerRef"
                :items="currentMessages"
                :min-item-size="80"
                key-field="id"
                class="messages-container"
                style="padding: 0.6rem"
                @scroll="onMessagesScroll"
            >
                <template #default="{ item, active }">
                    <DynamicScrollerItem
                        :item="item"
                        :active="active"
                            :size-dependencies="[item.content, item.reasoning_content, item.ragSources, item.agentToolTraceVersion, item.pendingTableDraft, item.awaitingUserConfirmation, item.chartConfirming, item.chartResult, item.chartError]"
                    >
                        <ChatMessage
                            :message="item"
                            @confirm-table="handleConfirmTableDraft"
                            @update-table-draft="handleUpdateTableDraft"
                        />
                    </DynamicScrollerItem>
                </template>
            </DynamicScroller>
            <!-- 聊天输入框 -->
            <div class="chat-input-container">
                <!--:loading:props父组件传递到子组件ChatInput    -->
                <ChatInput :loading="isLoading" @send="handleSend" />
            </div>
        </div>

        <!-- 设置面板  将实例导入settingDrawer，settingDrawer变成设置面板实例了-->
        <SettingsPanel ref="settingDrawer" />
    </div>

</template>

<style scoped lang="scss">
.chat-container {
    height: 100vh;
    display: flex;
    padding: 18px;
    gap: 18px;

    .container-left {
        position: relative;
        z-index: 1;
    }

    .container-right {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: 14px 18px 18px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.9) 100%);
        box-shadow: var(--shadow-md);
        backdrop-filter: blur(24px);

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 10px;
            padding: 10px 6px 18px;

            .header-left {
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 14px;

                .brand-mark {
                    width: 48px;
                    height: 48px;
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    color: #fff;
                    background: linear-gradient(135deg, var(--primary-color) 0%, #9cc8ff 100%);
                    box-shadow: 0 16px 28px rgba(110, 180, 255, 0.24);
                }

                div:last-child {
                    min-width: 0;
                }

                p {
                    color: var(--text-color-primary);
                    font-size: 22px;
                    font-weight: 700;
                    line-height: 1.2;
                    letter-spacing: 0.01em;
                }
            }

            .header-right {
                display: flex;
                align-items: center;

                .settings-btn {
                    height: 42px;
                    padding: 0 16px;
                    border: 1px solid var(--border-color);
                    border-radius: 999px;
                    background: rgba(255, 255, 255, 0.88);
                    box-shadow: var(--shadow-sm);
                    color: var(--text-color);
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s ease;

                    &:hover {
                        transform: translateY(-1px);
                        border-color: rgba(110, 180, 255, 0.28);
                        color: var(--primary-color);
                    }
                }
            }
        }

        .messages-container {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 10px 10px 0;
            max-width: 980px;
            margin: 0 auto;
            width: 100%;
        }

        .chat-message-begin-wrapper {
            .chat-message-begin {
                margin: auto 0;
                padding: 32px 8px 44px;

                .hero-tag {
                    display: inline-flex;
                    align-items: center;
                    padding: 7px 14px;
                    border-radius: 999px;
                    border: 1px solid rgba(91, 124, 255, 0.14);
                    background: rgba(255, 255, 255, 0.7);
                    color: var(--primary-color);
                    font-size: 13px;
                    font-weight: 600;
                    box-shadow: var(--shadow-sm);
                }

                .greet {
                    max-width: 760px;
                    padding: 24px 0 34px;

                    p:first-child {
                        font-size: clamp(34px, 5vw, 52px);
                        line-height: 1.12;
                        font-weight: 700;
                        letter-spacing: -0.03em;

                        span {
                            background: linear-gradient(135deg, #456ff5 0%, #6a88ff 42%, #59c3b5 100%);
                            background-clip: text;
                            -webkit-text-fill-color: transparent;
                        }
                    }

                    p:last-child {
                        margin-top: 16px;
                        color: var(--text-color-secondary);
                        font-size: 17px;
                        line-height: 1.8;
                    }
                }

                .cards {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 18px;
                    max-width: 900px;

                    .card {
                        min-height: 204px;
                        padding: 22px;
                        background: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(244, 248, 255, 0.92) 100%);
                        border: 1px solid rgba(120, 137, 167, 0.16);
                        border-radius: 24px;
                        box-shadow: var(--shadow-sm);
                        cursor: pointer;
                        transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;

                        &:hover {
                            transform: translateY(-4px);
                            border-color: rgba(91, 124, 255, 0.24);
                            box-shadow: var(--shadow-md);
                        }

                        .card-icon {
                            width: 52px;
                            height: 52px;
                            margin-bottom: 18px;
                            border-radius: 16px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 24px;
                            color: var(--primary-color);
                            background: var(--primary-soft);
                        }

                        p {
                            color: var(--text-color-secondary);
                            font-size: 14px;
                            line-height: 1.7;

                            b {
                                display: inline-block;
                                margin-bottom: 10px;
                                color: var(--text-color-primary);
                                font-size: 18px;
                            }
                        }
                    }
                }

                .hero-note {
                    margin-top: 22px;
                    color: var(--text-color-tertiary);
                    font-size: 14px;
                }
            }
        }
    }
}

.chat-input-container {
    padding: 18px 10px 4px;
    width: 100%;
    max-width: 980px;
    margin: 0 auto;
}

@media (max-width: 1080px) {
    .chat-container {
        padding: 12px;
        gap: 12px;

        .container-right {
            padding: 12px;

            .chat-message-begin-wrapper .chat-message-begin .cards {
                grid-template-columns: 1fr;
            }
        }
    }
}
</style>
