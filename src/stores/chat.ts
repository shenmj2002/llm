import { ref, computed } from 'vue'
import { defineStore } from 'pinia'//定义一个store


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
        }// 暴露状态供组件使用
    },
    {
        persist: true,
    },
)