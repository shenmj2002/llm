<script setup lang="ts">
import { Document, Loading, Sunny, ArrowDown, Tools } from '@element-plus/icons-vue'
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import { useMarkdown, useStreamingMarkdown, useMarkdownBody } from '@/markdown/useMarkdown'
import CodeBlock from '@/markdown/components/CodeBlock.vue'
import Table from '@/markdown/components/Table.vue'
import copyIcon from '@/assets/photo/复制.png'

const { renderMarkdown } = useMarkdown()

//props父组件传递到子组件,传递message这个参数
const props = defineProps({
    message: {
        type: Object,//对象类型
        default: " "
    }
})

const messageContent = computed(() => props.message.content || '')
const messageReasoning = computed(() => props.message.reasoning_content || '')
const isStreaming = computed(() => props.message.loading === true)

function maxCitationIndex(sources: unknown[] | undefined): number {
    if (!sources?.length) return 0
    return Math.max(
        sources.length,
        ...sources.map((s: any) => (typeof s.citationId === 'number' ? s.citationId : 0)),
    )
}

const maxCitation = computed(() =>
    maxCitationIndex(props.message.ragSources as unknown[] | undefined),
)

/** 正文：buffer + 50ms 节流后再切块渲染 */
const { displayContent: throttledContent } = useStreamingMarkdown(
    messageContent,
    isStreaming,
    { throttleMs: 50 },
)

const { blocks: markdownBlocks, renderHtmlBlock } = useMarkdownBody(
    throttledContent,
    maxCitation,
)

/** 深度思考：同样节流后再 md.render */
const { displayContent: throttledReasoning } = useStreamingMarkdown(
    messageReasoning,
    isStreaming,
    { throttleMs: 50 },
)
const renderedReasoning = computed(() => renderMarkdown(throttledReasoning.value))

function citationDisplayId(source: Record<string, unknown>, index: number) {
    const id = source.citationId
    return typeof id === 'number' && id > 0 ? id : index + 1
}

/** 按 citation 编号解析 RagSource */
function resolveCitationSource(citationNum: number): Record<string, unknown> | null {
    const sources = props.message.ragSources as Record<string, unknown>[] | undefined
    if (!sources?.length) return null
    for (let i = 0; i < sources.length; i++) {
        if (citationDisplayId(sources[i], i) === citationNum) return sources[i]
    }
    return null
}

// RAG：内联引用旁侧浮层（类 tooltip）
const citePopoverVisible = ref(false)
const citePopoverId = ref<number | null>(null)
const citePopoverStyle = ref<Record<string, string>>({})
const citePopoverRef = ref<HTMLElement | null>(null)
/** 当前锚点元素，用于滚动/resize 时重算位置 */
let lastCiteAnchorEl: HTMLElement | null = null
let citePopoverDocCleanup: (() => void) | null = null

const citePopoverPayload = computed(() => {
    const id = citePopoverId.value
    if (id == null) return null
    const src = resolveCitationSource(id)
    const title = String(src?.docTitle || src?.docName || '参考来源')
    const body = String(src?.snippet || src?.text || '（无摘要）')
    const docId = src?.docId != null ? String(src.docId) : ''
    const chunkId = src?.chunkId != null ? String(src.chunkId) : ''
    return { id, title, body, docId, chunkId }
})

function closeCitePopover() {
    citePopoverVisible.value = false
    citePopoverId.value = null
    lastCiteAnchorEl = null
    citePopoverStyle.value = {}
}

function updateCitePopoverPosition(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const preferW = Math.min(340, vw - 2 * margin)
    let left = rect.left
    let top = rect.bottom + 6

    if (left + preferW > vw - margin) left = Math.max(margin, vw - preferW - margin)
    if (left < margin) left = margin

    citePopoverStyle.value = {
        position: 'fixed',
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${Math.round(preferW)}px`,
        zIndex: '10060',
    }

    nextTick(() => {
        const pop = citePopoverRef.value
        if (!pop) return
        const ph = pop.getBoundingClientRect().height
        if (top + ph > vh - margin) {
            const flipped = Math.max(margin, rect.top - ph - 6)
            citePopoverStyle.value = { ...citePopoverStyle.value, top: `${Math.round(flipped)}px` }
        }
    })
}

function toggleCitePopover(citationNum: number, anchor: HTMLElement) {
    if (citePopoverVisible.value && citePopoverId.value === citationNum) {
        closeCitePopover()
        return
    }
    citePopoverId.value = citationNum
    citePopoverVisible.value = true
    lastCiteAnchorEl = anchor
    updateCitePopoverPosition(anchor)
}

function bindCitePopoverOutsideClose() {
    citePopoverDocCleanup?.()
    const onDocMouseDown = (ev: MouseEvent) => {
        const target = ev.target as HTMLElement | null
        if (!target) return
        if (citePopoverRef.value?.contains(target)) return
        if (target.closest('.cite-ref')) return
        closeCitePopover()
    }
    const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') closeCitePopover()
    }
    const onResizeScroll = () => {
        if (lastCiteAnchorEl && citePopoverVisible.value)
            updateCitePopoverPosition(lastCiteAnchorEl)
    }

    document.addEventListener('mousedown', onDocMouseDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onResizeScroll)

    citePopoverDocCleanup = () => {
        document.removeEventListener('mousedown', onDocMouseDown, true)
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', onResizeScroll)
        citePopoverDocCleanup = null
    }
}

watch(citePopoverVisible, (open) => {
    if (open) bindCitePopoverOutsideClose()
    else citePopoverDocCleanup?.()
})

/** Agent/MCP：将参数序列化为可读文本（含非 JSON 兼容值则降级） */
function formatToolArgsJson(args?: Record<string, unknown>) {
    if (!args || Object.keys(args).length === 0) return ''
    try {
        return JSON.stringify(args, null, 2)
    } catch {
        return String(args)
    }
}

//深度思考部分展开折叠
const isReasoningExpanded = ref(true)
const toggleReasoning = () => {
    isReasoningExpanded.value = !isReasoningExpanded.value
}

function onCitationBubbleClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('.cite-ref')
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    const raw = el.getAttribute('data-cite')
    const id = raw ? parseInt(raw, 10) : NaN
    if (!Number.isFinite(id) || id < 1) return
    toggleCitePopover(id, el as HTMLElement)
}

function onCitationBubbleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const el = (e.target as HTMLElement).closest('.cite-ref')
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    const raw = el.getAttribute('data-cite')
    const id = raw ? parseInt(raw, 10) : NaN
    if (!Number.isFinite(id) || id < 1) return
    toggleCitePopover(id, el as HTMLElement)
}

onUnmounted(() => {
    citePopoverDocCleanup?.()
    closeCitePopover()
})

//复制函数
const handleCopy = async () => {
    try {
        await navigator.clipboard.writeText(props.message.content)
    } catch (error) {
        console.error('复制失败:', error)
    }
}

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
            <!-- MCP / Agent：工具调用过程与返回值 -->
            <div
                v-if="message.role === 'assistant' && message.agentToolCalls?.length"
                class="agent-tool-panel"
            >
                <div class="agent-tool-panel-head">
                    <el-icon><Tools /></el-icon>
                    <span>MCP 工具</span>
                </div>
                <div
                    v-for="tool in message.agentToolCalls"
                    :key="tool.id"
                    class="agent-tool-item"
                    :class="{ 'is-running': tool.status === 'running' }"
                >
                    <div class="agent-tool-item-title">
                        <code class="agent-tool-name">{{ tool.name }}</code>
                        <span v-if="tool.status === 'running'" class="agent-tool-status-running">
                            <el-icon class="agent-tool-spinner"><Loading /></el-icon>
                            执行中…
                        </span>
                        <span v-else class="agent-tool-status-done">已完成</span>
                    </div>
                    <details v-if="formatToolArgsJson(tool.args)" class="agent-tool-details">
                        <summary>调用参数</summary>
                        <pre class="agent-tool-pre">{{ formatToolArgsJson(tool.args) }}</pre>
                    </details>
                    <details v-if="tool.status === 'done' && tool.result" class="agent-tool-details">
                        <summary>返回结果</summary>
                        <pre class="agent-tool-pre">{{ tool.result }}</pre>
                    </details>
                </div>
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
            <!-- 引用提示：下文「编号」可与 RAG 来源对应，点击即用浮层就地展示 -->
            <p v-if="message.ragSources?.length && message.role === 'assistant'" class="cite-hint">
                点击下方回复中的 <span class="cite-hint-mark">[编号]</span> 可就地查看参考依据摘要（再次点击同一编号、按 Esc、或点击空白处均可关闭）。
            </p>
            <!--content消息内容  -->
            <div
                class="bubble"
                @click="onCitationBubbleClick"
                @keydown="onCitationBubbleKeyDown"
            >
                <div class="markdown-body">
                    <template v-for="(block, index) in markdownBlocks" :key="index">
                        <CodeBlock
                            v-if="block.type === 'code'"
                            :lang="block.lang"
                            :code="block.code"
                        />
                        <Table
                            v-else-if="block.type === 'table'"
                            :html="renderHtmlBlock(block.html)"
                        />
                        <div
                            v-else
                            class="markdown-html"
                            v-html="renderHtmlBlock(block.html)"
                        />
                    </template>
                </div>
            </div>

            <Teleport to="body">
                <div
                    v-show="citePopoverVisible && citePopoverPayload"
                    ref="citePopoverRef"
                    class="cite-reference-popover"
                    role="tooltip"
                    :aria-hidden="!citePopoverVisible"
                    :style="citePopoverStyle"
                    @mousedown.stop
                >
                    <template v-if="citePopoverPayload">
                        <div class="cite-popover-head">
                            <span class="cite-popover-num">[{{ citePopoverPayload.id }}]</span>
                            <span class="cite-popover-title">{{ citePopoverPayload.title }}</span>
                        </div>
                        <div class="cite-popover-body">{{ citePopoverPayload.body }}</div>
                        <div
                            v-if="citePopoverPayload.docId || citePopoverPayload.chunkId"
                            class="cite-popover-meta"
                        >
                            <span v-if="citePopoverPayload.docId" class="cite-meta-tag">doc: {{ citePopoverPayload.docId }}</span>
                            <span v-if="citePopoverPayload.chunkId" class="cite-meta-tag">chunk: {{ citePopoverPayload.chunkId }}</span>
                        </div>
                    </template>
                </div>
            </Teleport>
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

        .agent-tool-panel {
            margin: 6px 0 10px 12px;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #e2e8f0);
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            max-width: min(100%, 520px);

            &-head {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                font-weight: 600;
                color: #475569;
                margin-bottom: 8px;

                .el-icon {
                    color: var(--primary-color, #409eff);
                }
            }

            .agent-tool-item {
                padding: 6px 4px;
                border-top: 1px solid rgba(148, 163, 184, 0.35);

                &:first-of-type {
                    border-top: none;
                    padding-top: 2px;
                }

                &-title {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                    padding: 4px 0;
                }

                .agent-tool-name {
                    font-size: 13px;
                    font-weight: 600;
                    color: #0f172a;
                    padding: 1px 6px;
                    background: rgba(59, 130, 246, 0.1);
                    border-radius: 4px;
                }

                .agent-tool-status-running {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 12px;
                    color: #d97706;
                }

                .agent-tool-spinner {
                    width: 14px;
                    height: 14px;
                    animation: spin 1s linear infinite;
                }

                .agent-tool-status-done {
                    font-size: 12px;
                    color: #15803d;
                    font-weight: 500;
                }

                &.is-running {
                    .agent-tool-name {
                        animation: pulse-border 1.2s ease-in-out infinite alternate;
                    }
                }
            }

            @keyframes pulse-border {
                from {
                    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.25);
                }
                to {
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
                }
            }

            .agent-tool-details {
                margin-top: 4px;
                font-size: 12px;

                summary {
                    cursor: pointer;
                    color: var(--primary-color, #3f7af1);
                    user-select: none;
                }

                .agent-tool-pre {
                    margin: 6px 0 4px;
                    padding: 8px;
                    font-size: 11px;
                    line-height: 1.45;
                    background: rgba(255, 255, 255, 0.85);
                    border-radius: 6px;
                    border: 1px solid #e2e8f0;
                    max-height: 200px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-word;
                    color: #334155;
                }
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
                background-color: #f0f0f0;
                padding: 2px 4px;
                border-radius: 3px;
                font-size: 0.9em;
            }
        }

        .bubble {
            width: 100%;
            padding: 0.75rem 1rem;
            background-color: #ffffff;
            border-radius: 1rem;
            font-size: 1rem;
            line-height: 1.5;
            word-break: break-word;
            overflow: hidden;

            // 行内引用 [n]，点击就地弹出参考摘要
            :deep(.cite-ref) {
                cursor: pointer;
                color: var(--primary-color, #3b82f6);
                font-weight: 600;
                text-decoration: underline dotted;
                text-underline-offset: 2px;
            }
            :deep(.cite-ref:focus) {
                outline: 2px solid var(--primary-color, #93c5fd);
                outline-offset: 1px;
                border-radius: 2px;
            }
        }

        .cite-hint {
            margin: 0 0 0.35rem;
            padding-left: 1rem;
            font-size: 0.72rem;
            line-height: 1.5;
            color: var(--text-color-secondary, #64748b);

            .cite-hint-mark {
                font-weight: 600;
                color: var(--primary-color, #3b82f6);
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

// ── 内联引用浮层（Teleport 至 body）──────────────────────────────────────────
.cite-reference-popover {
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color, #e2e8f0);
    background: var(--bubble-bg, #fff);
    box-shadow:
        0 4px 20px rgba(15, 23, 42, 0.12),
        0 0 0 1px rgba(15, 23, 42, 0.04);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--text-color-primary, #1e293b);
    pointer-events: auto;
    max-height: min(45vh, 320px);
    overflow: auto;

    .cite-popover-head {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin-bottom: 6px;

        .cite-popover-num {
            flex-shrink: 0;
            font-size: 0.72rem;
            font-weight: 700;
            color: #fff;
            background: var(--primary-color, #3b82f6);
            border-radius: 4px;
            padding: 0.05rem 0.35rem;
            line-height: 1.4;
        }

        .cite-popover-title {
            font-weight: 600;
            word-break: break-word;
            min-width: 0;
        }
    }

    .cite-popover-body {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-color-secondary, #475569);
        padding: 6px 0 2px;
    }

    .cite-popover-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;

        .cite-meta-tag {
            font-size: 0.68rem;
            color: #64748b;
            background: #f1f5f9;
            padding: 0.1rem 0.35rem;
            border-radius: 4px;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }
}
</style>

<style lang="scss">
@import '@/markdown/markdown-body.scss';
</style>