import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const BASE_URL = "http://ВАШ_IP:1235"

let memoryChats = []

const formatChatTranscript = (messages) => {
  return messages.map((m) => (m.role === "user" ? "Вы: " : "ИИ: ") + m.content).join("\n\n")
}

const cleanOutputText = (rawText) => {
  return String(rawText || "").replace(/[\u4e00-\u9fff]/g, "").replace(/[*#_`~]/g, "").trim()
}

AppSideService({
  onInit() {
    messageBuilder.listen(() => {})
    messageBuilder.on("request", (ctx) => {
      const jsonRpc = messageBuilder.buf2Json(ctx.request.payload)

      if (jsonRpc.method === "GET_MODELS") {
        fetch({ url: BASE_URL + "/v1/models", method: "GET", timeout: 4000 })
          .then((res) => {
            const d = typeof res.body === "string" ? JSON.parse(res.body) : res.body
            const list = (d && Array.isArray(d.data) ? d.data : []).map((m) => m.id).filter((id) => id && !id.toLowerCase().includes("embed"))
            ctx.response({ data: { models: list.length ? list : Array.of("qwen2.5-7b-instruct") } })
          }).catch(() => ctx.response({ data: { models: Array.of("qwen2.5-7b-instruct") } }))
      }

      if (jsonRpc.method === "GET_CHATS") {
        ctx.response({ data: { chats: memoryChats.map((c) => ({ id: c.id, title: c.title })) } })
      }

      if (jsonRpc.method === "OPEN_CHAT") {
        const found = memoryChats.find((c) => c.id === jsonRpc.params.chatId)
        ctx.response({ data: { transcript: found ? formatChatTranscript(found.messages) : "", lastPrompt: found ? found.lastPrompt : "" } })
      }

      if (jsonRpc.method === "DELETE_CHAT") {
        memoryChats = memoryChats.filter((c) => c.id !== jsonRpc.params.chatId)
        ctx.response({ data: { chats: memoryChats.map((c) => ({ id: c.id, title: c.title })) } })
      }

      if (jsonRpc.method === "ASK_AI") {
        const cleanPrompt = decodeURIComponent(jsonRpc.params.prompt).toLowerCase()
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const noContext = Boolean(jsonRpc.params.noContext)

        let chat = memoryChats.find((c) => c.id === chatId)
        if (!chat) {
          chat = { id: chatId, title: (noContext ? "[Б] " : "") + cleanPrompt.slice(0, 12), noContext: noContext, lastPrompt: cleanPrompt, messages: [] }
          memoryChats.unshift(chat)
        }
        chat.lastPrompt = cleanPrompt

        const history = chat.noContext
          ? Array.of({ role: "user", content: cleanPrompt + " (ответь кратко на русском)" })
          : chat.messages.slice(-6).concat(Array.of({ role: "user", content: cleanPrompt + " (ответь кратко на русском)" }))

        const sysMsg = { role: "system", content: "Ты ассистент на часах. Текущий год 2026. Пиши кратко, по делу, ТОЛЬКО НА РУССКОМ КИРИЛЛИЦЕЙ без звёздочек." }

        fetch({
          url: BASE_URL + "/v1/chat/completions",
          method: "POST",
          timeout: 15000,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, messages: Array.of(sysMsg).concat(history), temperature: 0.3, max_tokens: 200 })
        })
          .then((res) => {
            const rawStr = typeof res.body === "string" ? res.body : JSON.stringify(res.body || res)
            let data = null
            try { data = typeof res.body === "string" ? JSON.parse(res.body) : res.body } catch (e) {}
            const choice = (data && Array.isArray(data.choices) && data.choices.length > 0) ? data.choices.slice(0, 1).pop() : null
            const content = (choice && choice.message && choice.message.content) ? choice.message.content : ""

            if (content) {
              const out = cleanOutputText(content) || content
              chat.messages.push({ role: "user", content: cleanPrompt })
              chat.messages.push({ role: "assistant", content: out })
              ctx.response({ data: { answer: formatChatTranscript(chat.messages), chatId: chat.id } })
            } else {
              ctx.response({ data: { answer: "Ответ ПК: " + rawStr.slice(0, 180), chatId: chat.id } })
            }
          })
          .catch((err) => ctx.response({ data: { answer: "Ошибка сети: " + String(err), chatId: chat.id } }))
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
