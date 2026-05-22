const axios = require('axios')

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY

let accessToken = null
let tokenExpireTime = 0

// 会话历史
const conversationHistories = new Map()

async function getAccessToken() {
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

  throw new Error('获取令牌失败: ' + response.data.msg)
}

async function sendMessage(chatId, content) {
  const token = await getAccessToken()
  
  await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
    receive_id: chatId,
    receive_id_type: 'chat_id',
    msg_type: 'text',
    content: JSON.stringify({ text: content })
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
}

async function askZhipu(message, history = []) {
  const messages = [
    { role: 'system', content: '你是一个友好的智能助手，请简洁回答用户问题。' },
    ...history,
    { role: 'user', content: message }
  ]

  const response = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    model: 'glm-4-flash',
    messages: messages,
    max_tokens: 1024
  }, {
    headers: {
      'Authorization': `Bearer ${ZHIPU_API_KEY}`,
      'Content-Type': 'application/json'
    }
  })

  return response.data.choices[0].message.content
}

async function pollEvents() {
  const token = await getAccessToken()
  
  try {
    const response = await axios.post('https://open.feishu.cn/open-apis/event/v1/poll', {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    })

    if (response.data.code === 0 && response.data.data?.events) {
      return response.data.data.events
    }
    return []
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return []
    }
    throw error
  }
}

async function handleEvent(event) {
  console.log('收到事件:', event.header?.event_type)
  
  if (event.header?.event_type === 'im.message.receive_v1') {
    const message = event.event?.message
    if (!message) return

    // 忽略机器人自己的消息
    if (message.sender_id?.type === 'app') return

    let userMessage = ''
    try {
      const content = JSON.parse(message.content)
      userMessage = content.text || ''
    } catch (e) {
      userMessage = message.content
    }

    if (!userMessage) return

    console.log('用户消息:', userMessage)

    const chatId = message.chat_id
    let history = conversationHistories.get(chatId) || []

    try {
      const reply = await askZhipu(userMessage, history)
      
      history.push({ role: 'user', content: userMessage })
      history.push({ role: 'assistant', content: reply })
      conversationHistories.set(chatId, history.slice(-20))

      await sendMessage(chatId, reply)
      console.log('已回复:', reply.substring(0, 50) + '...')
    } catch (error) {
      console.error('处理错误:', error.message)
      await sendMessage(chatId, '抱歉，处理出错：' + error.message)
    }
  }
}

async function main() {
  console.log('飞书机器人长连接服务启动...')
  console.log('App ID:', FEISHU_APP_ID)
  console.log('等待消息中...\n')

  while (true) {
    try {
      const events = await pollEvents()
      for (const event of events) {
        await handleEvent(event)
      }
    } catch (error) {
      console.error('轮询错误:', error.message)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

main()
