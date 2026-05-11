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
  <el-drawer v-model="drawer" title="设置" size=350px>

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
        style="margin-top: 10px; width: 100%"
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
          <el-tooltip content="开启后 AI 可自动调用工具（查时间、检索知识库等），开启时 RAG 开关无效" placement="top">
            <el-icon><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-switch v-model="settingStore.settings.agentEnabled" />
      </div>
      <div v-if="settingStore.settings.agentEnabled" class="agent-tools-tip">
        <div>可用工具：获取当前时间、知识库检索</div>
        <div style="margin-top:4px;color:#e6a23c;">⚠️ 请选择支持工具调用的模型，如 DeepSeek-V3、Qwen3 系列（标注「工具调用」的选项）</div>
      </div>
    </div>
  </el-drawer>

  <RagPanel ref="ragPanelRef" />
</template>

<style scoped lang="scss">
.setting-item {
  margin: 20px;

  .name-label {
    margin-top: 10px;
    margin-bottom: 10px;
  }
}
.for-inline {
  display: flex;
  justify-content: space-between;
  align-items: center;//弹性盒子垂直居中
  a {
    color: #3f7af1;
    text-decoration: none//a标签:各种线；没有
  }
}
.agent-tools-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  background: #f5f7fa;
  padding: 6px 10px;
  border-radius: 4px;
}
</style>
