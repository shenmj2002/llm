<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import RagPanel from '@/components/RagPanel.vue'
import { useSettingStore, modelOptions } from "@/stores/settings"

const settingStore = useSettingStore()

const drawer = ref(false)
const openDrawer = () => {
  drawer.value = true
}

const currentMaxTokens = computed(()=>{
  const currentModel = modelOptions.find((option)=>option.value===settingStore.settings.model)
  return currentModel ? currentModel.maxTokens : 4096
})

watch(
  ()=>settingStore.settings.model,
  (newModel)=>{
    const currentModel = modelOptions.find((option)=>option.value===newModel)
    if(currentModel){
      settingStore.settings.maxTokens=Math.min(currentModel.maxTokens,settingStore.settings.maxTokens)
    }
  }
)

const ragPanelRef = ref<InstanceType<typeof RagPanel> | null>(null)
const openRagPanel = () => ragPanelRef.value?.openDrawer()

defineExpose({ openDrawer })
</script>

<template>
  <!--el-drawer:侧边栏抽屉  v-model:是否显示 Drawer -->
  <el-drawer v-model="drawer" title="设置" size="380px" class="settings-drawer">

    <!-- Model -->
    <div class="setting-item">
      <div class="name-label">Model</div>
      <!--el-select：选择器  -->
      <el-select placeholder="选择模型" v-model="settingStore.settings.model" ><!-- 现在选择的模型 -->
        <!--可选择的模型列表 -->
        <el-option v-for="option in modelOptions" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>
    </div>

    <!-- 流式响应 -->
    <div class="setting-item">
      <div class="for-inline">
        <div class="name-label">
          <span>流式响应</span>
          <el-tooltip content="开启后将流式响应 AI 的回复" placement="top"><!-- placement标签方向在上方 -->
            <el-icon>
              <QuestionFilled />
            </el-icon>
          </el-tooltip>
        </div>
        <el-switch v-model="settingStore.settings.stream"/>
      </div>
    </div>

    <!-- API key -->
    <div class="setting-item">
      <div class="for-inline">
        <div class="name-label">
          <span>API Key</span>
          <el-tooltip content="设置 API Key" placement="top"><!-- placement标签方向在上方 -->
            <el-icon>
              <QuestionFilled />
            </el-icon>
          </el-tooltip>
        </div>
        <!-- target="_blank" 转到一个新页面，而不是直接在旧页面跳转-->
        <a href="https://cloud.siliconflow.cn/account/ak" target="_blank">获取 API Key</a>
      </div>
      <!-- show-password：是否显示切换密码图标 -->
      <el-input placeholder="请输入 API Key" type="password" show-password v-model="settingStore.settings.apiKey" />
    </div>

    <!-- Max Tokens -->
    <div class="setting-item">
      <div class="name-label">
        Max Tokens
        <el-tooltip content="生成文本的最大长度" placement="top">
          <el-icon>
            <QuestionFilled />
          </el-icon>
        </el-tooltip>
      </div>
      <div class="slider-demo-block">
        <!--show-tooltip:滑动的时候上方有显示当前数字  show-input:是否显示输入框-->
        <el-slider v-model="settingStore.settings.maxTokens" show-input :min="1" :max="currentMaxTokens" :step="1" :show-tooltip="false" />
      </div>
    </div>

    <!-- Temperature -->
    <div class="setting-item">
      <div class="name-label">
        Temperature
        <el-tooltip content="值越高，回答越随机" placement="top">
          <el-icon>
            <QuestionFilled />
          </el-icon>
        </el-tooltip>
      </div>
      <div class="slider-demo-block">
        <el-slider v-model="settingStore.settings.temperature" show-input :min="0" :max="2" :step="0.1" :show-tooltip="false" />
      </div>
    </div>

    <!-- Top-P -->
    <div class="setting-item">
      <div class="name-label">
        Top-P
        <el-tooltip content="核采样阈值" placement="top">
          <el-icon>
            <QuestionFilled />
          </el-icon>
        </el-tooltip>
      </div>
      <div class="slider-demo-block">
        <el-slider v-model="settingStore.settings.topP" show-input :min="0" :max="1" :step="0.1" :show-tooltip="false" />
      </div>
    </div>

    <!-- Top-K -->
    <div class="setting-item">
      <div class="name-label">
        Top-K
        <el-tooltip content="保留概率最高的 K 个词" placement="top">
          <el-icon>
            <QuestionFilled />
          </el-icon>
        </el-tooltip>
      </div>
      <div class="slider-demo-block">
        <el-slider v-model="settingStore.settings.topK" show-input :min="1" :max="100" :step="1" :show-tooltip="false" />
      </div>
    </div>

    <!-- RAG 知识库 -->
    <div class="setting-item">
      <div class="for-inline">
        <div class="name-label">
          <span>知识库 (RAG)</span>
          <el-tooltip content="开启后，回答时自动检索已上传文档" placement="top">
            <el-icon><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-switch v-model="settingStore.settings.ragEnabled" />
      </div>
      <el-button
        size="small"
        class="full-width-btn"
        @click="openRagPanel"
      >
        管理知识库文档
      </el-button>
    </div>

    <!-- Agent 模式 -->
    <div class="setting-item">
      <div class="for-inline">
        <div class="name-label">
          <span>Agent 模式 (MCP)</span>
          <el-tooltip content="开启后 AI 可自动调用工具（如查询当前时间），开启时 RAG 开关无效" placement="top">
            <el-icon><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-switch v-model="settingStore.settings.agentEnabled" />
      </div>
      <div v-if="settingStore.settings.agentEnabled" class="agent-tools-tip">
        <div>可用工具：获取当前时间</div>
        <div style="margin-top:4px;color:#e6a23c;">⚠️ 请选择支持工具调用的模型，如 DeepSeek-V3、Qwen3 系列（标注「工具调用」的选项）</div>
      </div>
    </div>
  </el-drawer>

  <RagPanel ref="ragPanelRef" />
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
  padding: 8px 10px 24px;
}

:deep(.el-select__wrapper),
:deep(.el-input__wrapper) {
  min-height: 44px;
  border-radius: 14px;
  box-shadow: none;
  background: rgba(255, 255, 255, 0.9);
}

:deep(.el-slider__runway) {
  height: 8px;
}

:deep(.el-slider__button) {
  width: 16px;
  height: 16px;
}

.setting-item {
  margin: 14px 14px 18px;
  padding: 18px;
  border: 1px solid rgba(116, 132, 160, 0.14);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.74);
  box-shadow: var(--shadow-sm);

  .name-label {
    margin-bottom: 12px;
    color: var(--text-color-primary);
    font-size: 14px;
    font-weight: 600;
  }
}

.for-inline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;

  a {
    color: var(--primary-color);
    text-decoration: none;
    font-weight: 600;
  }
}

.agent-tools-tip {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-secondary);
  background: rgba(255, 247, 230, 0.8);
  border: 1px solid rgba(230, 162, 60, 0.16);
  padding: 10px 12px;
  border-radius: 14px;
}

.full-width-btn {
  margin-top: 10px;
  width: 100%;
  height: 42px;
  border-radius: 14px;
}
</style>
