import { MessageBuilder } from "../shared/message"

const messageBuilder = new MessageBuilder()
const PROXY_HOST = "https://long-snow-d028" + ".danildroni10.workers.dev"

let activeJob = { id: "", done: false, answer: "", chatId: "" }
let partBuf = ""

const log = function () {
  try { console.log.apply(console, ["[pupsik]"].concat(Array.prototype.slice.call(arguments))) } catch (e) {}
}

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
const formatChatTranscript = (messages) => messages.map((m) => (m.role === "user" ? "▸ Вы:\n" : "✦ ИИ:\n") + m.content).join("\n\n")
const getLastUserPrompt = (messages) => { for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === "user") return messages[i].content } return "" }
const STATS_KEY = "pupsik_stats"
const CAP_T = 100000, CAP_R = 200
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() }
const loadStats = () => { try { if (typeof settings !== "undefined" && settings.settingsStorage) { const raw = settings.settingsStorage.getItem(STATS_KEY); if (raw) { const o = JSON.parse(raw); if (o.d === todayStr()) return o } } } catch (e) {} return { d: todayStr(), t: 0, r: 0 } }
const saveStats = (o) => { try { if (typeof settings !== "undefined" && settings.settingsStorage) settings.settingsStorage.setItem(STATS_KEY, JSON.stringify(o)) } catch (e) {} }
const cleanOutputText = (rawText) => String(rawText || "").replace(/[*#_`~]/g, "").replace(/\n{3,}/g, "\n\n").trim()

AppSideService({
  onInit() {
    log("SIDE INIT OK")
    messageBuilder.listen(() => {})
    messageBuilder.on("request", (ctx) => {
      const jsonRpc = messageBuilder.buf2Json(ctx.request.payload)
      log("REQ:", jsonRpc.method)

      if (jsonRpc.method === "GET_MODELS") { log("GET_MODELS -> gemini-3-flash"); ctx.response({ data: { models: Array.of("gemini-3-flash") } }) }
      if (jsonRpc.method === "LOAD_MODEL") { ctx.response({ data: { msg: "Активна: gemini-3-flash" } }) }

      if (jsonRpc.method === "ADD_PART") {
        if (jsonRpc.params && jsonRpc.params.reset) partBuf = ""
        partBuf += String((jsonRpc.params && jsonRpc.params.p) || "")
        ctx.response({ data: { ok: 1, len: partBuf.length } })
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
      if (jsonRpc.method === "GET_STATS") { const st = loadStats(); ctx.response({ data: { t: st.t, r: st.r, capT: CAP_T, capR: CAP_R, d: st.d } }) }

      if (jsonRpc.method === "ASK_AI") {
        let cleanPrompt
        if (jsonRpc.params && jsonRpc.params.useBuf) { cleanPrompt = partBuf; partBuf = "" }
        else { cleanPrompt = String(jsonRpc.params.prompt || "") }
        cleanPrompt = String(cleanPrompt || "").trim()
        try { if (cleanPrompt.includes("%")) cleanPrompt = decodeURIComponent(cleanPrompt).trim() } catch (e) {}
        log("ASK_AI prompt:", cleanPrompt.slice(0, 40))

        const maxTokens = Number(jsonRpc.params.max_tokens) || 500
        const chatId = jsonRpc.params.chatId || String(Date.now())
        const isRetry = Boolean(jsonRpc.params.isRetry)
        const noContext = Boolean(jsonRpc.params.noContext)
        const jobId = jsonRpc.params.jobId || String(Date.now())

        let chats = loadChats()
        let chat = chats.find((c) => c.id === chatId)
        if (!chat) { chat = { id: chatId, title: (noContext ? "[Б] " : "") + cleanPrompt.slice(0, 12), noContext: noContext, messages: [] }; chats.unshift(chat) }
        if (isRetry && chat.messages.length >= 2 && chat.messages[chat.messages.length - 1].role === "assistant") { chat.messages.pop(); chat.messages.pop() }
        saveChats(chats)

        activeJob = { id: jobId, done: false, answer: "", chatId: chat.id }
        ctx.response({ data: { status: "STARTED", jobId: jobId, chatId: chat.id } })

        const history = chat.noContext
          ? Array.of({ role: "user", content: cleanPrompt })
          : chat.messages.slice(-16).concat(Array.of({ role: "user", content: cleanPrompt }))
        const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: Array.of({ text: m.content }) }))

        fetch({
          url: PROXY_HOST,
          method: "POST",
          timeout: 15000,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: Array.of({ text: "Ты умный русскоязычный ассистент на часах. Текущий год 2026. Учитывай историю чата. Отвечай чётко, по-русски без markdown-звёздочек и лишних вступлений." }) },
            contents: contents,
            generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens }
          })
        })
          .then((res) => {
            let data = null
            try { data = typeof res.body === "string" ? JSON.parse(res.body) : res.body } catch (e) {}
            const cand = (data && Array.isArray(data.candidates) && data.candidates.length > 0) ? data.candidates.slice(0, 1).pop() : null
            const parts = (cand && cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : []
            const content = parts.map((p) => p.text || "").join("")
            log("FETCH status:", res.status, "content len:", content.length)
            if (content) {
              const used = (data && data.usageMetadata && data.usageMetadata.totalTokenCount) || 0
              const stx = loadStats(); stx.t += used; stx.r += 1; saveStats(stx)
              const out = cleanOutputText(content) || content
              let freshChats = loadChats()
              let freshChat = freshChats.find((c) => c.id === chatId) || chat
              freshChat.messages.push({ role: "user", content: cleanPrompt })
              freshChat.messages.push({ role: "assistant", content: out })
              if (!freshChats.find((c) => c.id === chatId)) freshChats.unshift(freshChat)
              saveChats(freshChats)
              activeJob = { id: jobId, done: true, answer: formatChatTranscript(freshChat.messages), chatId: freshChat.id }
              log("DONE, answer len:", out.length)
            } else {
              const errMsg = (data && data.error && data.error.message) ? data.error.message : ("HTTP " + String(res.status))
              log("FETCH empty:", errMsg)
              activeJob = { id: jobId, done: true, answer: "Ошибка Gemini: " + errMsg, chatId: chat.id }
            }
          })
          .catch((err) => {
            log("FETCH ERROR:", String(err))
            activeJob = { id: jobId, done: true, answer: "Ошибка прокси: " + String(err), chatId: chat.id }
          })
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
