import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const BASE_URL = "http://ВАШ_IP:1235"

let memoryChats = []
let activeJob = { id: "", done: false, answer: "", chatId: "" }

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

      if (jsonRpc.method === "GET_CHATS") ctx.response({ data: { chats: memoryChats.map((c) => ({ id: c.id, title: c.title })) } })
      if (jsonRpc.method === "OPEN_CHAT") {
        const found = memoryChats.find((c) => c.id === jsonRpc.params.chatId)
        ctx.response({ data: { transcript: found ? formatChatTranscript(found.messages) : "", lastPrompt: found ? getLastUserPrompt(found.messages) : "" } })
      }
      if (jsonRpc.method === "DELETE_CHAT") {
        memoryChats = memoryChats.filter((c) => c.id !== jsonRpc.params.chatId)
        ctx.response({ data: { chats: memoryChats.map((c) => ({ id: c.id, title: c.title })) } })
      }
      if (jsonRpc.method === "CHECK_AI") ctx.response({ data: activeJob })

      if (jsonRpc.method === "ASK_AI") {
        const cleanPrompt = decodeURIComponent(jsonRpc.params.prompt).toLowerCase()
        const maxTokens = Number(jsonRpc.params.max_tokens) || 500
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const isRetry = Boolean(jsonRpc.params.isRetry)
        const noContext = Boolean(jsonRpc.params.noContext)
        const jobId = jsonRpc.params.jobId || String(Date.now())

        activeJob = { id: jobId, done: false, answer: "", chatId: chatId }
        ctx.response({ data: { status: "STARTED", jobId: jobId } })

        let chat = memoryChats.find((c) => c.id === chatId)
        if (!chat) {
          chat = { id: chatId, title: (noContext ? "[Б] " : "") + cleanPrompt.slice(0, 12), noContext: noContext, messages: [] }
          memoryChats.unshift(chat)
        }
        if (isRetry && chat.messages.length >= 2 && chat.messages[chat.messages.length - 1].role === "assistant") {
          chat.messages.pop(); chat.messages.pop()
        }

        const isEnglishOnly = /[a-z]/.test(cleanPrompt) && !/[а-яё]/.test(cleanPrompt)
        const isShortFollowUp = !chat.noContext && chat.messages.length > 0 && cleanPrompt.split(" ").length <= 3
        const contextPromise = (isEnglishOnly || isShortFollowUp) ? Promise.resolve("") : searchWebContext(cleanPrompt)

        contextPromise.then((webInfo) => {
          const userContent = isEnglishOnly
            ? "Переведи на русский язык: " + cleanPrompt
            : (webInfo ? "Справка:\n" + webInfo.slice(0, 700) + "\n\nЗапрос: " + cleanPrompt : cleanPrompt)

          const history = chat.noContext
            ? Array.of({ role: "user", content: userContent })
            : chat.messages.slice(-8).concat(Array.of({ role: "user", content: userContent }))

          const sysMsg = {
            role: "system",
            content: "Ты русскоязычный справочник-ассистент на часах. Текущий год 2026. ПИШИ ТОЛЬКО НА РУССКОМ КИРИЛЛИЦЕЙ без звёздочек и вступлений. ЖЁСТКИЕ ПРАВИЛА: 1) ТЕБЕ ЗАПРЕЩЕНО ЗАДАВАТЬ ВОПРОСЫ ПОЛЬЗОВАТЕЛЮ! Никогда не спрашивай чем помочь и не ставь вопросительный знак в конце. 2) Любое сообщение пользователя (даже из 1 слова без знака вопроса) — это уже готовый вопрос (Что такое X? / Расскажи про X). Сразу давай полный чёткий ответ и заканчивай точкой. 3) УТОЧНЕНИЯ: если в чате уже есть переписка и пользователь прислал 1-3 слова (например: литература, книга, пьеса, фильм, игра, история, физика, армия, закон, подробнее, кратко, примеры, плюсы, минусы, причины, автор, год, перевод или любая другая область знаний), НЕ давай определение этого слова — восприми его как уточнение контекста и заново ответь на ПРЕДЫДУЩИЙ запрос строго в рамках указанного слова или темы."
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
                activeJob = { id: jobId, done: true, answer: formatChatTranscript(chat.messages), chatId: chat.id }
              } else {
                activeJob = { id: jobId, done: true, answer: "Пустой ответ от модели", chatId: chat.id }
              }
            })
            .catch((err) => { activeJob = { id: jobId, done: true, answer: "Ошибка сети ПК: " + String(err), chatId: chat.id } })
        })
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
