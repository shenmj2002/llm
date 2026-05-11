<script setup lang="ts">
import { ref } from "vue";
import { useChatStore } from '@/stores/chat'
//导入提示框
import DialogEdit from '@/components/DialogEdit.vue'

//侧边栏开关
const isCollapsed = ref(false)
const toggleMenu = () => {
    isCollapsed.value = !isCollapsed.value
}

const chatStore = useChatStore()

//创建dialogEdit以导入设置面板实例  类型可能是SettingsPanel实例也可能是null
const dialogEdit = ref<InstanceType<typeof DialogEdit> | null>(null);


// 创建新对话
const handleNewChat = () => {
    chatStore.createConversation()
    isCollapsed.value = false
}

// 切换对话
const handleSwitchChat = (conversationId: string) => {
    chatStore.switchConversation(conversationId)
    isCollapsed.value = false
}


</script>


<template>
    <div class="sidebar">
        <!-- 展开 -->
        <img class="menu" src="@/assets/photo/拖动.png" @click="toggleMenu">
        <!-- 新对话 -->
        <div class="new-chat" @click="handleNewChat">
            <img src="@/assets/photo/加.png">
            <p v-if="!isCollapsed">新对话</p>
        </div>
        <!-- 最近对话 -->
        <div class="recent" v-if="!isCollapsed">
            <p class="recent-title">最近</p>
            <div class="history-list" v-for="conversation in chatStore.conversations" :key="conversation.id"
                :class="{ active: conversation.id === chatStore.currentConversationId }"
                @click="handleSwitchChat(conversation.id)">
                <div class="item-content">
                    <img src="@/assets/photo/对话气泡.png">
                    <!-- title:悬停 -->
                    <span :title="conversation.title">{{ conversation.title }}</span>
                </div>
                <div class="item-actions">
                    <button class="action-btn" @click="dialogEdit?.openDialog(conversation.id)">
                        <img src="@/assets/photo/删除.png" alt="delete" />
                    </button>
                </div>
            </div>
        </div>
        <!-- 添加对话框组件 -->
        <DialogEdit ref="dialogEdit" />
    </div>
</template>



<style scoped lang="scss">
.sidebar {
    min-height: 100vh; //最小高度是窗口的100%
    display: inline-flex; //容器内元素为flex，容器自身为行内元素
    flex-direction: column;
    background-color: var(--sidebar-bg-color);
    padding: 25px 15px;

    .menu {
        display: block;//图片变为块级元素
        margin-left: 10px;
        cursor: pointer; //鼠标变小手
        width: 20px;
        height: 17px;
    }

    .new-chat {
        margin-top: 20px;
        display: flex;
        align-items: center;
        gap: 10px; //在 Flex 项之间添加 10px 的间距
        padding: 10px 10px;
        background-color: #e6eaf1;
        border-radius: 50px;
        font-size: 14px;
        color: grey;
        cursor: pointer; 

        img {
            width: 20px;
        }
    }

    .recent {
        display: flex;
        flex-direction: column;

        .recent-title {
            display: block;
            margin-top: 20px;
            margin-bottom: 10px;
            margin-left: 7px;

        }

        .history-list {
            display: flex;
            padding-right: 20px;
            border-radius: 50px;
            align-items: center;
            justify-content: space-between;
            width: 150px;

            &:hover {
                background-color: #e2e6eb;
            }

            &.active {
                background-color: #e2e6eb;
            }

            .item-content {
                display: flex;
                align-items: start;
                gap: 10px;
                color: #282828;
                cursor: pointer;

                img {
                    margin: 10px 0 7px 6px;
                    width: 20px;
                }

                span {
                    margin: 5px 0 5px 0;
                }
            }

            .item-actions {
                .action-btn {
                    width: 0.9rem;
                    height: 0.9rem;
                    padding: 0;
                    border: none;
                    background: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    img {
                        width: 100%;
                        height: 100%;
                    }
                }

            }
        }

    }
}
</style>
