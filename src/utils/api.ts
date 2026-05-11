//网络请求
import { useSettingStore } from "@/stores/settings.ts";

// 多模态内容块（图片或文本）
interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

// 消息类型：content 可以是纯文本或多模态数组
interface sendMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

//创造网络请求方法
export const createChatCompletion = async (messages:sendMessage[]) => {
    //导入设置仓库
    const settingStore = useSettingStore()
    //发送给后端代理的参数（API Key 由后端从 .env 注入，前端不传）
    const payload = {
        model: settingStore.settings.model,
        messages,
        stream: settingStore.settings.stream,
        max_tokens: settingStore.settings.maxTokens,
        temperature: settingStore.settings.temperature,
        top_p: settingStore.settings.topP,
        top_k: settingStore.settings.topK,
        ragEnabled: settingStore.settings.ragEnabled,
    }
    //配置网络请求选项
    const options = {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
        },
        body:JSON.stringify(payload)
    }
    //发送网络请求并处理响应
    try{
        // 记录开始时间
        const startTime = Date.now()
        //请求本地后端代理，由后端转发至 SiliconFlow
        const response = await fetch('/api/chat', options)
        
        //检查是否错误
        if(!response.ok){
            throw new Error ("HTTP error! status: " + response.status)
        }
        //判断是否需要流式响应
        if (settingStore.settings.stream){
            return response
        }
        else{
            const data = await response.json()
            //计算speed
            const duration = (Date.now()-startTime) /1000
            data.speed = (data.usage.completion_tokens/duration).toFixed(2)
            return data
        }
    }catch(error){
        console.error('Chat API Error:',error)
        throw error
    }

}