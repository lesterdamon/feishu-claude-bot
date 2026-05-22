const express = require('express')
const axios = require('axios')
const app = express()

app.use(express.json())

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY

app.post('/webhook', async (req, res) => {
  console.log('=== 收到请求 ===')

  try {
    console.log('环境变量:', {
      FEISHU_APP_ID: FEISHU_APP_ID ? '已设置' : '未设置',
      FEISHU_APP_SECRET: FEISHU_APP_SECRET ? '已设置' : '未设置',
      ZHIPU_API_KEY: ZHIPU_API_KEY ? '已设置' : '未设置'
    })

    const body = req.body
    console.log('Body:', JSON.stringify(body).substring(0, 300))

    // URL 验证
    if (body.type === 'url_verification') {
      console.log('URL 验证请求')
      return res.json({ challenge: body.challenge })
    }

    // 消息事件
    if (body.header?.event_type === 'im.message.receive_v1') {
      console.log('收到消息事件')
      const message = body.event?.message

      if (!message) {
        return res.json({ code: 0, msg: 'no message' })
      }

      // 忽略机器人消息
      if (body.event?.sender?.sender_id?.type === 'app') {
        return res.json({ code: 0, msg: 'ignore bot' })
      }

      // 解析消息
      let userMessage = ''
      try {
        const content = JSON.parse(message.content)
        userMessage = content.text || ''
      } catch (e) {
        userMessage = message.content || ''
      }

      console.log('用户消息:', userMessage)
      if (!userMessage) {
        return res.json({ code: 0, msg: 'empty' })
      }

      // 先返回响应
      res.json({ code: 0, msg: 'success' })

      // 异步处理
      try {
        // 获取 token
        const tokenRes = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
          app_id: FEISHU_APP_ID,
          app_secret: FEISHU_APP_SECRET
        })

        const token = tokenRes.data.tenant_access_token
        console.log('Token 获取成功')

        // 调用智谱
        const zhipuRes = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          model: 'glm-4-flash',
          messages: [
            { role: 'system', content: '你是友好助手' },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 500
        }, {
          headers: { Authorization: `Bearer ${ZHIPU_API_KEY}` }
        })

        const reply = zhipuRes.data.choices[0].message.content
        console.log('AI 回复:', reply.substring(0, 100))

        // 发送消息
        await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
          receive_id: message.chat_id,
          receive_id_type: 'chat_id',
          msg_type: 'text',
          content: JSON.stringify({ text: reply })
        }, {
          headers: { Authorization: `Bearer ${token}` }
        })

        console.log('✅ 消息发送成功')
      } catch (err) {
        console.error('❌ 处理错误:', err.message)
      }

      return
    }

    res.json({ code: 0, msg: 'ok' })
  } catch (error) {
    console.error('❌ 请求错误:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 服务启动，端口: ${PORT}`)
  console.log('环境变量检查:', {
    FEISHU_APP_ID: FEISHU_APP_ID ? '✅' : '❌',
    FEISHU_APP_SECRET: FEISHU_APP_SECRET ? '✅' : '❌',
    ZHIPU_API_KEY: ZHIPU_API_KEY ? '✅' : '❌'
  })
})
