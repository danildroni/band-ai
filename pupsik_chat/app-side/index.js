import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const BASE_URL = "http://ВАШ_IP:1235"

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
  if (memoryChats !== null) return memoryChats
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
  return messages.map((m) => (m.role === "user" ? "Вы: " : "ИИ: ") + m.content).join("\n\n")
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

const searchWebContext = (query) => {
  const kw = query.replace(/[?!.,;:()"]/g, " ").split(/\s+/).filter((w) => w.length > 1).join(" ") || query
  return fetch({ url: "https://wikipedia.org" + encodeURIComponent(kw) + "&utf8=&format=json&srlimit=2", method: "GET", timeout: 2500 })
    .then((res) => {
      const data = typeof res.body === "string" ? JSON.parse(res.body) : res.body
      const items = data && data.query && Array.isArray(data.query.search) ? data.query.search : []
      return items.map((item) => item.title + ": " + item.snippet.replace(/<[^>]+>/g, "")).join("\n")
    }).catch(() => "")
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
      if (jsonRpc.method === "CHECK_AI") ctx.response({ data: loadJob() })

      if (jsonRpc.method === "ASK_AI") {
        const cleanPrompt = decodeURIComponent(jsonRpc.params.prompt).toLowerCase()
        const maxTokens = Number(jsonRpc.params.max_tokens) || 500
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const isRetry = Boolean(jsonRpc.params.isRetry)
        const noContext = Boolean(jsonRpc.params.noContext)
        const jobId = jsonRpc.params.jobId || String(Date.now())

        saveJob({ id: jobId, done: false, answer: "", chatId: chatId })
        ctx.response({ data: { status: "STARTED", jobId: jobId } })

        let chats = loadChats()
        let chat = chats.find((c) => c.id === chatId)
        if (!chat) {
          chat = { id: chatId, title: (noContext ? "[Б] " : "") + cleanPrompt.slice(0, 12), noContext: noContext, messages: [] }
          chats.unshift(chat)
        }
        if (isRetry && chat.messages.length >= 2 && chat.messages[chat.messages.length - 1].role === "assistant") {
          chat.messages.pop(); chat.messages.pop()
        }

        const isEnglishOnly = /[a-z]/.test(cleanPrompt) && !/[а-яё]/.test(cleanPrompt)
        const wordsCount = cleanPrompt.split(/\s+/).length
        const isShortFollowUp = !chat.noContext && chat.messages.length > 0 && wordsCount <= 3
        const contextPromise = (isEnglishOnly || isShortFollowUp) ? Promise.resolve("") : searchWebContext(cleanPrompt)

        contextPromise.then((webInfo) => {
          let expandedPrompt = cleanPrompt
          if (isEnglishOnly) {
            expandedPrompt = "Переведи на русский язык: " + cleanPrompt
          } else if (isShortFollowUp) {
            expandedPrompt = "Уточнение к предыдущему вопросу в диалоге: " + cleanPrompt + ". Раскрой предыдущую тему с учётом этого уточнения, не давая определение самого слова."
          } else if (wordsCount <= 2 && !cleanPrompt.includes("?")) {
            expandedPrompt = "Что такое " + cleanPrompt + "? Дай подробное, точное и понятное объяснение на русском языке."
          }

          const userContent = webInfo
            ? "Справка:\n" + webInfo.slice(0, 700) + "\n\nВопрос: " + expandedPrompt
            : expandedPrompt

          const history = chat.noContext
            ? Array.of({ role: "user", content: userContent })
            : chat.messages.slice(-8).concat(Array.of({ role: "user", content: userContent }))

          const sysMsg = {
            role: "system",
            content: "Ты русскоязычный справочник-ассистент на часах. Текущий год 2026. ПИШИ ТОЛЬКО НА РУССКОМ КИРИЛЛИЦЕЙ без звёздочек и вступлений. НИКОГДА не задавай встречных вопросов пользователю и не спрашивай чем помочь — сразу давай полный ответ и заканчивай точкой."
          }

          fetch({
            url: BASE_URL + "/v1/chat/completions",
            method: "POST",
            timeout: 90000,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: modelId, messages: Array.of(sysMsg).concat(history), temperature: 0.3, max_tokens: maxTokens })
          })
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
