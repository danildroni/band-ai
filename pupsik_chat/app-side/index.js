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
        fetch({ url: BASE_URL + "/v1/models", method: "GET", timeout: 3000 })
          .then((mRes) => {
            const md = typeof mRes.body === "string" ? JSON.parse(mRes.body) : mRes.body
            const mList = (md && Array.isArray(md.data) ? md.data : []).map((m) => m.id).filter((id) => id && !id.toLowerCase().includes("embed"))
            return mList.includes(modelId) ? modelId : (mList.length > 0 ? mList.slice(0, 1).pop() : modelId)
          })
          .catch(() => modelId)
          .then((activeModel) => {
            const stepTokens = 130
            const maxSteps = Math.max(1, Math.min(4, Math.ceil(maxTokens / stepTokens)))
            let fullReply = ""

            const runStep = (step, curMsgs) => {
              fetch({
                url: BASE_URL + "/v1/chat/completions",
                method: "POST",
                timeout: 9000,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: activeModel, messages: curMsgs, temperature: 0.3, max_tokens: stepTokens })
              })
                .then((res) => {
                  let data = null
                  try { data = typeof res.body === "string" ? JSON.parse(res.body) : res.body } catch (e) {}
                  const choice = (data && Array.isArray(data.choices) && data.choices.length > 0) ? data.choices.slice(0, 1).pop() : null
                  const part = (choice && choice.message && choice.message.content) ? choice.message.content : ""
                  const reason = choice ? choice.finish_reason : "stop"
                  fullReply += part

                  if (reason === "length" && step < maxSteps && part) {
                    const nextMsgs = curMsgs.concat(Array.of({ role: "assistant", content: part }, { role: "user", content: "Продолжи с того же места без повторов." }))
                    runStep(step + 1, nextMsgs)
                  } else if (fullReply) {
                    const out = cleanOutputText(fullReply) || fullReply
                    chat.messages.push({ role: "user", content: cleanPrompt })
                    chat.messages.push({ role: "assistant", content: out })
                    saveChats(chats)
                    saveJob({ id: jobId, done: true, answer: formatChatTranscript(chat.messages), chatId: chat.id })
                  } else {
                    saveJob({ id: jobId, done: true, answer: "Пустой ответ от модели", chatId: chat.id })
                  }
                })
                .catch((err) => {
                  if (fullReply) {
                    const out = cleanOutputText(fullReply) || fullReply
                    chat.messages.push({ role: "user", content: cleanPrompt })
                    chat.messages.push({ role: "assistant", content: out })
                    saveChats(chats)
                    saveJob({ id: jobId, done: true, answer: formatChatTranscript(chat.messages), chatId: chat.id })
                  } else {
                    saveJob({ id: jobId, done: true, answer: "Ошибка сети ПК: " + String(err), chatId: chat.id })
                  }
                })
            }

            runStep(1, Array.of(sysMsg).concat(history))
          })
      }
    })
  },
  onRun() {},
  onDestroy() {}
})
