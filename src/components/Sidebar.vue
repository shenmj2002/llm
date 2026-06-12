<script setup lang="ts">
import { ref } from "vue";
import { ChatDotRound, Delete, Expand, Fold, Plus, WarningFilled } from '@element-plus/icons-vue'
import { useChatStore } from '@/stores/chat'

//侧边栏开关
const isCollapsed = ref(false)
const toggleMenu = () => {
    isCollapsed.value = !isCollapsed.value
}

const chatStore = useChatStore()

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
    <div class="sidebar" :class="{ collapsed: isCollapsed }">
        <div class="sidebar-top">
            <button class="menu-btn" @click="toggleMenu">
                <el-icon>
                    <Fold v-if="!isCollapsed" />
                    <Expand v-else />
                </el-icon>
            </button>
            <div v-if="!isCollapsed" class="sidebar-brand">
                <span class="sidebar-brand-title">Clay Agent</span>
            </div>
        </div>

        <button class="new-chat" :title="isCollapsed ? '新对话' : ''" @click="handleNewChat">
            <span class="new-chat-icon">
                <el-icon><Plus /></el-icon>
            </span>
            <p v-if="!isCollapsed">新对话</p>
        </button>

        <div class="recent" v-if="!isCollapsed">
            <p class="recent-title">最近</p>
            <div class="history-list" v-for="conversation in chatStore.conversations" :key="conversation.id"
                :class="{ active: conversation.id === chatStore.currentConversationId }"
                @click="handleSwitchChat(conversation.id)">
                <div class="item-content">
                    <div class="item-icon">
                        <el-icon><ChatDotRound /></el-icon>
                    </div>
                    <span :title="conversation.title">{{ conversation.title }}</span>
                </div>
                <div class="item-actions">
                    <el-popconfirm
                        :width="280"
                        trigger="click"
                        placement="right"
                        confirm-button-text="删除"
                        cancel-button-text="取消"
                        :icon="WarningFilled"
                        icon-color="#e6a23c"
                        popper-class="sidebar-delete-popconfirm"
                        @confirm="chatStore.deleteConversation(conversation.id)"
                    >
                        <template #actions="{ confirm, cancel }">
                            <div class="delete-pop-actions">
                                <el-button class="delete-pop-cancel" size="small" @click.stop="cancel">
                                    取消
                                </el-button>
                                <el-button class="delete-pop-confirm" size="small" type="danger" @click.stop="confirm">
                                    删除
                                </el-button>
                            </div>
                        </template>
                        <template #reference>
                            <button class="action-btn" @click.stop>
                                <el-icon><Delete /></el-icon>
                            </button>
                        </template>
                        <template #default>
                            <div class="delete-pop-content">
                                <p class="delete-pop-title">确认删除这条会话吗？</p>
                                <p class="delete-pop-name" :title="conversation.title">{{ conversation.title }}</p>
                                <p class="delete-pop-hint">删除后，聊天记录将不可恢复。</p>
                            </div>
                        </template>
                    </el-popconfirm>
                </div>
            </div>
        </div>
    </div>
</template>



<style scoped lang="scss">
:deep(.sidebar-delete-popconfirm) {
    padding: 12px;
    border-radius: 18px !important;
    border: 1px solid rgba(116, 132, 160, 0.14);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(246, 249, 255, 0.96) 100%);
    box-shadow: 0 18px 40px rgba(33, 52, 89, 0.14);

    .el-popconfirm__main {
        align-items: flex-start;
        gap: 10px;
        margin: 0;
    }

    .el-popconfirm__action {
        margin-top: 12px;
    }
}

.sidebar {
    min-height: calc(100vh - 36px);
    width: 280px;
    display: inline-flex;
    flex-direction: column;
    padding: 18px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.82) 0%, rgba(246, 249, 255, 0.92) 100%);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(20px);
    transition: width 0.24s ease, padding 0.24s ease;

    &.collapsed {
        width: 88px;
        align-items: center;
    }

    .sidebar-top {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
        padding: 4px 2px;
        width: 100%;
    }

    .menu-btn {
        width: 40px;
        height: 40px;
        border: 1px solid var(--border-color);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.8);
        color: var(--text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: var(--shadow-sm);
    }

    .sidebar-brand {
        display: flex;
        flex-direction: column;
        min-width: 0;

        .sidebar-brand-title {
            color: var(--text-color-primary);
            font-size: 14px;
            font-weight: 700;
        }
    }

    .new-chat {
        height: 52px;
        margin-bottom: 18px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 14px;
        width: 100%;
        border: none;
        border-radius: 18px;
        background: linear-gradient(135deg, var(--primary-color) 0%, #9ecfff 100%);
        color: #fff;
        cursor: pointer;
        box-shadow: 0 18px 28px rgba(110, 180, 255, 0.24);
        transition: transform 0.2s ease, box-shadow 0.2s ease;

        &:hover {
            transform: translateY(-1px);
            box-shadow: 0 22px 34px rgba(110, 180, 255, 0.3);
        }

        .new-chat-icon {
            width: 26px;
            height: 26px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.18);
            font-size: 16px;
        }

        p {
            font-size: 14px;
            font-weight: 600;
        }
    }

    .recent {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-height: 0;

        .recent-title {
            margin-bottom: 12px;
            padding-left: 8px;
            color: var(--text-color-secondary);
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .history-list {
            display: flex;
            padding: 10px 12px;
            margin-bottom: 8px;
            border: 1px solid transparent;
            border-radius: 18px;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            cursor: pointer;
            transition: all 0.2s ease;

            &:hover {
                background-color: rgba(110, 180, 255, 0.08);
                border-color: rgba(110, 180, 255, 0.16);
            }

            &.active {
                background: rgba(110, 180, 255, 0.1);
                border-color: rgba(110, 180, 255, 0.18);
            }

            .item-content {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
                color: var(--text-color-primary);

                .item-icon {
                    width: 34px;
                    height: 34px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(110, 180, 255, 0.12);
                    color: var(--primary-color);
                    flex-shrink: 0;
                }

                span {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 14px;
                }
            }

            .item-actions {
                flex-shrink: 0;

                .action-btn {
                    width: 32px;
                    height: 32px;
                    padding: 0;
                    border: none;
                    border-radius: 10px;
                    background: transparent;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--text-color-secondary);
                    transition: all 0.2s ease;

                    &:hover {
                        color: #e25c5c;
                        background: rgba(226, 92, 92, 0.1);
                    }
                }
            }
        }
    }
}

.delete-pop-content {
    min-width: 0;
}

.delete-pop-title {
    color: var(--text-color-primary);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.5;
}

.delete-pop-name {
    margin-top: 8px;
    padding: 8px 10px;
    border-radius: 12px;
    background: rgba(123, 185, 255, 0.08);
    color: var(--text-color);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
}

.delete-pop-hint {
    margin-top: 8px;
    color: var(--text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
}

.delete-pop-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

:deep(.delete-pop-cancel.el-button) {
    min-width: 68px;
    border-radius: 10px;
    border-color: rgba(116, 132, 160, 0.16);
    background: rgba(255, 255, 255, 0.96);
    color: var(--text-color);
}

:deep(.delete-pop-confirm.el-button--danger) {
    min-width: 68px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #ef6b6b 0%, #e25c5c 100%);
    box-shadow: 0 10px 22px rgba(226, 92, 92, 0.2);
}
</style>
