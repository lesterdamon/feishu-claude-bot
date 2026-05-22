const axios = require('axios')

const FEISHU_APP_ID = 'cli_aa9ab6310c3b9bd8'
const FEISHU_APP_SECRET = 'klgDsUGJx2umsHR4hnxpKbB2e8d5XUz2'
const ZHIPU_API_KEY = '6d4ef7ab0a1043c7b5d9c1535fba9763.yJBn5PYbJsxL2i3S'

let accessToken = null
let tokenExpireTime = 0
const conversationHistories = new Map()

async function getToken() {
  if (accessToken && Date.now() < tokenExpireTime) return accessToken

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  })

  accessToken = res.data.tenant_access_token
  tokenExpireTime = Date.now() + 7000 * 1000
  return accessToken
}

async function sendMsg(chatId, text) {
  const token = await getToken()
  await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
    receive_id: chatId,
    receive_id_type: 'chat_id',
    msg_type: 'text',
    content: JSON.stringify({ text })
  }, {
    headers: { Authorization: `Bearer ${token}` }
  })
}

async function askZhipu(msg, history = []) {
  const messages = [
    { role: 'system', content: '你是友好助手' },
    ...history,
    { role: 'user', content: msg }
  ]
  const res = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    model: 'glm-4-flash',
    messages,
    max_tokens: 1024
  }, {
    headers: { Authorization: `Bearer ${ZHIPU_API_KEY}` }
  })
  return res.data.choices[0].message.content
}

async function pollEvents() {
  const token = await getToken()
  try {
    const res = await axios.post('https://open.feishu.cn/open-apis/event/v1/poll', {}, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 25000
    })
    return res.data.data?.events || []
  } catch (e) {
    if (e.code === 'ECONNABORTED') return []
    throw e
  }
}

async function handleEvent(event) {
  if (event.header?.event_type !== 'im.message.receive_v1') return

  const msg = event.event?.message
  if (!msg || msg.sender_id?.type === 'app') return

  let text = ''
  try { text = JSON.parse(msg.content).text || '' } catch { text = msg.content }
  if (!text) return

  console.log('📩 用户消息:', text)

  const chatId = msg.chat_id
  let history = conversationHistories.get(chatId) || []

  try {
    const reply = await askZhipu(text, history)
    history.push({ role: 'user', content: text })
    history.push({ role: 'assistant', content: reply })
    conversationHistories.set(chatId, history.slice(-20))
    await sendMsg(chatId, reply)
    console.log('✅ 已回复')
  } catch (e) {
    console.error('❌ 错误:', e.message)
    await sendMsg(chatId, '出错了: ' + e.message)
  }
}

async function main() {
  console.log('🚀 轮询服务启动...')
  console.log('📱 等待消息...\n')

  while (true) {
    try {
      const events = await pollEvents()
      for (const e of events) await handleEvent(e)
    } catch (e) {
      console.error('轮询错误:', e.message)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

main()
