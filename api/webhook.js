const axios = require('axios')

// 飞书配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET

// 智谱 AI 配置
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || 'glm-4-flash'

console.log('环境变量检查:', {
  hasAppId: !!FEISHU_APP_ID,
  hasAppSecret: !!FEISHU_APP_SECRET,
  hasZhipuKey: !!ZHIPU_API_KEY
})

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

// 会话历史存储
const conversationHistories = new Map()

export default async function handler(req, res) {
  try {
    // 只接受 POST 请求
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const body = req.body
    console.log('收到请求:', JSON.stringify(body).substring(0, 500))

    // 处理 URL 验证
    if (body.type === 'url_verification') {
      console.log('URL 验证请求')
      return res.json({ challenge: body.challenge })
    }

    // 处理消息事件
    if (body.header?.event_type === 'im.message.receive_v1') {
      console.log('收到消息事件')
      const event = body.event
      const message = event?.message

      if (!message) {
        console.log('没有消息内容')
        return res.json({ code: 0, msg: 'success' })
      }

      // 忽略机器人自己发送的消息
      if (message.sender_id?.type === 'app') {
        console.log('忽略机器人自己的消息')
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
        const mentions = message.mentions || []
        const isMentioned = mentions.some(m => m.id === FEISHU_APP_ID || m.name?.includes('助手'))
        if (!isMentioned && !userMessage.includes('@')) {
          return res.json({ code: 0, msg: 'success' })
        }
        userMessage = userMessage.replace(/@[^\s]+\s?/g, '').trim()
      }

      if (!userMessage) {
        return res.json({ code: 0, msg: 'success' })
      }

      console.log('用户消息:', userMessage)

      // 获取会话历史
      const chatId = message.chat_id
      let history = conversationHistories.get(chatId) || []

      // 先返回响应，再异步处理
      res.json({ code: 0, msg: 'success' })

      // 异步处理回复
      try {
        const reply = await askZhipu(userMessage, history)

        history.push({ role: 'user', content: userMessage })
        history.push({ role: 'assistant', content: reply })
        if (history.length > 20) {
          history = history.slice(-20)
        }
        conversationHistories.set(chatId, history)

        await sendFeishuMessage(message.chat_id, 'chat_id', reply)
        console.log('已发送回复')
      } catch (error) {
        console.error('处理消息错误:', error.message)
        await sendFeishuMessage(message.chat_id, 'chat_id', '抱歉，处理您的请求时出错了：' + error.message)
      }

      return
    }

    res.json({ code: 0, msg: 'success' })
  } catch (error) {
    console.error('处理请求错误:', error)
    res.status(500).json({ error: error.message })
  }
}
