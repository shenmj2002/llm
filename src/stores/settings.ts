import { ref} from 'vue'
import { defineStore } from 'pinia'//定义一个store

//创建叫useSettingStore的pinia仓库  llm-setting:这个store的id，标识这个 Store
export const useSettingStore = defineStore('llm-setting', 
  () => {
  // 创建响应式对象settings
  const settings = ref({
    model: 'deepseek-ai/DeepSeek-R1', 
    apiKey: '', 
    stream: true,
    maxTokens: 4096, 
    temperature: 0.7, 
    topP: 0.7, 
    topK: 50,
    ragEnabled: false,
  })

  return { settings }// 暴露状态供组件使用
},

{
    persist: true, // 开启数据持久化（自动将状态保存到本地存储，如 localStorage）
}
)

//设置里model的下拉菜单:创建 普通的 modelOptions对象，不在pinia仓库里
export const modelOptions = [
  {
    label: 'DeepSeek-R1',
    value: 'deepseek-ai/DeepSeek-R1',
    maxTokens: 16384,
  },
  {
    label: 'DeepSeek-V3',
    value: 'deepseek-ai/DeepSeek-V3',
    maxTokens: 4096,
  },
  {
    label: 'DeepSeek-V2.5',
    value: 'deepseek-ai/DeepSeek-V2.5',
    maxTokens: 4096,
  },
  {
    label: 'Qwen2.5-72B-Instruct-128K',
    value: 'Qwen/Qwen2.5-72B-Instruct-128K',
    maxTokens: 4096,
  },
  {
    label: 'QwQ-32B-Preview',
    value: 'Qwen/QwQ-32B-Preview',
    maxTokens: 8192,
  },
  {
    label: 'glm-4-9b-chat',
    value: 'THUDM/glm-4-9b-chat',
    maxTokens: 4096,
  },
  {
    label: 'glm-4-9b-chat(Pro)',
    value: 'Pro/THUDM/glm-4-9b-chat',
    maxTokens: 4096,
  },
  {
    label: 'Qwen3-VL-32B (视觉)',
    value: 'Qwen/Qwen3-VL-32B-Instruct',
    maxTokens: 8192,
  },
  {
    label: 'Qwen3-VL-32B-Thinking (视觉·推理)',
    value: 'Qwen/Qwen3-VL-32B-Thinking',
    maxTokens: 8192,
  },
  {
    label: 'Qwen3-VL-8B (视觉·快)',
    value: 'Qwen/Qwen3-VL-8B-Instruct',
    maxTokens: 8192,
  },
  {
    label: 'Qwen3-VL-8B-Thinking (视觉·推理·快)',
    value: 'Qwen/Qwen3-VL-8B-Thinking',
    maxTokens: 8192,
  },
]

