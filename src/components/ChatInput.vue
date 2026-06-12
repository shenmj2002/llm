<script setup lang="ts">
import { ref } from "vue";
import type { Ref } from 'vue';//ts类型注解声明
import { Close, Document, FolderOpened, PictureFilled, Promotion } from '@element-plus/icons-vue'

//定义FileItem这种类型结构
interface FileItem {
    name: string;      // 文件名
    url: string;       // 文件的临时 URL
    type: 'image' | 'file'; // 文件类型
    size: number;      // 文件大小（字节）
}
const fileList: Ref<FileItem[]> = ref([]) // 展示用的文件列表（含 blob URL）
const rawFiles: Ref<File[]> = ref([])     // 原始 File 对象，与 fileList 下标一一对应
const inputValue = ref('')

// 图片转 base64 data URL，刷新后仍可显示；非图片文件用 blob URL 即可
function toDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

// 处理文件上传
const handleFileUpload = async (uploadFile: { raw: File }) => {
    const file = uploadFile.raw
    if (!file) return false
    const isImage = file.type.startsWith('image/')
    const url = isImage ? await toDataURL(file) : URL.createObjectURL(file)
    fileList.value.push({ name: file.name, url, type: isImage ? 'image' : 'file', size: file.size })
    rawFiles.value.push(file)
    return false
}

//删除文件
const handleFileRemove = (file: { url: string }) => {
    const index = fileList.value.findIndex((item) => item.url === file.url)
    if (index !== -1) {
        URL.revokeObjectURL(fileList.value[index].url)
        fileList.value.splice(index, 1)
        rawFiles.value.splice(index, 1) // 同步删除原始 File 对象
    }
}

const emit = defineEmits(["send"])
const sendMessage = () => {
    if (!inputValue.value.trim() || props.loading) return
    const messageContent = {
        text: inputValue.value.trim(),
        files: fileList.value,
        rawFiles: rawFiles.value, // 传递原始 File 对象供父组件处理
    }
    emit("send", messageContent)
    fileList.value = []
    rawFiles.value = []
    inputValue.value = ""
}

// 处理换行的方法（Shift + Enter）
const handleNewline = (event: KeyboardEvent) => {
  event.preventDefault() // 阻止默认的 Enter 发送行为
  inputValue.value += '\n' // 在当前位置添加换行符
}

//props父组件传递到子组件,传递loading这个参数
const props = defineProps({
    loading:{
        type: Boolean,
        default: false
    }
})
</script>


<template>
    <div class="chat-put">
        <!-- 文件预览区域 -->
        <div class="chat-put-preview" v-if="fileList.length > 0">
            <div class="preview-item" v-for="file in fileList" :key="file.url">
                <!-- 图片预览 -->
                <div class="image-preview" v-if="file.type === 'image'">
                    <img :src="file.url">
                    <div class="remove-btn" @click="handleFileRemove(file)">
                        <el-icon>
                            <Close />
                        </el-icon>
                    </div>
                </div>
                <!-- 文件预览 -->
                <div class="file-preview" v-else>
                    <el-icon>
                        <Document />
                    </el-icon>
                    <div class="file-name">{{ file.name }}</div>
                    <!-- toFixed:转换成字符串并指定小数位数 -->
                    <div class="file-size">{{ (file.size / 1024).toFixed(1) }}KB</div>
                    <div class="remove-btn" @click="handleFileRemove(file)">
                        <el-icon>
                            <Close />
                        </el-icon>
                    </div>
                </div>
            </div>
        </div>

        <!-- 输入框＋按钮区域 -->
        <div class="chat-put-input">
            <!--placeholder:input文本框默认内容 textarea:支持换行 resize:是否能被用户缩放-->
            <el-input v-model="inputValue" type="textarea" placeholder="输入消息，Enter发送，Shihft+Enter 换行"
                :autosize="{ minRows: 1, maxRows: 6 }" resize="none"
                @keydown.enter.exact.prevent="sendMessage"
                @keydown.enter.shift="handleNewline" />
            <div class="chat-input-button">
                <!-- 文件上传按钮 on-change：文件状态改变时的钩子-->
                <el-upload class="upload-btn" :on-change="handleFileUpload" :auto-upload="false" 
                    :show-file-list="false" accept=".pdf,.doc,.docx,.txt">
                    <button class="action-btn">
                        <el-icon size="20px">
                            <FolderOpened />
                        </el-icon>
                    </button>
                </el-upload>
                <!-- 图片上传按钮 on-change：文件状态改变时的钩子-->
                <el-upload class="upload-btn" :on-change="handleFileUpload" :auto-upload="false" 
                    :show-file-list="false" accept="image/*">
                    <button class="action-btn">
                        <el-icon size="20px">
                            <PictureFilled />
                        </el-icon>
                    </button>
                </el-upload>
                <!-- 发送按钮 -->
                <button class="action-btn" :disabled="props.loading" @click="sendMessage">
                    <el-icon size="28px">
                        <Promotion />
                    </el-icon>
                </button>
            </div>
        </div>
    </div>
</template>


<style scoped lang="scss">
.chat-put {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(243, 247, 255, 0.92) 100%);
    padding: 14px 16px 12px;
    border: 1px solid var(--border-color);
    border-radius: 28px;
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(16px);

    .chat-put-preview {
        margin-bottom: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;

        .preview-item {
            display: flex;
            position: relative;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid rgba(110, 127, 157, 0.18);
            background: rgba(255, 255, 255, 0.82);

            .image-preview {
                width: 76px;
                height: 76px;
                img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
            }

            .file-preview {
                min-width: 180px;
                padding: 12px 14px;
                background-color: rgba(255, 255, 255, 0.75);
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 10px;
                color: var(--text-color);

                .el-icon {
                    width: 34px;
                    height: 34px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--primary-soft);
                    color: var(--primary-color);
                    font-size: 18px;
                }

                .file-name {
                    max-width: 120px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-weight: 600;
                }
                .file-size {
                    color: var(--text-color-secondary);
                    font-size: 12px;
                }
            }

            .remove-btn {
                position: absolute;
                top: 4px;
                right: 4px;
                width: 24px;
                height: 24px;
                background-color: rgba(15, 23, 42, 0.52);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: white;
                &:hover {
                    background-color: rgba(15, 23, 42, 0.72);
                }
            }
        }
    }

    .chat-put-input {
        display: flex;
        align-items: flex-end;
        gap: 12px;

        :deep(.el-textarea__inner) {
            box-shadow: none;
            background-color: transparent;
            border: none;
            color: var(--text-color-primary);
            min-height: 52px !important;
            padding: 8px 0;
            font-size: 15px;
            line-height: 1.7;

            &::placeholder {
                color: var(--text-color-tertiary);
            }
        }

        .chat-input-button {
            display: flex;
            align-items: center;
            gap: 8px;

            .upload-btn {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .action-btn {
                width: 42px;
                height: 42px;
                border: 1px solid rgba(116, 132, 160, 0.18);
                border-radius: 14px;
                background: rgba(255, 255, 255, 0.82);
                color: var(--text-color-secondary);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;

                &:hover {
                    transform: translateY(-1px);
                    color: var(--primary-color);
                    border-color: rgba(91, 124, 255, 0.24);
                    background: rgba(91, 124, 255, 0.08);
                }
            }

            .action-btn:last-child {
                width: 48px;
                height: 48px;
                border: none;
                background: linear-gradient(135deg, var(--primary-color) 0%, #7893ff 100%);
                color: #fff;
                box-shadow: 0 16px 24px rgba(91, 124, 255, 0.24);

                &:hover {
                    background: linear-gradient(135deg, var(--primary-color-hover) 0%, #6986fb 100%);
                }

                &:disabled {
                    cursor: not-allowed;
                    opacity: 0.55;
                    transform: none;
                    box-shadow: none;
                }
            }
        }
    }
}
</style>
