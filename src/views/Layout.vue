<script setup lang="ts">
import Sidebar from "@/components/Sidebar.vue"
import ChatMessage from "@/components/ChatMessage.vue"
import ChatInput from "@/components/ChatInput.vue"
import SettingsPanel from "@/components/SettingsPanel.vue"
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useChatStore } from "@/stores/chat.ts"
import { messageHandle } from "@/utils/messageHandle.ts"
import { createChatCompletion, createAgentCompletion } from "@/utils/api.ts"
import { useSettingStore } from "@/stores/settings"


//定义仓库chatStore
const chatStore = useChatStore()
const settingStore = useSettingStore()

//导出聊天信息
const currentMessages = computed(() => chatStore.currentMessages)
const isLoading = computed(() => chatStore.isLoading)

//创建settingDrawer以导入设置面板实例  类型可能是SettingsPanel实例也可能是null
const settingDrawer = ref<InstanceType<typeof SettingsPanel> | null>(null);
//只有settingDrawer.value存在，才执行openDrawer
const openSettings = () => settingDrawer.value?.openDrawer();


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

// 工具调用状态（在助手消息气泡上方展示）
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
                () => {}
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
const VIRTUAL_THRESHOLD = 3

// 仅当消息数量 >= 阈值 且 当前不在流式输出时启用虚拟列表
const useVirtualScroll = computed(
    () => currentMessages.value.length >= VIRTUAL_THRESHOLD && !isLoading.value
)

// 普通模式的滚动容器
const listContainer = ref<HTMLElement | null>(null)
// 虚拟列表实例
const scrollerRef = ref<any>(null)

function scrollToBottom() {
    nextTick(() => {
        if (useVirtualScroll.value) {
            scrollerRef.value?.scrollToBottom()
        } else if (listContainer.value) {
            listContainer.value.scrollTop = listContainer.value.scrollHeight
        }
    })
}

// 监听消息变化，滚动到底部
watch(currentMessages, scrollToBottom, { deep: true })

// 流式输出结束时（isLoading: true → false），可能发生 v-for → DynamicScroller 切换
// 新组件默认从顶部开始，需要重新滚到底部
watch(isLoading, (loading) => {
    if (!loading) scrollToBottom()
})

onMounted(() => {
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
                <!-- 左边 -->
                <div class="header-left">
                    <p>LLM Chat</p>
                </div>
                <!-- 右边 -->
                <div class="header-right">
                    <!-- 头像 -->
                    <!-- <div class="login">
                        <router-link to="/login">
                            <img src="@/assets/photo/小猪.png">
                        </router-link>
                    </div>-->

                    <!-- 设置 -->
                    <!-- 点击就执行openSettings函数 -->
                    <div class="settings" @click="openSettings">
                        <img src="@/assets/photo/设置.png">
                    </div>
                </div>
            </div>
            <!-- 路径 1：无消息 → 欢迎页 -->
            <div v-if="currentMessages.length === 0" class="messages-container chat-message-begin-wrapper">
                <div class="chat-message-begin">
                    <div class="greet">
                        <p><span>你好</span></p>
                        <p>让我们开始对话吧！</p>
                    </div>
                    <div class="cards">
                        <div class="card">
                            <img src="@/assets/photo/对话气泡.png">
                            <p><b>智能对话</b></p>
                            <p>自然流畅的对话体验，理解上下文</p>
                        </div>
                        <div class="card">
                            <img src="@/assets/photo/文件夹.png" class="img-2">
                            <p><b>文件支持</b></p>
                            <p>支持多种文件上传，增强信息输入</p>
                        </div>
                        <div class="card">
                            <img src="@/assets/photo/设置.png">
                            <p><b>个性化设置</b></p>
                            <p>可自定义对话参数，满足不同场景需求</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 路径 2：有消息，普通渲染（消息数 < 阈值 或 正在流式输出） -->
            <div v-else-if="!useVirtualScroll" class="messages-container" ref="listContainer">
                <!-- v-memo：只有这三个值变化时才重渲染该条目，流式时非末尾消息直接跳过 -->
                <ChatMessage
                    v-for="msg in currentMessages"
                    :key="msg.id"
                    :message="msg"
                    v-memo="[msg.content, msg.reasoning_content, msg.loading]"
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
            >
                <template #default="{ item, active }">
                    <DynamicScrollerItem
                        :item="item"
                        :active="active"
                        :size-dependencies="[item.content, item.reasoning_content]"
                    >
                        <ChatMessage :message="item" />
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
    height: 100vh; //高度是窗口的100%
    display: flex;

    .container-right {
        flex: 1; //右边一整块才是flex=1
        display: flex;
        flex-direction: column;

        .header {
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 20px;

            .header-left {
                p {
                    color: #585858;
                    font-size: 20px;
                }
            }

            .header-right {
                display: flex;

                .login {
                    img {
                        border-radius: 50%;
                        cursor: pointer;
                        height: 30px;
                        width: 30px;
                    }
                }

                .settings {
                    margin-left: 20px;
                    margin-right: 10px;

                    img {
                        cursor: pointer;
                        width: 30px;
                        height: 30px;
                    }
                }
            }


        }

        .messages-container {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 0.6rem;
            max-width: 900px;
            margin: 0 auto;
            width: 100%;
        }

        // 欢迎页容器额外样式
        .chat-message-begin-wrapper {

            .chat-message-begin {

                margin: 0 auto;//水平居中

                .greet {
                    font-size: 37px;
                    color: #c4c7c5;
                    font-weight: 500;
                    padding-bottom: 60px;
                    padding-left: 80px;
                    padding-top: 10px;

                    //五彩斑斓的效果
                    span {
                        background: -webkit-linear-gradient(16deg, #4b90ff, #ff5546);
                        background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }
                }

                .cards {
                    max-width: 700px;
                    display: flex;
                    justify-content: space-between;
                    margin-left: 80px;

                    .card {
                        width: 170px;
                        height: 180px;
                        padding: 15px;
                        background-color: #f0f4f9;
                        border-radius: 10px;
                        cursor: pointer;
                        text-align: center; //让子元素水平居中(不是弹性盒子)

                        &:hover {
                            background-color: #dfe4ea;
                        }

                        img {
                            width: 50px;

                        }

                        .img-2 {
                            width: 40px;
                            margin: 5px;
                        }

                        p {
                            font-size: 13px;
                            padding: 5px;
                            color: #585858;

                            b {
                                font-size: 18px;
                            }
                        }
                    }
                }
            }
        }
    }
}

.chat-input-container {
    position: relative;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1rem;
    width: 100%;
    max-width: 796px;
    margin: 0 auto;
}
</style>