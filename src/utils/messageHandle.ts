//messageHandle:将各种函数封装的对象,将得到的response进行处理
export const messageHandle = {
    //创建标准格式的消息对象，loading 控制是否显示"生成中"状态
    formatMessage(role: "user" | "assistant", content: string, reasoning_content: string, files: File[], loading = false) {
        return {
            id: Date.now(),
            role,
            content,
            reasoning_content,
            files,
            completion_tokens: "0",
            speed: "0",
            loading,
        }
    },

    // 处理流式响应
    // response：从服务器返回的流式响应
    // updateCallback：解析后的实时数据传递给 UI 层更新界面
    // sourcesCallback：RAG 来源事件到达时回调（可选）
    async handleStreamResponse(response: Response, updateCallback: Function, sourcesCallback?: Function) {
        const reader = response.body?.getReader()
        if (!reader) return
        const decoder = new TextDecoder()
        let accumlatedContent = " "
        let accumlatedReasoning = " "
        let startTime = Date.now()

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            const lines = chunk.split("\n").filter((line) => line.trim() !== " ")

            for (const line of lines) {
                if (line === 'data: [DONE]') continue
                if (line.startsWith("data:")) {
                    try {
                        const data = JSON.parse(line.slice(5))

                        // RAG 来源事件：在 LLM 流式输出前到达，立即通知 UI
                        if (data.type === 'rag_sources') {
                            const list = (data.citations?.length ? data.citations : data.sources) || []
                            sourcesCallback?.(list)
                            continue
                        }

                        const content = data.choices?.[0]?.delta?.content || ""
                        const reasoning = data.choices?.[0]?.delta?.reasoning_content || ""
                        accumlatedContent += content
                        accumlatedReasoning += reasoning

                        updateCallback(
                            accumlatedContent,
                            accumlatedReasoning,
                            data.usage?.completion_tokens || 0,
                            ((data.usage?.completion_tokens || 0) / ((Date.now() - startTime) / 1000)).toFixed(2),
                        )
                    } catch { /* 忽略解析失败的行 */ }
                }
            }
        }
    },

    //处理非流式响应
    handleNormalResponse(response: any, updateCallback: Function, sourcesCallback?: Function) {
        updateCallback(
            response.choices[0].message.content,
            response.choices[0].message.reasoning_content || "",
            response.usage.completion_tokens,
            response.speed
        )
        // 非流式：来源附在响应体的 rag_sources 字段
        if (sourcesCallback && response.rag_sources?.length) {
            sourcesCallback(response.rag_sources)
        }
    },

    //统一的响应处理函数
    async handleResponse(response: Response, isStream: boolean, updateCallback: Function, sourcesCallback?: Function) {
        if (isStream) {
            await this.handleStreamResponse(response, updateCallback, sourcesCallback)
        } else {
            this.handleNormalResponse(response, updateCallback, sourcesCallback)
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
