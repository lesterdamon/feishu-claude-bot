const lark = require('@larksuiteoapi/node-sdk')
const axios = require('axios')

// 配置
const FEISHU_APP_ID = 'cli_aa9ab6310c3b9bd8'
const FEISHU_APP_SECRET = 'klgDsUGJx2umsHR4hnxpKbB2e8d5XUz2'
const ZHIPU_API_KEY = '6d4ef7ab0a1043c7b5d9c1535fba9763.yJBn5PYbJsxL2i3S'

// 会话历史
const conversationHistories = new Map()

// 创建飞书客户端
const client = new lark.Client({
  appId: FEISHU_APP_ID,
  appSecret: FEISHU_APP_SECRET,
  domain: lark.Domain.Feishu
})

// 智谱 AI
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

// 发送消息
async function sendMessage(chatId, content) {
  await client.im.message.create({
    params: {
      receive_id_type: 'chat_id'
    },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: content })
    }
  })
}

// 处理消息
async function handleMessage(data) {
  console.log('\n收到事件:', JSON.stringify(data).substring(0, 300))

  if (data.header?.event_type !== 'im.message.receive_v1') return

  const message = data.event?.message
  const sender = data.event?.sender

  if (!message) return

  // 忽略机器人自己的消息
  if (sender?.sender_id?.type === 'app') {
    return
  }

  let userMessage = ''
  try {
    const content = JSON.parse(message.content)
    userMessage = content.text || ''
  } catch (e) {
    userMessage = message.content
  }

  // 群聊需要 @
  if (message.chat_type === 'group') {
    const mentions = message.mentions || []
    const isMentioned = mentions.some(m => m.id === FEISHU_APP_ID || m.name?.includes('助手'))
    if (!isMentioned) return
    userMessage = userMessage.replace(/@[^\s]+\s?/g, '').trim()
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
    console.log('✅ 已回复:', reply.substring(0, 50) + '...')
  } catch (error) {
    console.error('❌ 处理错误:', error.message)
    await sendMessage(chatId, '抱歉，处理出错：' + error.message)
  }
}

// 启动 WebSocket
async function start() {
  console.log('====================================')
  console.log('   飞书智能助手机器人启动中...')
  console.log('====================================')
  console.log('App ID:', FEISHU_APP_ID)
  console.log('正在连接飞书服务器...\n')

  // 创建事件分发器
  const eventDispatcher = new lark.EventDispatcher({})
  eventDispatcher.register({
    'im.message.receive_v1': handleMessage
  })

  // 创建 WebSocket 客户端
  const wsClient = new lark.WSClient({
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    domain: lark.Domain.Feishu
  })

  // 连接并监听事件
  await wsClient.start({
    eventDispatcher: eventDispatcher
  })

  console.log('✅ WebSocket 已连接！')
  console.log('📱 现在可以在飞书给机器人发消息了')
  console.log('⏳ 等待消息中...\n')
}

start().catch(err => {
  console.error('❌ 启动失败:', err.message)
  process.exit(1)
})
