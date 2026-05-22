const express = require('express')
const axios = require('axios')
const app = express()

app.use(express.json())

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY

// 飞书 token 缓存
let cachedToken = null
let tokenExpire = 0

async function getToken() {
  if (cachedToken && Date.now() < tokenExpire) {
    return cachedToken
  }

  console.log('获取新 token...')
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  })

  if (res.data.code !== 0) {
    throw new Error('Token 失败: ' + JSON.stringify(res.data))
  }

  cachedToken = res.data.tenant_access_token
  tokenExpire = Date.now() + 7000 * 1000
  console.log('Token 获取成功')
  return cachedToken
}

async function sendReply(chatId, openId, text) {
  const token = await getToken()

  // 尝试用 chat_id 发送
  const payload = {
    receive_id_type: 'chat_id',
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text })
  }

  console.log('发送消息，payload:', JSON.stringify(payload))

  try {
    const res = await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })

    console.log('发送结果:', JSON.stringify(res.data))

    if (res.data.code !== 0) {
      console.error('发送失败:', JSON.stringify(res.data))
    }

    return res.data
  } catch (e) {
    console.error('发送异常:', e.response?.data || e.message)
    throw e
  }
}

async function getAIReply(text) {
  console.log('调用智谱 AI...')
  const res = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    model: 'glm-4-flash',
    messages: [
      { role: 'system', content: '你是友好的智能助手' },
      { role: 'user', content: text }
    ],
    max_tokens: 200
  }, {
    headers: { Authorization: `Bearer ${ZHIPU_API_KEY}` }
  })

  return res.data.choices[0].message.content
}

app.post('/webhook', async (req, res) => {
  console.log('\n========== 收到请求 ==========')
  console.log('Headers:', JSON.stringify(req.headers).substring(0, 500))
  console.log('Body:', JSON.stringify(req.body).substring(0, 1000))

  try {
    const body = req.body

    // URL 验证
    if (body.type === 'url_verification') {
      console.log('URL 验证，返回 challenge')
      return res.json({ challenge: body.challenge })
    }

    // 消息事件
    if (body.header?.event_type === 'im.message.receive_v1') {
      console.log('✅ 这是消息事件')

      const event = body.event
      const sender = event?.sender
      const message = event?.message

      console.log('Sender:', JSON.stringify(sender))
      console.log('Message:', JSON.stringify(message))

      if (!message) {
        console.log('❌ 没有消息内容')
        return res.json({ code: 0 })
      }

      // 忽略机器人自己的消息
      if (sender?.sender_id?.type === 'app') {
        console.log('⚠️ 忽略机器人自己的消息')
        return res.json({ code: 0 })
      }

      // 解析消息
      let userText = ''
      try {
        const content = JSON.parse(message.content)
        userText = content.text || ''
      } catch {
        userText = message.content || ''
      }

      console.log('📝 用户消息:', userText)

      if (!userText) {
        return res.json({ code: 0 })
      }

      // 先响应飞书
      res.json({ code: 0, msg: 'received' })

      // 异步处理回复
      ;(async () => {
        try {
          const reply = await getAIReply(userText)
          console.log('🤖 AI 回复:', reply)

          await sendReply(message.chat_id, sender?.sender_id?.open_id, reply)
          console.log('✅ 回复发送成功')
        } catch (e) {
          console.error('❌ 处理失败:', e.message)
        }
      })()

      return
    }

    console.log('⚠️ 未知事件类型')
    res.json({ code: 0 })

  } catch (e) {
    console.error('❌ 请求处理错误:', e)
    res.json({ code: 0 })
  }
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: {
      FEISHU_APP_ID: FEISHU_APP_ID ? '✅' : '❌',
      FEISHU_APP_SECRET: FEISHU_APP_SECRET ? '✅' : '❌',
      ZHIPU_API_KEY: ZHIPU_API_KEY ? '✅' : '❌'
    }
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('🚀 服务启动，端口:', PORT)
  console.log('环境变量:', {
    FEISHU_APP_ID: FEISHU_APP_ID ? '✅' : '❌',
    FEISHU_APP_SECRET: FEISHU_APP_SECRET ? '✅' : '❌',
    ZHIPU_API_KEY: ZHIPU_API_KEY ? '✅' : '❌'
  })
})
