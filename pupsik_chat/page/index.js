const { messageBuilder } = getApp()._options.globalData
const LAYOUTS = {
  RU: ["АБВГ", "ДЕЖЗ", "ИЙКЛ", "МНОП", "РСТУ", "ФХЦЧ", "ШЩЫЬ", "ЭЮЯ?", "___"],
  EN: ["ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ", "___"],
  NUM: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0+-=", "*/()", ".,?!"]
}
const MODES = ["RU", "EN", "NUM"]
const TOKEN_PRESETS = Array.of(300, 500, 800, 1200, 1600, 2000)
const TOKEN_COLORS = Array.of(0x1f2937, 0x1e3a5f, 0x1d4ed8, 0x3730a3, 0x5b21b6, 0x701a75)

const calcTextHeight = (text) => {
  const paras = String(text || "").split("\n")
  let lines = 0
  for (let i = 0; i < paras.length; i++) {
    lines += Math.max(1, Math.ceil(paras[i].length / 15))
  }
  return Math.max(180, lines * 27 + 44)
}

Page({
  state: {
    prompt: "", lastPrompt: "", lastKey: -1, charIndex: 0, lastTapTime: 0,
    modeIdx: 0, tokenIdx: 1, modelIdx: 0, models: Array.of("gemma-4-12b"),
    currentChatId: String(Date.now()), noContextMode: false, chatList: [],
    isReading: false, isMenuOpen: false, lastTextH: 200, lastAnswerText: ""
  },
  onInit() { if (typeof hmSetting !== "undefined" && hmSetting.setBrightScreen) hmSetting.setBrightScreen(300) },
  onDestroy() { if (typeof hmSetting !== "undefined" && hmSetting.setBrightScreenCancel) hmSetting.setBrightScreenCancel() },
  build() {
    const setPageScroll = (enable) => {
      if (typeof hmUI !== "undefined" && hmUI.setScrollView) hmUI.setScrollView(enable)
      if (!enable && typeof hmApp !== "undefined" && hmApp.setLayerY) hmApp.setLayerY(0)
    }
    setPageScroll(false)

    const devInfo = (typeof hmSetting !== "undefined" && hmSetting.getDeviceInfo) ? hmSetting.getDeviceInfo() : { height: 368 }
    const H = devInfo.height || 368
    const bottomBtnH = 52
    const bottomY = H - bottomBtnH - 4
    const promptH = Math.max(72, bottomY - 244)
    const keyButtons = []; const chatSlotBtns = []; const chatDelBtns = []

    const displayBox = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 10, y: 52, w: 180, h: promptH,
      text: "Новый диалог\nВведите запрос:", text_size: 16, color: 0x38bdf8,
      align_h: hmUI.align.LEFT,
      text_style: hmUI.text_style.WRAP
    })
    const shortName = (id) => id.replace("-instruct", "").replace("-qat", "").slice(0, 9)
    const chatsBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 4, y: 8, w: 54, h: 36, text: "Чаты", text_size: 13, radius: 14,
      normal_color: 0x1c212b, press_color: 0x2d3646,
      click_func: () => { if (this.state.isMenuOpen) closeChatMenu(); else openChatMenu() }
    })
    const modelBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 61, y: 8, w: 84, h: 36, text: "Модель", text_size: 12, radius: 14,
      normal_color: 0x1c212b, press_color: 0x2d3646,
      click_func: () => {
        this.state.modelIdx = (this.state.modelIdx + 1) % this.state.models.length
        modelBtn.setProperty(hmUI.prop.TEXT, shortName(this.state.models[this.state.modelIdx]))
      }
    })
    const loadBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 148, y: 8, w: 42, h: 36, text: "Загр", text_size: 12, radius: 14,
      normal_color: 0x252c38, press_color: 0x3b4659,
      click_func: () => {
        const cur = this.state.models[this.state.modelIdx]
        setPageScroll(false)
        displayBox.setProperty(hmUI.prop.MORE, { x: 10, y: 52, w: 180, h: promptH, text: "Загрузка модели:\n" + cur, text_size: 15, color: 0x94a3b8 })
        messageBuilder.request({ method: "LOAD_MODEL", params: { model: cur } })
          .then((res) => displayBox.setProperty(hmUI.prop.TEXT, (res && res.msg) ? res.msg : "Модель готова"))
          .catch((e) => displayBox.setProperty(hmUI.prop.TEXT, String(e)))
      }
    })
    messageBuilder.request({ method: "GET_MODELS" })
      .then((res) => {
        if (res && Array.isArray(res.models) && res.models.length > 0) {
          this.state.models = res.models
          modelBtn.setProperty(hmUI.prop.TEXT, shortName(this.state.models))
        }
      }).catch(() => {})

    const tokenBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 4, y: bottomY, w: 58, h: bottomBtnH, radius: 14, color: 0x1e3a5f })
    const tokenBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 4, y: bottomY, w: 58, h: bottomBtnH, text: "500 т", text_size: 14, color: 0xe2e8f0, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    tokenBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      this.state.tokenIdx = (this.state.tokenIdx + 1) % TOKEN_PRESETS.length
      const i = this.state.tokenIdx
      tokenBg.setProperty(hmUI.prop.COLOR, TOKEN_COLORS[i])
      tokenBtn.setProperty(hmUI.prop.TEXT, String(TOKEN_PRESETS[i]) + " т")
    })

    const retryBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 66, y: bottomY, w: 56, h: bottomBtnH, radius: 14, color: 0x1c212b })
    const retryBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 66, y: bottomY, w: 56, h: bottomBtnH, text: "Ещё", text_size: 14, color: 0xe2e8f0, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    retryBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      displayBox.setProperty(hmUI.prop.TEXT, "Проверяю...")
      messageBuilder.request({ method: "CHECK_AI" }).then((st) => {
        if (st && st.done && st.answer && st.answer !== this.state.lastAnswerText) {
          this.state.lastAnswerText = st.answer
          showScrollableAnswer(st.answer, 0xf1f5f9)
        } else if (this.state.lastPrompt) {
          this.state.lastAnswerText = ""
          sendPromptToAI(this.state.lastPrompt, true)
        }
      }).catch(() => {
        if (this.state.lastPrompt) {
          this.state.lastAnswerText = ""
          sendPromptToAI(this.state.lastPrompt, true)
        }
      })
    })

    const backBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 126, y: bottomY, w: 64, h: bottomBtnH, radius: 14, color: 0x2b7fff })
    const backBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 126, y: bottomY, w: 64, h: bottomBtnH, text: "Ответ", text_size: 14, color: 0xffffff, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    backBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      this.state.prompt = ""
      resetToInput("Продолжите диалог:")
    })

    const positionAnswerBar = (barY, show) => {
      const widgets = Array.of(tokenBg, tokenBtn, retryBg, retryBtn, backBg, backBtn)
      for (let i = 0; i < widgets.length; i++) {
        widgets[i].setProperty(hmUI.prop.Y, barY)
        widgets[i].setProperty(hmUI.prop.VISIBLE, show)
      }
    }
    positionAnswerBar(bottomY, false)

    const showScrollableAnswer = (text, color) => {
      const textH = calcTextHeight(text)
      this.state.lastTextH = textH
      this.state.isReading = true
      displayBox.setProperty(hmUI.prop.MORE, { x: 10, y: 52, w: 180, h: textH, text: text, text_size: 16, color: color || 0xf1f5f9 })
      const barY = Math.max(bottomY, 52 + textH + 10)
      positionAnswerBar(barY, true)
      setPageScroll(barY + bottomBtnH > H)
    }
    const newChatMenuBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 6, y: 52, w: 182, h: 44, text: "+ Новый чат", text_size: 15, radius: 14, normal_color: 0x2b7fff, press_color: 0x1d4ed8, click_func: () => toggleNewChatDialog(true) })
    newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, false)
    const dlgBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 8, y: 65, w: 178, h: 215, radius: 16, color: 0x161b22 })
    const dlgTitle = hmUI.createWidget(hmUI.widget.TEXT, { x: 14, y: 74, w: 166, h: 28, text: "Режим диалога:", text_size: 15, color: 0xf8fafc, align_h: hmUI.align.CENTER_H })
    const dlgCtxBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 16, y: 108, w: 162, h: 48, text: "С памятью", text_size: 15, radius: 12, normal_color: 0x2b7fff, press_color: 0x1d4ed8,
      click_func: () => { toggleNewChatDialog(false); this.state.currentChatId = String(Date.now()); this.state.noContextMode = false; this.state.prompt = ""; this.state.lastPrompt = ""; closeChatMenu(); resetToInput("Чат с памятью:") }
    })
    const dlgNoCtxBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 16, y: 164, w: 162, h: 48, text: "Без памяти", text_size: 15, radius: 12, normal_color: 0x252c38, press_color: 0x3b4659,
      click_func: () => { toggleNewChatDialog(false); this.state.currentChatId = String(Date.now()); this.state.noContextMode = true; this.state.prompt = ""; this.state.lastPrompt = ""; closeChatMenu(); resetToInput("Разовый вопрос:") }
    })
    const dlgCancelBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 16, y: 222, w: 162, h: 44, text: "Отмена", text_size: 14, radius: 12, normal_color: 0x1c212b, press_color: 0x2d3646,
      click_func: () => toggleNewChatDialog(false)
    })

    const toggleNewChatDialog = (show) => {
      if (show) toggleKeyboard(false)
      setPageScroll(false)
      dlgBg.setProperty(hmUI.prop.VISIBLE, show); dlgTitle.setProperty(hmUI.prop.VISIBLE, show)
      dlgCtxBtn.setProperty(hmUI.prop.VISIBLE, show); dlgNoCtxBtn.setProperty(hmUI.prop.VISIBLE, show); dlgCancelBtn.setProperty(hmUI.prop.VISIBLE, show)
      newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, !show && this.state.isMenuOpen)
      if (show) { for (let i = 0; i < 5; i++) { chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, false); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, false) } }
      else if (this.state.isMenuOpen) renderChatSlots()
    }
    toggleNewChatDialog(false)

    for (let i = 0; i < 5; i++) {
      const rowY = 102 + i * 44
      const cBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 6, y: rowY, w: 142, h: 40, text: "", text_size: 14, radius: 12, normal_color: 0x1c212b, press_color: 0x2d3646, click_func: () => { const item = this.state.chatList[i]; if (!item) return; this.state.currentChatId = item.id; closeChatMenu(); toggleKeyboard(false); setPageScroll(false); displayBox.setProperty(hmUI.prop.MORE, { x: 10, y: 52, w: 180, h: promptH, text: "Открываю...", text_size: 16, color: 0x94a3b8 }); messageBuilder.request({ method: "OPEN_CHAT", params: { chatId: item.id } }).then((res) => { if (res && res.lastPrompt) this.state.lastPrompt = res.lastPrompt; showScrollableAnswer((res && res.transcript) ? res.transcript : "Пусто", 0xf1f5f9) }) } })
      const dBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 151, y: rowY, w: 37, h: 40, text: "×", text_size: 18, radius: 12, normal_color: 0x3f1d24, press_color: 0x6b2835, click_func: () => { const item = this.state.chatList[i]; if (!item) return; messageBuilder.request({ method: "DELETE_CHAT", params: { chatId: item.id } }).then((res) => { this.state.chatList = (res && Array.isArray(res.chats)) ? res.chats : []; renderChatSlots() }) } })
      cBtn.setProperty(hmUI.prop.VISIBLE, false); dBtn.setProperty(hmUI.prop.VISIBLE, false); chatSlotBtns.push(cBtn); chatDelBtns.push(dBtn)
    }
    const renderChatSlots = () => { for (let i = 0; i < 5; i++) { const item = this.state.chatList[i]; if (item) { chatSlotBtns[i].setProperty(hmUI.prop.TEXT, item.title); chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, true); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, true) } else { chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, false); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, false) } } }
    const openChatMenu = () => { this.state.isMenuOpen = true; this.state.isReading = false; setPageScroll(false); toggleKeyboard(false); positionAnswerBar(bottomY, false); displayBox.setProperty(hmUI.prop.VISIBLE, false); newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, true); messageBuilder.request({ method: "GET_CHATS" }).then((res) => { this.state.chatList = (res && Array.isArray(res.chats)) ? res.chats : []; renderChatSlots() }).catch(() => renderChatSlots()) }
    const closeChatMenu = () => { this.state.isMenuOpen = false; toggleNewChatDialog(false); newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, false); for (let i = 0; i < 5; i++) { chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, false); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, false) } displayBox.setProperty(hmUI.prop.VISIBLE, true); if (this.state.isReading) { const barY = Math.max(bottomY, 52 + this.state.lastTextH + 10); positionAnswerBar(barY, true); setPageScroll(barY + bottomBtnH > H) } else { setPageScroll(false); toggleKeyboard(true) } }
    const resetToInput = (placeholder) => { this.state.isReading = false; this.state.lastKey = -1; setPageScroll(false); positionAnswerBar(bottomY, false); displayBox.setProperty(hmUI.prop.VISIBLE, true); displayBox.setProperty(hmUI.prop.MORE, { x: 10, y: 52, w: 180, h: promptH, text: this.state.prompt || placeholder, text_size: 16, color: 0x38bdf8 }); toggleKeyboard(true) }

    const sendPromptToAI = (textToSend, isRetry) => {
      if (lockTimer) { clearTimeout(lockTimer); lockTimer = null }
      this.state.lastKey = -1; this.state.lastPrompt = textToSend; this.state.isReading = false; setPageScroll(false)
      const selectedModel = this.state.models[this.state.modelIdx]; const myJobId = String(Date.now()).slice(-6)
      toggleKeyboard(false); positionAnswerBar(bottomY, false)
      displayBox.setProperty(hmUI.prop.VISIBLE, true)
      displayBox.setProperty(hmUI.prop.COLOR, 0xffffff)
      displayBox.setProperty(hmUI.prop.TEXT, "Передаю...")

      const pollAnswer = (attempt) => {
        if (this.state.isReading || this.state.isMenuOpen) return
        if (attempt > 65) { showScrollableAnswer("Долгий ответ. Нажмите Ещё", 0xf1f5f9); return }
        const sec = Math.round(attempt * 1.5)
        displayBox.setProperty(hmUI.prop.TEXT, "Думаю (" + sec + "с)...")
        messageBuilder.request({ method: "CHECK_AI" })
          .then((st) => {
            if (this.state.isReading) return
            if (st && st.done && st.answer && st.answer !== this.state.lastAnswerText) {
              this.state.lastAnswerText = st.answer
              showScrollableAnswer(st.answer, 0xf1f5f9)
            } else {
              setTimeout(() => pollAnswer(attempt + 1), 1500)
            }
          })
          .catch(() => setTimeout(() => pollAnswer(attempt + 1), 1500))
      }

      const chunks = []
      for (let i = 0; i < textToSend.length; i += 6) {
        chunks.push(textToSend.slice(i, i + 6))
      }

      const sendNextChunk = (idx) => {
        if (idx >= chunks.length) {
          displayBox.setProperty(hmUI.prop.TEXT, "Думаю (0с)...")
          messageBuilder.request({
            method: "ASK_AI",
            params: { useBuf: 1, max_tokens: TOKEN_PRESETS[this.state.tokenIdx], model: selectedModel, chatId: this.state.currentChatId.slice(-6), jobId: myJobId, isRetry: isRetry ? 1 : 0, noContext: this.state.noContextMode ? 1 : 0 }
          })
            .then((data) => {
              if (data && data.chatId) this.state.currentChatId = data.chatId
              if (data && data.answer) { this.state.lastAnswerText = data.answer; showScrollableAnswer(data.answer, 0xf1f5f9) }
              else setTimeout(() => pollAnswer(1), 1500)
            })
            .catch((err) => showScrollableAnswer("Сбой: " + String(err), 0xf87171))
          return
        }
        messageBuilder.request({ method: "ADD_PART", params: { p: chunks[idx], reset: idx === 0 ? 1 : 0 } })
          .then(() => sendNextChunk(idx + 1))
          .catch(() => {
            displayBox.setProperty(hmUI.prop.TEXT, "Думаю (0с)...")
            messageBuilder.request({
              method: "ASK_AI",
              params: { prompt: encodeURIComponent(textToSend), max_tokens: TOKEN_PRESETS[this.state.tokenIdx], model: selectedModel, chatId: this.state.currentChatId.slice(-6), jobId: myJobId, isRetry: isRetry ? 1 : 0, noContext: this.state.noContextMode ? 1 : 0 }
            })
              .then((data) => {
                if (data && data.chatId) this.state.currentChatId = data.chatId
                if (data && data.answer) { this.state.lastAnswerText = data.answer; showScrollableAnswer(data.answer, 0xf1f5f9) }
                else setTimeout(() => pollAnswer(1), 1500)
              })
              .catch((err) => showScrollableAnswer("Сбой: " + String(err), 0xf87171))
          })
      }

      sendNextChunk(0)
    }

    const SPACE_KEY = String.fromCharCode(95, 95, 95)
    let lockTimer = null
    const renderTypingPrompt = () => {
      if (!this.state.prompt) {
        displayBox.setProperty(hmUI.prop.COLOR, 0x38bdf8)
        displayBox.setProperty(hmUI.prop.TEXT, "Введите запрос:")
        return
      }
      const isEditing = this.state.lastKey !== -1
      displayBox.setProperty(hmUI.prop.COLOR, isEditing ? 0xfbbf24 : 0x38bdf8)
      displayBox.setProperty(hmUI.prop.TEXT, isEditing ? (this.state.prompt.slice(0, -1) + "[" + this.state.prompt.slice(-1) + "]") : this.state.prompt)
    }

    for (let idx = 0; idx < 12; idx++) {
      const btn = hmUI.createWidget(hmUI.widget.BUTTON, {
        x: 4 + (idx % 3) * 63, y: (bottomY - 188) + Math.floor(idx / 3) * 62, w: 60, h: 58,
        text: "", text_size: 16, radius: 12, normal_color: 0x1c212b, press_color: 0x2d3646,
        click_func: () => {
          const letters = LAYOUTS[MODES[this.state.modeIdx]][idx]
          if (!letters) return
          const now = Date.now()
          if (lockTimer) { clearTimeout(lockTimer); lockTimer = null }
          if (letters === SPACE_KEY) {
            this.state.prompt += " "; this.state.lastKey = -1
          } else if (letters.length === 1) {
            this.state.prompt += letters; this.state.lastKey = -1
          } else if (this.state.lastKey === idx && now - this.state.lastTapTime < 1100) {
            this.state.charIndex = (this.state.charIndex + 1) % letters.length
            this.state.prompt = this.state.prompt.slice(0, -1) + letters.charAt(this.state.charIndex)
          } else {
            this.state.lastKey = idx; this.state.charIndex = 0; this.state.prompt += letters.charAt(0)
          }
          this.state.lastTapTime = now
          renderTypingPrompt()
          if (this.state.lastKey !== -1) {
            lockTimer = setTimeout(() => {
              this.state.lastKey = -1
              renderTypingPrompt()
            }, 1100)
          }
        }
      })
      keyButtons.push(btn)
    }
    const langBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 4, y: bottomY, w: 56, h: bottomBtnH, text: "РУС", text_size: 15, radius: 14, normal_color: 0x252c38, press_color: 0x3b4659, click_func: () => { this.state.modeIdx = (this.state.modeIdx + 1) % MODES.length; this.state.lastKey = -1; updateKeyboardLabels() } })
    const delBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 64, y: bottomY, w: 50, h: bottomBtnH, text: "<", text_size: 22, radius: 14, normal_color: 0x252c38, press_color: 0x3b4659, click_func: () => { this.state.prompt = this.state.prompt.slice(0, -1); this.state.lastKey = -1; renderTypingPrompt() } })
    const askBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 118, y: bottomY, w: 72, h: bottomBtnH, text: "Отпр", text_size: 16, radius: 14, normal_color: 0x2b7fff, press_color: 0x1d4ed8, click_func: () => { if (!this.state.prompt.trim()) { displayBox.setProperty(hmUI.prop.TEXT, "Введите текст!"); return } sendPromptToAI(this.state.prompt, false) } })


    const updateKeyboardLabels = () => {
      const currentMode = MODES[this.state.modeIdx]
      langBtn.setProperty(hmUI.prop.TEXT, { RU: "РУС", EN: "ENG", NUM: "123" }[currentMode])
      const keys = LAYOUTS[currentMode]
      const isFourRows = keys.length > 9
      const btnH = isFourRows ? 43 : 58
      const stepY = isFourRows ? 46 : 62
      const startY = bottomY - (isFourRows ? 186 : 188)
      for (let i = 0; i < 12; i++) {
        const label = keys[i]
        const btn = keyButtons[i]
        if (label) {
          btn.setProperty(hmUI.prop.MORE, { x: 4 + (i % 3) * 63, y: startY + Math.floor(i / 3) * stepY, w: 60, h: btnH, text: label })
          btn.setProperty(hmUI.prop.VISIBLE, true)
        } else {
          btn.setProperty(hmUI.prop.VISIBLE, false)
        }
      }
    }
    const toggleKeyboard = (show) => {
      langBtn.setProperty(hmUI.prop.VISIBLE, show)
      delBtn.setProperty(hmUI.prop.VISIBLE, show)
      askBtn.setProperty(hmUI.prop.VISIBLE, show)
      if (show) updateKeyboardLabels()
      else for (let i = 0; i < 12; i++) keyButtons[i].setProperty(hmUI.prop.VISIBLE, false)
    }
    updateKeyboardLabels()
  }
})
