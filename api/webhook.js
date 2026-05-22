const axios = require('axios')

export default async function handler(req, res) {
  console.log('=== 收到请求 ===')
  console.log('Method:', req.method)

  try {
    // 检查环境变量
    const FEISHU_APP_ID = process.env.FEISHU_APP_ID
    const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
    const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY

    console.log('环境变量:', {
      FEISHU_APP_ID: FEISHU_APP_ID ? '已设置' : '未设置',
      FEISHU_APP_SECRET: FEISHU_APP_SECRET ? '已设置' : '未设置',
      ZHIPU_API_KEY: ZHIPU_API_KEY ? '已设置' : '未设置'
    })

    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !ZHIPU_API_KEY) {
      return res.status(500).json({ error: '环境变量未设置' })
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const body = req.body
    console.log('Body:', JSON.stringify(body).substring(0, 500))

    // URL 验证
    if (body.type === 'url_verification') {
      console.log('URL 验证')
      return res.json({ challenge: body.challenge })
    }

    // 消息事件
    if (body.header?.event_type === 'im.message.receive_v1') {
      console.log('消息事件')

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
        return res.json({ code: 0, msg: 'empty message' })
      }

      // 获取飞书 token
      console.log('获取飞书 token...')
      const tokenRes = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET
      })

      if (tokenRes.data.code !== 0) {
        console.error('获取 token 失败:', tokenRes.data)
        return res.json({ code: -1, msg: 'token failed' })
      }

      const token = tokenRes.data.tenant_access_token
      console.log('Token 获取成功')

      // 调用智谱 AI
      console.log('调用智谱 AI...')
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

      // 发送回复
      console.log('发送飞书消息...')
      await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
        receive_id: message.chat_id,
        receive_id_type: 'chat_id',
        msg_type: 'text',
        content: JSON.stringify({ text: reply })
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      console.log('消息发送成功')
      return res.json({ code: 0, msg: 'success', reply: reply.substring(0, 50) })
    }

    return res.json({ code: 0, msg: 'unknown event' })

  } catch (error) {
    console.error('错误:', error.message)
    console.error('堆栈:', error.stack)
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    })
  }
}
