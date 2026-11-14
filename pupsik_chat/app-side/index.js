import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const BASE_URL = "http://ВАШ_IP:1235"

let activeJob = { id: "", done: false, answer: "", chatId: "" }

const loadChats = () => {
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      const raw = settings.settingsStorage.getItem("pupsik_chats")
      if (raw) return JSON.parse(raw)
    }
  } catch (e) {}
  return []
}

const saveChats = (chats) => {
  const sliced = chats.slice(0, 6)
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      settings.settingsStorage.setItem("pupsik_chats", JSON.stringify(sliced))
    }
  } catch (e) {}
}

const formatChatTranscript = (messages) => {
  return messages.map((m) => (m.role === "user" ? "▸ Вы:\n" : "✦ ИИ:\n") + m.content).join("\n\n")
}

const getLastUserPrompt = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content
  }
  return ""
}

const cleanOutputText = (rawText) => {
  return String(rawText || "").replace(/[\u4e00-\u9fff]/g, "").replace(/[*#_`~]/g, "").replace(/\n{3,}/g, "\n\n").trim()
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
            ctx.response({ data: { models: list.length ? list : Array.of("google/gemma-4-12b-qat") } })
          }).catch(() => ctx.response({ data: { models: Array.of("google/gemma-4-12b-qat") } }))
      }

      if (jsonRpc.method === "GET_CHATS") ctx.response({ data: { chats: loadChats().map((c) => ({ id: c.id, title: c.title })) } })
      if (jsonRpc.method === "OPEN_CHAT") {
        const found = loadChats().find((c) => c.id === jsonRpc.params.chatId)
        ctx.response({ data: { transcript: found ? formatChatTranscript(found.messages) : "", lastPrompt: found ? getLastUserPrompt(found.messages) : "" } })
      }
      if (jsonRpc.method === "DELETE_CHAT") {
        const chats = loadChats().filter((c) => c.id !== jsonRpc.params.chatId)
        saveChats(chats)
        ctx.response({ data: { chats: chats.map((c) => ({ id: c.id, title: c.title })) } })
      }
      if (jsonRpc.method === "CHECK_AI") ctx.response({ data: activeJob })

      if (jsonRpc.method === "ASK_AI") {
        const cleanPrompt = decodeURIComponent(jsonRpc.params.prompt)
        const maxTokens = Number(jsonRpc.params.max_tokens) || 500
        const modelId = jsonRpc.params.model || "google/gemma-4-12b-qat"
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const isRetry = Boolean(jsonRpc.params.isRetry)
        const noContext = Boolean(jsonRpc.params.noContext)
        const jobId = jsonRpc.params.jobId || String(Date.now())

        let chats = loadChats()
        let chat = chats.find((c) => c.id === chatId)
        if (!chat) {
          chat = { id: chatId, title: (noContext ? "[Б] " : "") + cleanPrompt.slice(0, 12), noContext: noContext, messages: [] }
          chats.unshift(chat)
        }
        if (isRetry && chat.messages.length >= 2 && chat.messages[chat.messages.length - 1].role === "assistant") {
          chat.messages.pop(); chat.messages.pop()
        }
        saveChats(chats)

        activeJob = { id: jobId, done: false, answer: "", chatId: chat.id }
        ctx.response({ data: { status: "STARTED", jobId: jobId } })

        const history = chat.noContext
          ? Array.of({ role: "user", content: cleanPrompt })
          : chat.messages.slice(-16).concat(Array.of({ role: "user", content: cleanPrompt }))

        const sysMsg = {
          role: "system",
          content: "Ты русскоязычный справочник-ассистент на часах. Текущий год 2026. ОБЯЗАТЕЛЬНО учитывай все предыдущие сообщения в диалоге. ПИШИ ТОЛЬКО НА РУССКОМ КИРИЛЛИЦЕЙ без звёздочек и встречных вопросов."
        }

        fetch({ url: BASE_URL + "/v1/models", method: "GET", timeout: 3000 })
          .then((mRes) => {
            const md = typeof mRes.body === "string" ? JSON.parse(mRes.body) : mRes.body
            const mList = (md && Array.isArray(md.data) ? md.data : []).map((m) => m.id).filter((id) => id && !id.toLowerCase().includes("embed"))
            return mList.includes(modelId) ? modelId : (mList.length > 0 ? mList.slice(0, 1).pop() : modelId)
          })
          .catch(() => modelId)
          .then((activeModel) => fetch({
            url: BASE_URL + "/v1/chat/completions",
            method: "POST",
            timeout: 90000,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: activeModel, messages: Array.of(sysMsg).concat(history), temperature: 0.3, max_tokens: maxTokens })
          }))
          .then((res) => {
            let data = null
            try { data = typeof res.body === "string" ? JSON.parse(res.body) : res.body } catch (e) {}
            const choice = (data && Array.isArray(data.choices) && data.choices.length > 0) ? data.choices.slice(0, 1).pop() : null
            const content = (choice && choice.message && choice.message.content) ? choice.message.content : ""

            if (content) {
              const out = cleanOutputText(content) || content
              let freshChats = loadChats()
              let freshChat = freshChats.find((c) => c.id === chatId) || chat
              freshChat.messages.push({ role: "user", content: cleanPrompt })
              freshChat.messages.push({ role: "assistant", content: out })
              if (!freshChats.find((c) => c.id === chatId)) freshChats.unshift(freshChat)
              saveChats(freshChats)
              activeJob = { id: jobId, done: true, answer: formatChatTranscript(freshChat.messages), chatId: freshChat.id }
            } else {
              activeJob = { id: jobId, done: true, answer: "Пустой ответ от модели", chatId: chat.id }
            }
          })
          .catch((err) => {
            activeJob = { id: jobId, done: true, answer: "Ошибка соединения: " + String(err), chatId: chat.id }
          })
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
