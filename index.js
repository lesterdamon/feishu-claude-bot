require('dotenv').config()
const express = require('express')
const axios = require('axios')
const crypto = require('crypto')

const app = express()
app.use(express.json())

// 飞书配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET

// 智谱 AI 配置
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || 'glm-4-flash'

// 飞书访问令牌缓存
let accessToken = null
let tokenExpireTime = 0

// 获取飞书访问令牌
async function getFeishuAccessToken() {
  if (accessToken && Date.now() < tokenExpireTime) {
    return accessToken
  }

  const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  })

  if (response.data.code === 0) {
    accessToken = response.data.tenant_access_token
    tokenExpireTime = Date.now() + (response.data.expire - 60) * 1000
    return accessToken
  }

  throw new Error('获取飞书访问令牌失败: ' + response.data.msg)
}

// 发送消息到飞书
async function sendFeishuMessage(receiveId, receiveIdType, content) {
  const token = await getFeishuAccessToken()

  await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
    receive_id: receiveId,
    receive_id_type: receiveIdType,
    msg_type: 'text',
    content: JSON.stringify({ text: content })
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
}

// 调用智谱 AI API
async function askZhipu(message, conversationHistory = []) {
  const messages = [
    {
      role: 'system',
      content: '你是一个智能助手，友好、专业、乐于助人。请用简洁清晰的语言回答用户的问题。'
    },
    ...conversationHistory,
    { role: 'user', content: message }
  ]

  const response = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    model: ZHIPU_MODEL,
    messages: messages,
    max_tokens: 2048,
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${ZHIPU_API_KEY}`,
      'Content-Type': 'application/json'
    }
  })

  return response.data.choices[0].message.content
}

// 会话历史存储（简单实现，生产环境应使用数据库）
const conversationHistories = new Map()

// 飞书事件回调
app.post('/webhook', async (req, res) => {
  const { headers, body } = req

  // 处理 URL 验证
  if (body.type === 'url_verification') {
    console.log('URL 验证请求:', body.challenge)
    return res.json({ challenge: body.challenge })
  }

  // 处理消息事件
  if (body.header?.event_type === 'im.message.receive_v1') {
    const event = body.event
    const message = event.message

    // 忽略机器人自己发送的消息
    if (message.sender_id.type === 'app') {
      return res.json({ code: 0, msg: 'success' })
    }

    // 解析消息内容
    let userMessage = ''
    try {
      const content = JSON.parse(message.content)
      userMessage = content.text || ''
    } catch (e) {
      userMessage = message.content
    }

    // 检查是否是群聊消息且被 @
    const isGroupChat = message.chat_type === 'group'
    if (isGroupChat) {
      // 群聊需要被 @ 才响应
      const mentions = message.mentions || []
      const isMentioned = mentions.some(m => m.id === FEISHU_APP_ID || m.name?.includes('助手'))
      if (!isMentioned && !userMessage.includes('@')) {
        return res.json({ code: 0, msg: 'success' })
      }
      // 移除 @ 部分
      userMessage = userMessage.replace(/@[^\s]+\s?/g, '').trim()
    }

    if (!userMessage) {
      return res.json({ code: 0, msg: 'success' })
    }

    console.log('收到消息:', userMessage)

    // 获取会话历史
    const chatId = message.chat_id
    let history = conversationHistories.get(chatId) || []

    // 异步处理回复
    ; (async () => {
      try {
        const reply = await askZhipu(userMessage, history)

        // 更新会话历史
        history.push({ role: 'user', content: userMessage })
        history.push({ role: 'assistant', content: reply })
        // 保留最近 20 条消息
        if (history.length > 20) {
          history = history.slice(-20)
        }
        conversationHistories.set(chatId, history)

        // 发送回复
        await sendFeishuMessage(
          message.chat_id,
          'chat_id',
          reply
        )
        console.log('回复已发送')
      } catch (error) {
        console.error('处理消息错误:', error.message)
        await sendFeishuMessage(
          message.chat_id,
          'chat_id',
          '抱歉，处理您的请求时出错了：' + error.message
        )
      }
    })()

    return res.json({ code: 0, msg: 'success' })
  }

  res.json({ code: 0, msg: 'success' })
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`飞书智能助手服务已启动，端口: ${PORT}`)
  console.log(`Webhook 地址: http://your-server:${PORT}/webhook`)
  console.log(`使用模型: ${ZHIPU_MODEL}`)
})
