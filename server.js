const express = require('express')
const crypto = require('crypto')
const axios = require('axios')
const app = express()

// 飞书 Encrypt Key（如果有的话）
const ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY || ''

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY

// 记录所有收到的请求
app.use((req, res, next) => {
  console.log('\n' + '='.repeat(50))
  console.log('时间:', new Date().toISOString())
  console.log('方法:', req.method)
  console.log('路径:', req.path)
  console.log('Headers:', JSON.stringify(req.headers, null, 2))
  console.log('Raw Body:', req.rawBody?.toString()?.substring(0, 1000))
  console.log('Parsed Body:', JSON.stringify(req.body)?.substring(0, 1000))
  next()
})

// 缓存 token
let cachedToken = null
let tokenExpire = 0

async function getToken() {
  if (cachedToken && Date.now() < tokenExpire) return cachedToken

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  })

  if (res.data.code !== 0) throw new Error('Token 失败')

  cachedToken = res.data.tenant_access_token
  tokenExpire = Date.now() + 7000 * 1000
  return cachedToken
}

async function sendReply(chatId, text) {
  const token = await getToken()

  const res = await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
    receive_id: chatId,
    receive_id_type: 'chat_id',
    msg_type: 'text',
    content: JSON.stringify({ text })
  }, {
    headers: { Authorization: `Bearer ${token}` }
  })

  console.log('发送结果:', JSON.stringify(res.data))
  return res.data
}

async function getAIReply(text) {
  const res = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    model: 'glm-4-flash',
    messages: [
      { role: 'system', content: '你是友好的助手' },
      { role: 'user', content: text }
    ],
    max_tokens: 200
  }, {
    headers: { Authorization: `Bearer ${ZHIPU_API_KEY}` }
  })

  return res.data.choices[0].message.content
}

app.post('/webhook', async (req, res) => {
  console.log('>>> 进入 webhook 处理')

  const body = req.body

  // URL 验证
  if (body.type === 'url_verification') {
    console.log('>>> URL 验证请求，返回 challenge:', body.challenge)

    // 飞书可能需要加密返回
    if (body.encrypt && ENCRYPT_KEY) {
      // 解密逻辑...
    }

    return res.json({ challenge: body.challenge })
  }

  // 事件回调
  if (body.header) {
    console.log('>>> 事件类型:', body.header.event_type)

    if (body.header.event_type === 'im.message.receive_v1') {
      const message = body.event?.message
      const sender = body.event?.sender

      console.log('>>> 消息:', JSON.stringify(message))
      console.log('>>> 发送者:', JSON.stringify(sender))

      // 忽略机器人自己
      if (sender?.sender_id?.type === 'app') {
        return res.json({ code: 0 })
      }

      let text = ''
      try {
        text = JSON.parse(message.content).text || ''
      } catch {
        text = message.content || ''
      }

      console.log('>>> 用户消息:', text)

      if (text) {
        res.json({ code: 0 })

        // 异步回复
        ;(async () => {
          try {
            const reply = await getAIReply(text)
            console.log('>>> AI回复:', reply)
            await sendReply(message.chat_id, reply)
            console.log('>>> 发送成功!')
          } catch (e) {
            console.error('>>> 错误:', e.message)
          }
        })()

        return
      }
    }

    return res.json({ code: 0 })
  }

  console.log('>>> 未知请求格式')
  res.json({ code: 0 })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    env: {
      APP_ID: FEISHU_APP_ID ? '✅' : '❌',
      APP_SECRET: FEISHU_APP_SECRET ? '✅' : '❌',
      ZHIPU_KEY: ZHIPU_API_KEY ? '✅' : '❌'
    }
  })
})

// 捕获所有其他请求
app.use((req, res) => {
  console.log('>>> 未匹配的请求:', req.path)
  res.json({ code: 0 })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('🚀 服务启动，端口:', PORT)
})
