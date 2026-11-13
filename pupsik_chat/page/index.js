const { messageBuilder } = getApp()._options.globalData
const LAYOUTS = {
  RU: ["АБВГ", "ДЕЖЗ", "ИЙКЛ", "МНОП", "РСТУ", "ФХЦЧ", "ШЩЫЬ", "ЭЮЯ?", "___"],
  EN: ["ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ", "___"],
  NUM: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0+-=", "*/()", ".,?!"]
}
const MODES = ["RU", "EN", "NUM"]
const TOKEN_PRESETS = Array.of(300, 500, 800, 1200, 1600, 2000)
const TOKEN_COLORS = Array.of(0x1b662e, 0x4d661b, 0x7a6614, 0x884414, 0x881b1b, 0xb30000)

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
    modeIdx: 0, tokenIdx: 1, modelIdx: 0, models: Array.of("qwen2.5-7b-instruct"),
    currentChatId: String(Date.now()), noContextMode: false, chatList: [],
    isReading: false, isMenuOpen: false, confirmDel: false, lastTextH: 200
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
    const bottomBtnH = 54
    const bottomY = H - bottomBtnH - 2
    const promptH = Math.max(70, bottomY - 242)
    const keyButtons = []; const chatSlotBtns = []; const chatDelBtns = []

    const displayBox = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 6, y: 50, w: 182, h: promptH,
      text: "Новый чат. Вопрос:", text_size: 16, color: 0x00ff88,
      text_style: hmUI.text_style.WRAP
    })
    const shortName = (id) => id.replace("-instruct", "").replace("qwen", "Qwen ").slice(0, 8)
    const chatsBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 4, y: 8, w: 54, h: 36, text: "ЧАТ", text_size: 14, radius: 14,
      normal_color: 0x224433, press_color: 0x336644,
      click_func: () => { if (this.state.isMenuOpen) closeChatMenu(); else openChatMenu() }
    })
    const modelBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 61, y: 8, w: 86, h: 36, text: "Qwen 2.5", text_size: 12, radius: 14,
      normal_color: 0x1e2a38, press_color: 0x2c4257,
      click_func: () => {
        this.state.modelIdx = (this.state.modelIdx + 1) % this.state.models.length
        modelBtn.setProperty(hmUI.prop.TEXT, shortName(this.state.models[this.state.modelIdx]))
      }
    })
    const loadBtn = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 150, y: 8, w: 40, h: 36, text: "ЗАГР", text_size: 11, radius: 14,
      normal_color: 0x664400, press_color: 0x996600,
      click_func: () => {
        const cur = this.state.models[this.state.modelIdx]
        setPageScroll(false)
        displayBox.setProperty(hmUI.prop.MORE, { x: 6, y: 50, w: 182, h: promptH, text: "Гружу:\n" + cur, text_size: 16, color: 0x00ff88 })
        messageBuilder.request({ method: "LOAD_MODEL", params: { model: cur } })
          .then((res) => displayBox.setProperty(hmUI.prop.TEXT, (res && res.msg) ? res.msg : "Готово!"))
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

    const tokenBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 4, y: bottomY, w: 58, h: bottomBtnH, radius: 10, color: 0x4d661b })
    const tokenBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 4, y: bottomY, w: 58, h: bottomBtnH, text: "500Т", text_size: 15, color: 0xffffff, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    tokenBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      this.state.tokenIdx = (this.state.tokenIdx + 1) % TOKEN_PRESETS.length
      const i = this.state.tokenIdx
      tokenBg.setProperty(hmUI.prop.COLOR, TOKEN_COLORS[i])
      tokenBtn.setProperty(hmUI.prop.TEXT, String(TOKEN_PRESETS[i]) + "Т")
    })
    const retryBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 65, y: bottomY, w: 42, h: bottomBtnH, radius: 10, color: 0x226633 })
    const retryBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 65, y: bottomY, w: 42, h: bottomBtnH, text: "ПОВ", text_size: 13, color: 0xffffff, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    retryBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      if (this.state.lastPrompt) {
        sendPromptToAI(this.state.lastPrompt, true)
      } else {
        messageBuilder.request({ method: "OPEN_CHAT", params: { chatId: this.state.currentChatId } })
          .then((res) => {
            if (res && res.lastPrompt) {
              this.state.lastPrompt = res.lastPrompt
              sendPromptToAI(res.lastPrompt, true)
            }
          })
      }
    })

    const delChatBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 110, y: bottomY, w: 38, h: bottomBtnH, radius: 10, color: 0x771111 })
    const delChatBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 110, y: bottomY, w: 38, h: bottomBtnH, text: "X", text_size: 18, color: 0xffffff, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    delChatBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      if (!this.state.confirmDel) {
        this.state.confirmDel = true
        delChatBtn.setProperty(hmUI.prop.TEXT, "X?")
        delChatBg.setProperty(hmUI.prop.COLOR, 0xcc0000)
        return
      }
      this.state.confirmDel = false
      delChatBtn.setProperty(hmUI.prop.TEXT, "X")
      delChatBg.setProperty(hmUI.prop.COLOR, 0x771111)
      messageBuilder.request({ method: "DELETE_CHAT", params: { chatId: this.state.currentChatId } }).catch(() => {})
      this.state.currentChatId = String(Date.now())
      this.state.prompt = ""
      resetToInput("Чат удалён:")
    })

    const backBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 151, y: bottomY, w: 39, h: bottomBtnH, radius: 10, color: 0x1155cc })
    const backBtn = hmUI.createWidget(hmUI.widget.TEXT, { x: 151, y: bottomY, w: 39, h: bottomBtnH, text: "<-", text_size: 18, color: 0xffffff, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
    backBtn.addEventListener(hmUI.event.CLICK_UP, () => {
      this.state.prompt = ""
      resetToInput("Продолжите чат:")
    })

    const positionAnswerBar = (barY, show) => {
      const widgets = Array.of(tokenBg, tokenBtn, retryBg, retryBtn, delChatBg, delChatBtn, backBg, backBtn)
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
      displayBox.setProperty(hmUI.prop.MORE, { x: 6, y: 50, w: 182, h: textH, text: text, text_size: 16, color: color || 0xffffff })
      const barY = Math.max(bottomY, 50 + textH + 10)
      positionAnswerBar(barY, true)
      setPageScroll(barY + bottomBtnH > H)
    }
    const newChatMenuBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 6, y: 52, w: 182, h: 42, text: "+ НОВЫЙ ЧАТ", text_size: 15, radius: 10, normal_color: 0x1155cc, press_color: 0x2277ff, click_func: () => toggleNewChatDialog(true) })
    newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, false)
    const dlgBg = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 8, y: 65, w: 178, h: 215, radius: 14, color: 0x181c24 })
    const dlgTitle = hmUI.createWidget(hmUI.widget.TEXT, { x: 14, y: 74, w: 166, h: 28, text: "Выберите тип чата:", text_size: 15, color: 0xffffff, align_h: hmUI.align.CENTER_H })
    const dlgCtxBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 16, y: 108, w: 162, h: 48, text: "С КОНТЕКСТОМ", text_size: 15, radius: 10, normal_color: 0x1155cc, press_color: 0x2277ff, click_func: () => { toggleNewChatDialog(false); this.state.currentChatId = String(Date.now()); this.state.noContextMode = false; this.state.prompt = ""; this.state.lastPrompt = ""; closeChatMenu(); resetToInput("Чат с памятью:") } })
    const dlgNoCtxBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 16, y: 164, w: 162, h: 48, text: "БЕЗ КОНТЕКСТА", text_size: 15, radius: 10, normal_color: 0x662299, press_color: 0x8833cc, click_func: () => { toggleNewChatDialog(false); this.state.currentChatId = String(Date.now()); this.state.noContextMode = true; this.state.prompt = ""; this.state.lastPrompt = ""; closeChatMenu(); resetToInput("Чат без памяти:") } })
    const dlgCancelBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 16, y: 222, w: 162, h: 44, text: "ОТМЕНА", text_size: 14, radius: 10, normal_color: 0x333333, press_color: 0x555555, click_func: () => toggleNewChatDialog(false) })
    const toggleNewChatDialog = (show) => {
      dlgBg.setProperty(hmUI.prop.VISIBLE, show); dlgTitle.setProperty(hmUI.prop.VISIBLE, show)
      dlgCtxBtn.setProperty(hmUI.prop.VISIBLE, show); dlgNoCtxBtn.setProperty(hmUI.prop.VISIBLE, show); dlgCancelBtn.setProperty(hmUI.prop.VISIBLE, show)
      newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, !show && this.state.isMenuOpen)
      if (show) { for (let i = 0; i < 5; i++) { chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, false); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, false) } }
      else if (this.state.isMenuOpen) renderChatSlots()
    }
    toggleNewChatDialog(false)

    for (let i = 0; i < 5; i++) {
      const rowY = 100 + i * 44
      const cBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 6, y: rowY, w: 142, h: 40, text: "", text_size: 14, radius: 8, normal_color: 0x222222, press_color: 0x444444, click_func: () => { const item = this.state.chatList[i]; if (!item) return; this.state.currentChatId = item.id; closeChatMenu(); toggleKeyboard(false); setPageScroll(false); displayBox.setProperty(hmUI.prop.MORE, { x: 6, y: 50, w: 182, h: promptH, text: "Загрузка...", text_size: 16, color: 0xffffff }); messageBuilder.request({ method: "OPEN_CHAT", params: { chatId: item.id } }).then((res) => { if (res && res.lastPrompt) this.state.lastPrompt = res.lastPrompt; showScrollableAnswer((res && res.transcript) ? res.transcript : "Пусто", 0xffffff) }) } })
      const dBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 151, y: rowY, w: 37, h: 40, text: "X", text_size: 15, radius: 8, normal_color: 0x662222, press_color: 0x993333, click_func: () => { const item = this.state.chatList[i]; if (!item) return; messageBuilder.request({ method: "DELETE_CHAT", params: { chatId: item.id } }).then((res) => { this.state.chatList = (res && Array.isArray(res.chats)) ? res.chats : []; renderChatSlots() }) } })
      cBtn.setProperty(hmUI.prop.VISIBLE, false); dBtn.setProperty(hmUI.prop.VISIBLE, false); chatSlotBtns.push(cBtn); chatDelBtns.push(dBtn)
    }
    const renderChatSlots = () => { for (let i = 0; i < 5; i++) { const item = this.state.chatList[i]; if (item) { chatSlotBtns[i].setProperty(hmUI.prop.TEXT, item.title); chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, true); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, true) } else { chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, false); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, false) } } }
    const openChatMenu = () => { this.state.isMenuOpen = true; this.state.isReading = false; setPageScroll(false); toggleKeyboard(false); positionAnswerBar(bottomY, false); displayBox.setProperty(hmUI.prop.VISIBLE, false); newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, true); messageBuilder.request({ method: "GET_CHATS" }).then((res) => { this.state.chatList = (res && Array.isArray(res.chats)) ? res.chats : []; renderChatSlots() }).catch(() => renderChatSlots()) }
    const closeChatMenu = () => { this.state.isMenuOpen = false; toggleNewChatDialog(false); newChatMenuBtn.setProperty(hmUI.prop.VISIBLE, false); for (let i = 0; i < 5; i++) { chatSlotBtns[i].setProperty(hmUI.prop.VISIBLE, false); chatDelBtns[i].setProperty(hmUI.prop.VISIBLE, false) } displayBox.setProperty(hmUI.prop.VISIBLE, true); if (this.state.isReading) { const barY = Math.max(bottomY, 50 + this.state.lastTextH + 10); positionAnswerBar(barY, true); setPageScroll(barY + bottomBtnH > H) } else { setPageScroll(false); toggleKeyboard(true) } }
    const resetToInput = (placeholder) => { this.state.isReading = false; this.state.lastKey = -1; setPageScroll(false); positionAnswerBar(bottomY, false); displayBox.setProperty(hmUI.prop.VISIBLE, true); displayBox.setProperty(hmUI.prop.MORE, { x: 6, y: 50, w: 182, h: promptH, text: this.state.prompt || placeholder, text_size: 16, color: 0x00ff88 }); toggleKeyboard(true) }

    const sendPromptToAI = (textToSend, isRetry) => {
      this.state.lastPrompt = textToSend; this.state.isReading = false; setPageScroll(false)
      const selectedModel = this.state.models[this.state.modelIdx]; const myJobId = String(Date.now())
      toggleKeyboard(false); positionAnswerBar(bottomY, false)
      displayBox.setProperty(hmUI.prop.MORE, { x: 6, y: 50, w: 182, h: promptH, text: "Думаю...", text_size: 16, color: 0xffffff })
      const pollAnswer = (attempt) => {
        if (attempt > 300) { showScrollableAnswer("Ещё думает... Нажмите ПОВ", 0xffffff); return }
        displayBox.setProperty(hmUI.prop.TEXT, "Думаю (" + attempt + "/300)...")
        messageBuilder.request({ method: "CHECK_AI" }).then((st) => {
          if (st && st.done && st.answer) showScrollableAnswer(st.answer, 0xffffff)
          else pollAnswer(attempt + 1)
        }).catch(() => pollAnswer(attempt + 1))
      }
      messageBuilder.request({ method: "ASK_AI", params: { prompt: encodeURIComponent(textToSend), max_tokens: TOKEN_PRESETS[this.state.tokenIdx], model: selectedModel, chatId: this.state.currentChatId, jobId: myJobId, isRetry: Boolean(isRetry), noContext: Boolean(this.state.noContextMode) } })
        .then((data) => { if (data && data.chatId) this.state.currentChatId = data.chatId; if (data && data.answer) showScrollableAnswer(data.answer, 0xffffff); else pollAnswer(1) })
        .catch((err) => showScrollableAnswer("Сбой: " + String(err), 0xff6666))
    }

    const SPACE_KEY = String.fromCharCode(95, 95, 95)
    for (let idx = 0; idx < 12; idx++) {
      const btn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 3 + (idx % 3) * 63, y: (bottomY - 188) + Math.floor(idx / 3) * 62, w: 61, h: 58, text: "", text_size: 17, radius: 9, normal_color: 0x242424, press_color: 0x484848, click_func: () => { const letters = LAYOUTS[MODES[this.state.modeIdx]][idx]; if (!letters) return; const now = Date.now(); if (letters === SPACE_KEY) { this.state.prompt += " "; this.state.lastKey = -1 } else if (letters.length === 1) { this.state.prompt += letters; this.state.lastKey = -1 } else if (this.state.lastKey === idx && now - this.state.lastTapTime < 1100) { this.state.charIndex = (this.state.charIndex + 1) % letters.length; this.state.prompt = this.state.prompt.slice(0, -1) + letters.charAt(this.state.charIndex) } else { this.state.lastKey = idx; this.state.charIndex = 0; this.state.prompt += letters.charAt(0) } this.state.lastTapTime = now; displayBox.setProperty(hmUI.prop.TEXT, this.state.prompt || "Наберите вопрос:") } })
      keyButtons.push(btn)
    }
    const langBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 3, y: bottomY, w: 58, h: bottomBtnH, text: "РУС", text_size: 16, radius: 10, normal_color: 0x333333, press_color: 0x555555, click_func: () => { this.state.modeIdx = (this.state.modeIdx + 1) % MODES.length; this.state.lastKey = -1; updateKeyboardLabels() } })
    const delBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 64, y: bottomY, w: 50, h: bottomBtnH, text: "<", text_size: 22, radius: 10, normal_color: 0x662222, press_color: 0x993333, click_func: () => { this.state.prompt = this.state.prompt.slice(0, -1); this.state.lastKey = -1; displayBox.setProperty(hmUI.prop.TEXT, this.state.prompt || "Наберите вопрос:") } })
    const askBtn = hmUI.createWidget(hmUI.widget.BUTTON, { x: 117, y: bottomY, w: 74, h: bottomBtnH, text: "ОК", text_size: 19, radius: 10, normal_color: 0x1155cc, press_color: 0x2277ff, click_func: () => { if (!this.state.prompt.trim()) { displayBox.setProperty(hmUI.prop.TEXT, "Введите текст!"); return } sendPromptToAI(this.state.prompt, false) } })
    const updateKeyboardLabels = () => { const currentMode = MODES[this.state.modeIdx]; langBtn.setProperty(hmUI.prop.TEXT, { RU: "РУС", EN: "ENG", NUM: "123" }[currentMode]); const keys = LAYOUTS[currentMode]; const isFourRows = keys.length > 9; const btnH = isFourRows ? 43 : 58; const stepY = isFourRows ? 46 : 62; const startY = bottomY - (isFourRows ? 186 : 188); for (let i = 0; i < 12; i++) { const label = keys[i]; const btn = keyButtons[i]; if (label) { btn.setProperty(hmUI.prop.MORE, { x: 3 + (i % 3) * 63, y: startY + Math.floor(i / 3) * stepY, w: 61, h: btnH, text: label }); btn.setProperty(hmUI.prop.VISIBLE, true) } else btn.setProperty(hmUI.prop.VISIBLE, false) } }
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
