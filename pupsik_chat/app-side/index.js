import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const BASE_URL = "http://ВАШ_IP:1235"
let promptBuffer = ""

let memoryChats = null
let activeJob = { id: "", done: false, answer: "", chatId: "" }

const saveJob = (job) => {
  activeJob = job
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      settings.settingsStorage.setItem("pupsik_job", JSON.stringify(job))
    }
  } catch (e) {}
}

const loadJob = () => {
  if (activeJob && activeJob.done && activeJob.answer) return activeJob
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      const raw = settings.settingsStorage.getItem("pupsik_job")
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.done && parsed.answer) return parsed
      }
    }
  } catch (e) {}
  return activeJob
}

const loadChats = () => {
  memoryChats = null
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      const raw = settings.settingsStorage.getItem("pupsik_chats")
      if (raw) { memoryChats = JSON.parse(raw); return memoryChats }
    }
  } catch (e) {}
  memoryChats = []
  return memoryChats
}

const saveChats = (chats) => {
  memoryChats = chats.slice(0, 6)
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      settings.settingsStorage.setItem("pupsik_chats", JSON.stringify(memoryChats))
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
            ctx.response({ data: { models: list.length ? list : Array.of("qwen2.5-7b-instruct") } })
          }).catch(() => ctx.response({ data: { models: Array.of("qwen2.5-7b-instruct") } }))
      }

      if (jsonRpc.method === "LOAD_MODEL") {
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        fetch({ url: BASE_URL + "/v1/chat/completions", method: "POST", timeout: 30000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId, messages: Array.of({ role: "user", content: "привет" }), max_tokens: 1 }) })
          .then(() => ctx.response({ data: { ok: true, msg: "Загружена: " + modelId } }))
          .catch((err) => ctx.response({ data: { ok: false, msg: "Ошибка: " + String(err) } }))
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
      if (jsonRpc.method === "ADD_PART") {
        if (jsonRpc.params.reset) promptBuffer = ""
        promptBuffer += String(jsonRpc.params.p || "")
        ctx.response({ data: { ok: 1 } })
      }
      if (jsonRpc.method === "CHECK_AI") ctx.response({ data: loadJob() })

      if (jsonRpc.method === "ASK_AI") {
        const rawP = jsonRpc.params.useBuf ? promptBuffer : jsonRpc.params.prompt
        const cleanPrompt = (() => { try { return decodeURIComponent(rawP) } catch (e) { return String(rawP || "") } })()
        const maxTokens = Number(jsonRpc.params.max_tokens) || 500
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const isRetry = Boolean(jsonRpc.params.isRetry)
        const noContext = Boolean(jsonRpc.params.noContext)
        const subject = jsonRpc.params.subject || ""
        const jobId = jsonRpc.params.jobId || String(Date.now())

        saveJob({ id: jobId, done: false, answer: "", chatId: chatId })
        ctx.response({ data: { status: "STARTED", jobId: jobId } })

        let chats = loadChats()
        let chat = chats.find((c) => c.id === chatId)
        if (!chat) {
          chat = { id: chatId, title: (subject ? "[" + subject.slice(0, 3) + "] " : (noContext ? "[Б] " : "")) + cleanPrompt.slice(0, 10), noContext: noContext, subject: subject, messages: [] }
          chats.unshift(chat)
        }
        const activeSubj = subject || chat.subject || ""
        if (isRetry && chat.messages.length >= 2 && chat.messages[chat.messages.length - 1].role === "assistant") {
          chat.messages.pop(); chat.messages.pop()
        }

        const wordsCnt = cleanPrompt.trim().split(/\s+/).length
        let fullPrompt = cleanPrompt
        if (wordsCnt <= 2 && !cleanPrompt.includes("?")) {
          if (activeSubj === "Литература") {
            fullPrompt = "Это урок литературы. Назови автора, жанр, героев и сюжет известного литературного произведения под названием «" + cleanPrompt + "» из школьной программы. Упоминать погоду и природу строго запрещено."
          } else if (activeSubj) {
            fullPrompt = "Предмет " + activeSubj + ": объясни понятие «" + cleanPrompt + "» строго в рамках этой науки."
          } else {
            fullPrompt = "Что такое " + cleanPrompt + "? Дай краткое и точное объяснение."
          }
        }
        const rawClean = cleanPrompt.replace(/^\[[^\]]+\]\s*/, "").trim()
        const wikiQ = activeSubj === "Литература"
          ? (rawClean + " пьеса роман поэма автор")
          : (activeSubj ? (rawClean + " " + activeSubj) : rawClean)

        fetch({
          url: "https://wikipedia.org" + encodeURIComponent(wikiQ) + "&utf8=&format=json&srlimit=2",
          method: "GET",
          timeout: 3000
        })
          .then((wRes) => {
            const wData = typeof wRes.body === "string" ? JSON.parse(wRes.body) : wRes.body
            const items = (wData && wData.query && Array.isArray(wData.query.search)) ? wData.query.search : []
            return items.map((it) => it.title + ": " + it.snippet.replace(/<[^>]+>/g, "")).join("\n")
          })
          .catch(() => "")
          .then((wikiText) => {
            const finalPrompt = wikiText
              ? ("Факты из энциклопедии:\n" + wikiText.slice(0, 750) + "\n\nОпираясь строго на эти факты, ответь на запрос: " + fullPrompt)
              : fullPrompt
            const history = chat.noContext
              ? Array.of({ role: "user", content: finalPrompt })
              : chat.messages.slice(-16).concat(Array.of({ role: "user", content: finalPrompt }))

        const sysMsg = {
          role: "system",
          content: "Ты русскоязычный справочник-ассистент на часах. Текущий год 2026. ОБЯЗАТЕЛЬНО учитывай все предыдущие сообщения и ответы в этом диалоге, связывая каждый новый запрос с общим контекстом переписки. ПИШИ ТОЛЬКО НА РУССКОМ КИРИЛЛИЦЕЙ без звёздочек, иероглифов и встречных вопросов."
        }

        fetch({ url: BASE_URL + "/v1/models", method: "GET", timeout: 3000 })
          .then((mRes) => {
            const md = typeof mRes.body === "string" ? JSON.parse(mRes.body) : mRes.body
            const mList = (md && Array.isArray(md.data) ? md.data : []).map((m) => m.id).filter((id) => id && !id.toLowerCase().includes("embed"))
            return mList.includes(modelId) ? modelId : (mList[0] || modelId)
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
              chat.messages.push({ role: "user", content: cleanPrompt })
              chat.messages.push({ role: "assistant", content: out })
              saveChats(chats)
              saveJob({ id: jobId, done: true, answer: formatChatTranscript(chat.messages), chatId: chat.id })
            } else {
              saveJob({ id: jobId, done: true, answer: "Пустой ответ от модели", chatId: chat.id })
            }
          })
          .catch((err) => saveJob({ id: jobId, done: true, answer: "Ошибка сети ПК: " + String(err), chatId: chat.id }))
          })
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
