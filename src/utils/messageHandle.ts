//messageHandle:将各种函数封装的对象,将得到的response进行处理
export const messageHandle = {
    //创建标准格式的消息对象
    formatMessage(role: "user" | "assistant", content: string, reasoning_content : string, files :File[]) {
        return {
            id: Date.now(),
            role,
            content,
            reasoning_content,
            files,
            completion_tokens: "0",
            speed: "0",
        }
    },
    // 处理流式响应
    //response：从服务器返回的流式响应
    //updateCallback：一个回调函数，用于将解析后的实时数据传递给UI 层更新界面
    async handleStreamResponse(response: Response, updateCallback: Function) {
        //创建读取器，逐块读取流式数据
        const reader = response.body?.getReader()
        if (!reader) return;
        //创建解码器，将二进制数据转换为可读的 UTF-8 字符串
        const decoder = new TextDecoder()
        // 累积的文本内容
        let accumlatedContent = " "
        // 累积的推理内容
        let accumlatedReasoning = " "
        // 记录开始时间，用于计算速度
        let startTime = Date.now()

        //一直循环，直到break
        while (true) {
            // 异步读取数据块，返回一个包含done和value的对象
            const { done, value } = await reader.read()
            // 数据读取完毕，退出循环
            if (done) break
            // 解码二进制数据为字符串
            const chunk = decoder.decode(value)
            //split:将字符串chunk按换行符\n分割成数组,filter:过滤掉数组中空字符串或只有空格的字符串
            const lines = chunk.split("\n").filter((line) => line.trim() !== " ")

            for (const line of lines) {
                // 跳过结束标记
                if (line === 'data: [DONE]') continue
                // 如果是以"data: "开头的数组元素
                if (line.startsWith("data:")) {
                    //移除前五个字符data:，并把JSON转换成js
                    const data = JSON.parse(line.slice(5))
                    // 提取文本内容
                    const content = data.choices[0].delta.content || ""
                    // 提取推理内容
                    const reasoning = data.choices[0].delta.reasoning_content || ""
                    // 拼接实时内容
                    accumlatedContent += content
                    // 拼接推理内容
                    accumlatedReasoning += reasoning

                    // 通过回调更新消息
                    updateCallback(
                        accumlatedContent,
                        accumlatedReasoning,
                        // 已生成的token数量
                        data.usage?.completion_tokens || 0,
                        // 生成速度（token/秒
                        ((data.usage?.completion_tokens || 0) / ((Date.now() - startTime) / 1000)).toFixed(2),
                    )
                }
            }
        }
    },

    //处理非流式响应
    handleNormalResponse(response: any, updateCallback: Function) {
        updateCallback(
            response.choices[0].message.content,
            response.choices[0].message.reasoning_content || "",
            response.usage.completion_tokens,
            response.speed
        )
    },

    //统一的响应处理函数
    async handleResponse(response: Response, isStream:boolean, updateCallback: Function) {
        if (isStream) {
            await this.handleStreamResponse(response, updateCallback)
        }
        else {
            this.handleNormalResponse(response, updateCallback)
        }
    },

    // 处理 Agent 模式的 SSE 事件流
    // updateCallback: (content, reasoning, tokens, speed) => void  — 更新消息内容
    // toolCallback: (event: 'start'|'done', name, extra) => void  — 更新工具调用状态
    async handleAgentStream(
        response: Response,
        updateCallback: Function,
        toolCallback: Function,
    ) {
        const reader = response.body?.getReader()
        if (!reader) return
        const decoder = new TextDecoder()
        let accContent = ''
        let accReasoning = ''
        let totalTokens = 0
        const startTime = Date.now()

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data:')) continue
                try {
                    const event = JSON.parse(line.slice(5))
                    switch (event.type) {
                        case 'tool_start':
                            toolCallback('start', event.name, event.args)
                            break
                        case 'tool_done':
                            toolCallback('done', event.name, event.result)
                            break
                        case 'token':
                            accContent += event.content || ''
                            accReasoning += event.reasoning || ''
                            if (event.usage?.completion_tokens) {
                                totalTokens = event.usage.completion_tokens
                            }
                            updateCallback(
                                accContent,
                                accReasoning,
                                totalTokens,
                                (totalTokens / ((Date.now() - startTime) / 1000)).toFixed(2),
                            )
                            break
                        case 'error':
                            throw new Error(event.message || 'Agent error')
                    }
                } catch (e: any) {
                    if (e.message?.includes('Agent error')) throw e
                }
            }
        }
    },
}