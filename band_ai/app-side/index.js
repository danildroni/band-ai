import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const BASE_URL = "http://ВАШ_IP:1235"

let memoryChats = null

const loadChats = () => {
  if (memoryChats !== null) return memoryChats
  try {
    if (typeof settings !== "undefined" && settings.settingsStorage) {
      const raw = settings.settingsStorage.getItem("pupsik_chats")
      if (raw) {
        memoryChats = JSON.parse(raw)
        return memoryChats
      }
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
  if (!messages || !messages.length) return ""
  return messages.map((m) => (m.role === "user" ? "Вы: " : "ИИ: ") + m.content).join("\n\n")
}

const getLastUserPrompt = (messages) => {
  if (!messages || !messages.length) return ""
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content
  }
  return ""
}

const cleanOutputText = (rawText) => {
  return rawText
    .replace(/[\u4e00-\u9fff]/g, "")
    .replace(/[*#_`~]/g, "")
    .replace(/[^\u0400-\u04FF0-9\s.,!?:;()\-\/+="«»—\n]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const searchWebContext = (query) => {
  const encoded = encodeURIComponent(query)
  const wikiSearch = fetch({
    url: "https://wikipedia.org" + encoded + "&utf8=&format=json&srlimit=4",
    method: "GET"
  })
    .then((res) => {
      const data = typeof res.body === "string" ? JSON.parse(res.body) : res.body
      const items = data && data.query && Array.isArray(data.query.search) ? data.query.search : []
      return items.map((item) => item.title + ": " + item.snippet.replace(/<[^>]+>/g, "")).join("\n")
    })
    .catch(() => "")

  const ddgSearch = fetch({
    url: "https://duckduckgo.com" + encoded + "&format=json&no_html=1&skip_disambig=1",
    method: "GET"
  })
    .then((res) => {
      const data = typeof res.body === "string" ? JSON.parse(res.body) : res.body
      const extra = (data && Array.isArray(data.RelatedTopics))
        ? data.RelatedTopics.slice(0, 3).map((t) => t.Text || "").filter(Boolean).join(" | ")
        : ""
      return [data && data.AbstractText, data && data.Answer, extra].filter(Boolean).join("\n")
    })
    .catch(() => "")

  return Promise.all(Array.of(wikiSearch, ddgSearch))
    .then((results) => results.filter((s) => s && s.trim().length > 0).join("\n"))
    .catch(() => "")
}
AppSideService({
  onInit() {
    messageBuilder.listen(() => {})

    messageBuilder.on("request", (ctx) => {
      const jsonRpc = messageBuilder.buf2Json(ctx.request.payload)

      if (jsonRpc.method === "GET_MODELS") {
        fetch({ url: BASE_URL + "/v1/models", method: "GET" })
          .then((result) => {
            const data = typeof result.body === "string" ? JSON.parse(result.body) : result.body
            const list = (data && Array.isArray(data.data) ? data.data : [])
              .map((m) => m.id)
              .filter((id) => id && !id.toLowerCase().includes("embed"))
            ctx.response({ data: { models: list.length ? list : Array.of("qwen2.5-7b-instruct") } })
          })
          .catch(() => ctx.response({ data: { models: Array.of("qwen2.5-7b-instruct") } }))
      }

      if (jsonRpc.method === "LOAD_MODEL") {
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        fetch({
          url: BASE_URL + "/v1/chat/completions",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, messages: Array.of({ role: "user", content: "привет" }), max_tokens: 1 })
        })
          .then((result) => ctx.response({ data: { ok: result.status === 200, msg: result.status === 200 ? "Загружена: " + modelId : "Код ПК: " + result.status } }))
          .catch((err) => ctx.response({ data: { ok: false, msg: "Ошибка: " + String(err) } }))
      }

      if (jsonRpc.method === "GET_CHATS") {
        const chats = loadChats().map((c) => ({ id: c.id, title: c.title }))
        ctx.response({ data: { chats: chats } })
      }

      if (jsonRpc.method === "OPEN_CHAT") {
        const chats = loadChats()
        const found = chats.find((c) => c.id === jsonRpc.params.chatId)
        ctx.response({
          data: {
            transcript: found ? formatChatTranscript(found.messages) : "",
            lastPrompt: found ? getLastUserPrompt(found.messages) : ""
          }
        })
      }

      if (jsonRpc.method === "DELETE_CHAT") {
        const chats = loadChats().filter((c) => c.id !== jsonRpc.params.chatId)
        saveChats(chats)
        ctx.response({ data: { chats: chats.map((c) => ({ id: c.id, title: c.title })) } })
      }

      if (jsonRpc.method === "ASK_AI") {
        const cleanPrompt = decodeURIComponent(jsonRpc.params.prompt).toLowerCase()
        const requestedTokens = Number(jsonRpc.params.max_tokens) || 500
        const modelId = jsonRpc.params.model || "qwen2.5-7b-instruct"
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const isRetry = Boolean(jsonRpc.params.isRetry)
        const noContext = Boolean(jsonRpc.params.noContext)

        let chats = loadChats()
        let chat = chats.find((c) => c.id === chatId)
        if (!chat) {
          const prefix = noContext ? "[Б] " : ""
          chat = { id: chatId, title: prefix + cleanPrompt.slice(0, 12), noContext: noContext, messages: [] }
          chats.unshift(chat)
        }

        if (isRetry && chat.messages.length >= 2 && chat.messages[chat.messages.length - 1].role === "assistant") {
          chat.messages.pop()
          chat.messages.pop()
        }

        const isEnglishOnly = /[a-z]/.test(cleanPrompt) && !/[а-яё]/.test(cleanPrompt)
        const isFollowUp = !chat.noContext && chat.messages.length > 0 && cleanPrompt.split(" ").length <= 4
        const contextPromise = (isEnglishOnly || isFollowUp) ? Promise.resolve("") : searchWebContext(cleanPrompt)

        contextPromise.then((webInfo) => {
          const userContentForAI = isEnglishOnly
            ? "Переведи этот английский текст на русский язык (дай точный перевод и 1-2 значения без английских слов): " + cleanPrompt
            : (webInfo ? "Собранные факты из интернета:\n" + webInfo.slice(0, 1400) + "\n\nПодробно ответь по теме на вопрос: " + cleanPrompt : cleanPrompt)

          const historyForModel = chat.noContext
            ? Array.of({ role: "user", content: userContentForAI })
            : chat.messages.slice(-14).concat(Array.of({ role: "user", content: userContentForAI }))
          const sysMsg = {
            role: "system",
            content: chat.noContext
              ? "Ты русскоязычный справочник на часах. ПИШИ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ КИРИЛЛИЦЕЙ! Запрещены английские слова, иероглифы, звёздочки и спецсимволы. Объедини все факты из справки и дай максимально полный, информативный ответ по теме без вступлений и финальных фраз."
              : "Ты русскоязычный собеседник на часах. ПИШИ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ КИРИЛЛИЦЕЙ! Запрещены английские слова, иероглифы и звёздочки. Обязательно связывай новый вопрос с предыдущими сообщениями этого диалога. Раскрывай тему максимально полно, без приветствий и вежливых концовок."
          }

          fetch({
            url: BASE_URL + "/v1/chat/completions",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modelId,
              messages: Array.of(sysMsg).concat(historyForModel),
              temperature: 0.35,
              max_tokens: requestedTokens
            })
          })
            .then((result) => {
              const raw = typeof result.body === "string" ? result.body : JSON.stringify(result.body)
              const data = typeof result.body === "string" ? JSON.parse(result.body) : result.body
              const firstChoice = data && Array.isArray(data.choices) ? data.choices.slice(0, 1).pop() : null
              if (firstChoice && firstChoice.message && firstChoice.message.content) {
                const cleanAnswer = cleanOutputText(firstChoice.message.content) || "Пустой ответ"
                const isFirstTurn = chat.messages.length === 0
                chat.messages.push({ role: "user", content: cleanPrompt })
                chat.messages.push({ role: "assistant", content: cleanAnswer })
                saveChats(chats)
                ctx.response({ data: { answer: formatChatTranscript(chat.messages), chatId: chat.id } })

                if (isFirstTurn) {
                  fetch({
                    url: BASE_URL + "/v1/chat/completions",
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      model: modelId,
                      messages: [
                        { role: "system", content: "Придумай короткое название чата (1-2 слова на русском кириллицей, до 14 символов, без кавычек)." },
                        { role: "user", content: cleanPrompt }
                      ],
                      temperature: 0.3,
                      max_tokens: 15
                    })
                  })
                    .then((tRes) => {
                      const tData = typeof tRes.body === "string" ? JSON.parse(tRes.body) : tRes.body
                      const tChoice = tData && Array.isArray(tData.choices) ? tData.choices.slice(0, 1).pop() : null
                      if (tChoice && tChoice.message && tChoice.message.content) {
                        const smartTitle = cleanOutputText(tChoice.message.content).slice(0, 14)
                        if (smartTitle) {
                          const freshChats = loadChats()
                          const target = freshChats.find((item) => item.id === chat.id)
                          if (target) {
                            target.title = (target.noContext ? "[Б] " : "") + smartTitle.slice(0, 11)
                            saveChats(freshChats)
                          }
                        }
                      }
                    })
                    .catch(() => {})
                }
              } else {
                ctx.response({ data: { answer: "Ответ ПК: " + raw.slice(0, 180), chatId: chat.id } })
              }
            })
            .catch((err) => ctx.response({ data: { answer: "Ошибка сети: " + String(err), chatId: chat.id } }))
        })
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
