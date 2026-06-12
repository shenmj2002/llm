<script setup lang="ts">
import { ref } from 'vue'
import { Delete, Loading, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

interface RagDocument {
  id: string
  name: string
  uploadedAt: number
  chunkCount: number
}

const drawer = ref(false)
const documents = ref<RagDocument[]>([])
const uploading = ref(false)
const loading = ref(false)

const openDrawer = async () => {
  drawer.value = true
  await fetchDocuments()
}

const fetchDocuments = async () => {
  loading.value = true
  try {
    const res = await fetch('/api/rag/documents')
    documents.value = await res.json()
  } catch {
    ElMessage.error('获取文档列表失败')
  } finally {
    loading.value = false
  }
}

const handleUpload = async (file: File) => {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!['.txt', '.md'].includes(ext)) {
    ElMessage.error('只支持 .txt 和 .md 文件')
    return false
  }

  uploading.value = true
  const formData = new FormData()
  formData.append('file', file)

  try {
    const res = await fetch('/api/rag/upload', { method: 'POST', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '上传失败')
    ElMessage.success(`已上传「${data.document.name}」，共 ${data.document.chunkCount} 个块`)
    await fetchDocuments()
  } catch (err: any) {
    ElMessage.error(err.message || '上传失败')
  } finally {
    uploading.value = false
  }
  return false // 阻止 el-upload 默认行为
}

const handleDelete = async (doc: RagDocument) => {
  try {
    await ElMessageBox.confirm(`确定删除「${doc.name}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  try {
    const res = await fetch(`/api/rag/documents/${doc.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('删除失败')
    ElMessage.success(`已删除「${doc.name}」`)
    documents.value = documents.value.filter(d => d.id !== doc.id)
  } catch (err: any) {
    ElMessage.error(err.message || '删除失败')
  }
}

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })

defineExpose({ openDrawer })
</script>

<template>
  <el-drawer v-model="drawer" title="知识库管理" size="400px">
    <!-- 上传区域 -->
    <div class="rag-section">
      <el-upload
        :before-upload="handleUpload"
        :show-file-list="false"
        accept=".txt,.md"
        drag
      >
        <el-icon class="upload-icon"><UploadFilled /></el-icon>
        <div class="upload-text">拖拽文件到此处，或<em>点击上传</em></div>
        <div class="upload-hint">支持 .txt / .md，单文件最大 10MB</div>
      </el-upload>
      <div v-if="uploading" class="uploading-tip">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在嵌入向量，请稍候…
      </div>
    </div>

    <!-- 文档列表 -->
    <div class="rag-section">
      <div class="section-title">已上传文档（{{ documents.length }}）</div>
      <div v-loading="loading" class="doc-list">
        <div v-if="documents.length === 0 && !loading" class="empty-tip">
          暂无文档，请先上传
        </div>
        <div v-for="doc in documents" :key="doc.id" class="doc-item">
          <div class="doc-info">
            <span class="doc-name">{{ doc.name }}</span>
            <span class="doc-meta">{{ doc.chunkCount }} 块 · {{ formatDate(doc.uploadedAt) }}</span>
          </div>
          <el-button
            type="danger"
            size="small"
            :icon="Delete"
            circle
            plain
            @click="handleDelete(doc)"
          />
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped lang="scss">
:deep(.el-drawer) {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.97) 0%, rgba(244, 248, 255, 0.96) 100%);
}

:deep(.el-drawer__header) {
  margin-bottom: 0;
  padding: 22px 24px 8px;
  color: var(--text-color-primary);
  font-size: 20px;
  font-weight: 700;
}

:deep(.el-drawer__body) {
  padding: 8px 12px 24px;
}

:deep(.el-upload-dragger) {
  border-radius: 20px;
  border: 1px dashed rgba(91, 124, 255, 0.28);
  background: rgba(255, 255, 255, 0.78);
  transition: all 0.2s ease;
}

:deep(.el-upload-dragger:hover) {
  border-color: rgba(91, 124, 255, 0.42);
  background: rgba(91, 124, 255, 0.04);
}

.rag-section {
  margin: 14px 12px 18px;
  padding: 18px;
  border: 1px solid rgba(116, 132, 160, 0.14);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: var(--shadow-sm);

  .section-title {
    font-size: 13px;
    color: var(--text-color-secondary);
    margin-bottom: 12px;
    font-weight: 600;
  }
}

.upload-icon {
  font-size: 40px;
  color: var(--primary-color);
  margin-bottom: 8px;
}

.upload-text {
  font-size: 14px;
  color: var(--text-color);

  em {
    color: var(--primary-color);
    font-style: normal;
    font-weight: 600;
  }
}

.upload-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-top: 4px;
}

.uploading-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--primary-color);
  margin-top: 10px;
}

.doc-list {
  min-height: 40px;

  .empty-tip {
    font-size: 13px;
    color: var(--text-color-tertiary);
    text-align: center;
    padding: 20px 0;
  }

  .doc-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid rgba(116, 132, 160, 0.12);

    &:last-child { border-bottom: none; }

    .doc-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow: hidden;

      .doc-name {
        font-size: 14px;
        color: var(--text-color-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 260px;
        font-weight: 600;
      }

      .doc-meta {
        font-size: 12px;
        color: var(--text-color-secondary);
      }
    }
  }
}
</style>
