import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { retrieveChunks } from './rag.js'

const server = new McpServer({
  name: 'llm-agent-server',
  version: '1.0.0',
})

// 工具 1: 获取当前时间
server.registerTool(
  'get_current_time',
  {
    description: '获取当前系统时间，当用户询问现在几点、今天日期等时间相关问题时使用',
  },
  async () => {
    const now = new Date()
    return {
      content: [{
        type: 'text',
        text: `当前时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      }],
    }
  }
)

// 工具 2: 知识库检索（接入真实 ChromaDB）
server.registerTool(
  'retrieve_knowledge',
  {
    description: '从本地知识库中检索与问题相关的内容。当用户询问可能在上传文档中有答案的问题时使用',
    inputSchema: {
      query: z.string().describe('用于检索的查询语句，尽量提炼关键词'),
      topK: z.number().optional().describe('返回的结果数量，默认 3'),
    },
  },
  async ({ query, topK = 3 }) => {
    const apiKey = process.env.LLM_API_KEY
    if (!apiKey) {
      return {
        content: [{ type: 'text', text: '错误：未配置 LLM_API_KEY，无法执行知识库检索' }],
      }
    }

    try {
      //从知识库检索相关内容
      const chunks = await retrieveChunks(query, apiKey)
      if (chunks.length === 0) {
        return {
          content: [{ type: 'text', text: '知识库中未找到与该问题相关的内容' }],
        }
      }

      const result = chunks
        .slice(0, topK)
        .map((c, i) => `[${i + 1}] 来源: ${c.docName}\n${c.text}`)
        .join('\n\n')

      return {
        content: [{ type: 'text', text: result }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `检索失败: ${err.message}` }],
      }
    }
  }
)

// 启动 MCP Server（stdio 传输）
const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[mcp-server] running on stdio')
