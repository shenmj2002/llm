<script setup lang="ts">
import { Document, Loading, Sunny, ArrowDown } from '@element-plus/icons-vue'
import { ref, watch, onUnmounted, onMounted } from "vue";
import { rederMarkdown } from "@/utils/markdown";
import copyIcon from '@/assets/photo/复制.png'


//props父组件传递到子组件,传递message这个参数
const props = defineProps({
    message: {
        type: Object,//对象类型
        default: " "
    }
})

//深度思考部分展开折叠
const isReasoningExpanded = ref(true)
const toggleReasoning = () => {
    isReasoningExpanded.value = !isReasoningExpanded.value
}

// 用 ref 手动存储渲染结果，配合防抖实现 chunk 合并渲染
const renderedContent = ref('')
const renderedReasoning = ref('')

let contentTimer: ReturnType<typeof setTimeout> | null = null
let reasoningTimer: ReturnType<typeof setTimeout> | null = null

// content：流式时 80ms 内多次更新只渲染最新值（合并 chunk）
// 消息加载完成（loading=false）时立刻强制渲染一次保证最终内容完整
watch(
    () => [props.message.content, props.message.loading] as const,
    ([content, loading]) => {
        if (contentTimer) clearTimeout(contentTimer)
        if (!loading) {
            // 已结束：立刻渲染最终结果
            renderedContent.value = rederMarkdown(content || '')
        } else {
            // 流式中：80ms 防抖，合并快速到来的 chunk
            contentTimer = setTimeout(() => {
                renderedContent.value = rederMarkdown(content || '')
            }, 80)
        }
    },
    { immediate: true }
)

// reasoning 同理
watch(
    () => [props.message.reasoning_content, props.message.loading] as const,
    ([reasoning, loading]) => {
        if (!reasoning) { renderedReasoning.value = ''; return }
        if (reasoningTimer) clearTimeout(reasoningTimer)
        if (!loading) {
            renderedReasoning.value = rederMarkdown(reasoning)
        } else {
            reasoningTimer = setTimeout(() => {
                renderedReasoning.value = rederMarkdown(reasoning)
            }, 80)
        }
    },
    { immediate: true }
)

onUnmounted(() => {
    if (contentTimer) clearTimeout(contentTimer)
    if (reasoningTimer) clearTimeout(reasoningTimer)
})

//复制函数
const handleCopy = async () => {
    try {
        await navigator.clipboard.writeText(props.message.content)
    } catch (error) {
        console.error('复制失败:', error)
    }
}

// 代码块的复制函数
const handleCodeCopy = async (event: MouseEvent) => {
    //event.target事件发生的元素，这里指<button>,为HTMLElement类型
    const codeBlock = (event.target as HTMLElement).closest('.code-block')//向上查找最近的拥有.code-block 类名的元素
    if (!codeBlock) return;
    //querySelector：向下找，查找第一个匹配指定 CSS 选择器的元素
    const codeElement = codeBlock.querySelector('code');//在找到的代码块容器中，查找 <code> 标签
    if (!codeElement) return;
    //'':确保 code 变量是字符串类型，避免 null、undefined
    const code = codeElement.textContent || ''//获取<code> 标签代码内容
    try {
        await navigator.clipboard.writeText(code)
    } catch (err) {
        console.error('复制失败:', err)
    }
}


//生命周期函数：组件渲染完后给每个codeblock添加复制事件
onMounted(() => {
    //创建WeakMap实例，储存已经绑定的复制按钮元素，键为HTMLElement类型，值为boolean类型
    //键为复制按钮元素，值为true或false
    const listenerMap = new WeakMap<HTMLElement, boolean>();
    // 创建MutationObserver实例，用于监听新增的节点,mutations:回调函数得到的突变数组
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            //检查是否有新增的DOM节点，mutation.addedNodes.length：新增节点的长度
            if (mutation.addedNodes.length) {
                //查找页面中所有拥有 .code-block 类名的元素
                const codeBlocks = document.querySelectorAll('.code-block')
                codeBlocks.forEach((block) => {
                    //查找block下data-action="copy"的元素
                    const copyBtn = block.querySelector('[data-action="copy"]') as HTMLElement | null;
                    //如果找到了复制按钮，并且该按钮还没有被标记为已添加事件监听器
                    if (copyBtn && !listenerMap.has(copyBtn as HTMLElement)) {
                        //给复制按钮添加点击事件监听器，addEventListener：为 DOM 元素绑定事件监听器
                        copyBtn.addEventListener('click', handleCodeCopy)
                        listenerMap.set(copyBtn as HTMLElement, true)
                    }
                })
            }
        })
    })

    // 开始观察
    observer.observe(document.body, {
        childList: true,//观察子节点的变化
        subtree: true,//观察所有后代节点的变化
    })

    // 组件卸载时清理
    onUnmounted(() => {
        observer.disconnect()//停止 MutationObserver 的观察
        const codeBlocks = document.querySelectorAll('.code-block')
        codeBlocks.forEach((block) => {
            const copyBtn = block.querySelector('[data-action="copy"]')as HTMLElement | null;
            copyBtn?.removeEventListener('click', handleCodeCopy)
        })
    })
})

</script>

<template>
    <!-- 动态绑定：当message.role==='user'时，类名为is-mine ，{}里面为对象-->
    <div class="message-item" :class="{ 'is-mine': message.role === 'user' }">
        <!-- 文件预览区域  因为message.files是数组所以还要length>0-->
        <div class="files-container" v-if="message.files && message.files.length > 0">
            <div class="files-item" v-for="file in message.files" :key="file.url">
                <!-- 图片预览 -->
                <div class="image-preview" v-if="file.type === 'image'">
                    <img :src="file.url" :alt="file.name">
                </div>
                <!-- 文件预览 -->
                <div  class="file-preview" v-else>
                    <el-icon>
                        <Document />
                    </el-icon>
                    <div class="file-name">{{ file.name }}</div>
                    <!-- toFixed:转换成字符串并指定小数 -->
                    <div class="file-size">{{ (file.size / 1024).toFixed(1) }}KB</div>
                </div>
            </div>
        </div>
        <!-- 消息内容 -->
        <div class="content">
            <!-- 内容生成中 -->
            <div class="thinking-text" v-if="message.loading === true && message.role === 'assistant'">
                <el-icon class="loading-icon">
                    <Loading />
                </el-icon>
                <span>内容生成中...</span>
            </div>
            <!-- 深度思考小按钮 -->
            <div class="thinking-botton" v-if="message.reasoning_content && message.role === 'assistant'"
                @click="toggleReasoning">
                <el-icon>
                    <Sunny />
                </el-icon>
                <span>深度思考</span>
                <div class="expanded-icon" :class="{ 'is-expanded': isReasoningExpanded }">
                    <el-icon>
                        <ArrowDown />
                    </el-icon>
                </div>
            </div>
            <!-- reasoning深度思考内容 --><!--v-html: 将 Vue 实例中的变量解析为 HTML 字符串，并直接渲染到 DOM 中 -->
            <div class="reasoning " v-if="message.reasoning_content && isReasoningExpanded" v-html="renderedReasoning">
            </div>
            <!--content消息内容  -->
            <div class="bubble " v-html="renderedContent"></div>
            <!-- 复制按钮和 tokens 信息 -->
            <div class="message-actions" v-if="message.loading === false && message.role === 'assistant'">
                <!--复制按钮   title: 当用户鼠标悬停在按钮上时显示的提示内容 -->
                <button class="action-btn" @click="handleCopy" title="复制">
                    <img :src="copyIcon" />
                </button>
                <!-- 添加 tokens 信息 -->
                <span class="tokens-info" v-if="message.completion_tokens">
                    tokens:{{ message.completion_tokens }},speed:{{ message.speed }}tokens/s
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
.message-item {
    display: flex;
    margin-bottom: 2em;

    //表示同时拥有 message-item 和 is-mine 类的元素
    &.is-mine {
        align-items: flex-end;//靠右对齐
        flex-direction: column ;
        .content .bubble {
            background-color: #f4f4f4; //用户消息背景色,这里嵌套的类选择器更多,所以放在这里
        }
    }

    .files-container {
        margin-bottom: 8px;
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap; //空间不足时，子元素会自动换行
        gap: 8px;

        .files-item {
            .image-preview {
                max-width: 100px; //限制最大宽度
                img {
                    display: block; //移除图片底部的间隙
                    max-width: 100%; //限制最大宽度
                    height: auto; //高度自适应，保持原比例
                    border-radius: 8px;
                }
            }

            .file-preview {
                padding: 8px;
                background-color: #f4f4f5;
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 8px;

                .file-name {
                    max-width: 120px;
                    overflow: hidden;
                    text-overflow: ellipsis; //超出就省略号
                    white-space: nowrap; //禁止文本自动换行
                }

                .file-size {
                    color: #909399;
                    font-size: 12px;
                }
            }
        }
    }

    .content {
        max-width: 100%; //相对于父元素
        min-width: 0;
        width: fit-content; //自适应
        overflow: hidden;

        //生成中的动画
        @keyframes spin {
            from {
                transform: rotate(0deg);//元素旋转0度
            }

            to {
                transform: rotate(360deg);//元素旋转360度
            }
        }

        .thinking-text {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0.75rem 1rem;
            color: #6b7280;
            font-size: 0.875rem;

            .loading-icon {
                width: 16px;
                height: 16px;
                animation: spin 1s linear infinite;
            }
        }

        .thinking-botton {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            margin-left: 16px;
            margin-bottom: 8px;
            cursor: pointer;
            width: fit-content;
            border-radius: 4px;
            background-color: rgb(220, 217, 217); // 添加浅灰色背景
            transition: background-color 0.2s; //背景颜色变化

            span {
                font-size: 13px;
                color: rgb(78, 77, 77);
            }

            .expanded-icon {
                font-size: 12px;
                color: rgb(78, 77, 77);
                transition: transform 0.2s;

                //展开的时候
                &.is-expanded {
                    transform: rotate(180deg); //元素旋转180度
                }
            }

            &:hover {
                background-color: rgb(176, 174, 174); // 调整悬停时的背景色为更深的灰色
            }
        }

        .reasoning {
            margin-bottom: 8px; // 与下方内容保持间距
            margin-left: 16px;
            padding: 0 16px; // 内部内容的边距
            background-color: #ffffff; // 浅灰色背景，类似引用块
            border-left: 3px solid #dfe2e5; // 左侧边框，是引用块的特征
            color: #8b8b8b; // 文字颜色设置为深灰色
            font-size: 14px; // 字体大小稍小于正文
            line-height: 1.6; // 行高适中，提高可读性

            //deep:markdown后的元素也能作用
            // 处理内部段落的样式 
            :deep(p) {
                margin: 0; // 移除段落默认边距
            }

            :deep(p+p) {
                margin-bottom: 8px; // 段落之间保持间距，最后一个段落不需要
            }

            // 处理内部行内代码的样式
            :deep(code:not(.code-block *):not(.hljs *)):not([class*="language-"]) {
                background-color: #f0f0f0; // 代码块的背景色
                padding: 2px 4px; // 代码块的内边距
                border-radius: 3px; // 圆角边框
                font-size: 0.9em; // 代码字体稍小
            }

            :deep(.code-block) {
                .code-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.5rem 1rem;
                    background-color: var(--code-header-bg);

                    .code-lang {
                        font-size: 0.875rem;
                        color: var(--code-lang-text);
                        font-family: var(--code-font-family);
                    }

                    .code-action-btn {
                        width: 1.5rem;
                        height: 1.5rem;
                        padding: 0;
                        border: none;
                        background: none;
                        cursor: pointer;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: background-color 0.2s;

                        img {
                            width: 1rem;
                            height: 1rem;
                            opacity: 1;
                        }

                        &:hover {
                            background-color: var(--code-header-button-hover-bg);
                        }
                    }

                }


                .hljs {
                    margin: 0 !important;
                    padding: 1rem;
                    background-color: var(--code-block-bg);
                    overflow-x: auto; // 添加横向滚动
                    white-space: pre; // 保留原始空白，禁止自动换行

                    code {
                        white-space: pre; // 保留原始空白，禁止自动换行
                    }
                }
            }
        }

        .bubble {
            width: 100%; // 占满容器宽度
            padding: 0.75rem 1rem;
            background-color: #ffffff; //AI助手消息背景色
            border-radius: 1rem;
            font-size: 1rem;
            line-height: 1.5;
            word-break: break-word; //长文本自动换行 
            overflow: hidden;

            :deep(.code-block) {
                margin: 0.5rem 0;
                border: 1px solid var(--code-border);
                border-radius: 0.5rem;
                overflow: hidden;
                width: 100%;

                pre {
                    margin: 0 !important;
                }

                .code-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.5rem 1rem;
                    background-color: var(--code-header-bg);

                    .code-lang {
                        font-size: 0.875rem;
                        color: var(--code-lang-text);
                        font-family: var(--code-font-family);
                    }

                    .code-action-btn {
                        width: 1.5rem;
                        height: 1.5rem;
                        padding: 0;
                        border: none;
                        background: none;
                        cursor: pointer;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.2s;

                        img {
                            width: 1rem;
                            height: 1rem;
                            opacity: 1;
                        }

                        &:hover {
                            background-color: var(--code-header-button-hover-bg);
                        }
                    }

                }

                .hljs {
                    margin: 0 !important;
                    padding: 1rem;
                    background-color: var(--code-block-bg);
                    overflow-x: auto; // 添加横向滚动
                    white-space: pre; // 保留原始空白，禁止自动换行

                    code {
                        white-space: pre; // 保留原始空白，禁止自动换行
                    }
                }
            }

            :deep(p) {
                margin: 0; // 移除段落默认边距
            }

            :deep(p+p) {
                margin-bottom: 0.5rem; // 段落之间保持间距，最后一个段落不需要
            }

            //行内代码样式
            :deep(code:not(.code-block *):not(.hljs *):not([class*="language-"])) {
                font-family: var(--code-font-family); // 使用等宽字体
                padding: 0.2em 0.4em;
                border-radius: 0.25rem;
                background-color: #f0f0f0;
            }

            // 列表样式
            :deep(ul) {
                :deep(ol) {
                    margin: 0.5rem 0;
                    padding-left: 1.5rem;
                }
            }

            // 引用块样式
            :deep(blockquote) {
                margin: 0.5rem 0;
                padding-left: 1rem;
                border-left: 4px solid var(--border-color); // 左侧边框
                color: var(--text-color-secondary); // 使用次要文本颜色
            }

            // 表格样式
            :deep(table) {
                border-collapse: collapse; // 合并边框
                margin: 0.5rem 0;
                width: 100%;

                th,
                td {
                    border: 1px solid var(--border-color); // 单元格边框
                    padding: 0.5rem;
                }

                th {
                    background-color: var(--code-header-bg); // 表头背景色
                }
            }

            // 链接样式
            :deep(a) {
                color: #3f7af1; // 链接颜色
                text-decoration: none;

                &:hover {
                    text-decoration: underline; // 悬停时显示下划线
                }
            }

            // 图片样式
            :deep(img) {
                max-width: 100%; // 限制最大宽度
                border-radius: 0.5rem; // 圆角
            }
        }

        //复制按钮+token
        .message-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.5rem;
            padding-left: 1rem;

            //复制按钮
            .action-btn {
                width: 1.5rem;
                height: 1.5rem;
                padding: 0;
                border: none;
                background: none;
                cursor: pointer;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;

                img {
                    width: 1rem;
                    height: 1rem;
                    opacity: 1;
                }

                &:hover {
                    background-color: var(--code-header-button-hover-bg);
                }
            }

            //添加 tokens 信息样式
            .tokens-info {
                display: flex;
                gap: 0.5rem;
                color: var(--text-color-secondary);
                font-size: 0.75rem;
                background-color: #f3f4f6;
                padding: 0.25rem 0.5rem;
                border-radius: 0.25rem;
            }
        }

    }
}
</style>