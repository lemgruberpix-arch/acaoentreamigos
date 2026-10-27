(function () {
  "use strict";

  const CFG = window.RIFA_CONFIG || {};
  const selectedNumbers = new Set();
  const statusMap = new Map();
  let currentPanelIndex = 0; // 0 to 99 (Painel 01 a 100)
  let highlightedNumber = null;
  let lastReservation = null;
  let selectedProofFile = null;
  let loadState = "loading"; // "loading" | "ok" | "error": o que sabemos sobre as cotas ocupadas
  let toastTimer = null;
  let resultadoNumero = null; // cota vencedora (inteiro), so depois que o resultado foi validado
  let reservingNow = false;
  let lastFocusBeforeModal = null;
  const PENDING_WINDOW_MS = 72 * 60 * 60 * 1000;

  const USER_RESERVATIONS_STORAGE_KEY = "minhas_cotas_usuario_v1";

  // ---------- Programa de indicação: o link do vendedor traz ?v=codigo (ou ?ref=codigo) ----------
  // O código fica só neste aparelho e vai junto com a reserva. Nada aparece na tela para quem clicou no link.
  const INDICADOR_STORAGE_KEY = "acao_indicador";
  let indicadorAtual = ""; // código válido do vendedor que indicou esta pessoa ("" = ninguém)

  // Igual ao servidor (apps-script/codigo.gs, sanitizeIndicador_): minúsculas, sem acento, espaço vira "-",
  // só a-z 0-9 _ -, no máximo 24 caracteres, vale com 2 ou mais. Se não servir, volta vazio.
  function sanitizeIndicador(value) {
    let text = String(value === undefined || value === null ? "" : value).toLowerCase().trim();
    if (text.normalize) text = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
    text = text.replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    return text.length >= 2 ? text : "";
  }

  function capturarIndicador() {
    let doLink = "";
    try {
      const params = new URLSearchParams((window.location && window.location.search) || "");
      doLink = sanitizeIndicador(params.get("v") || params.get("ref") || "");
    } catch (err) { /* endereço sem parâmetros legíveis: segue sem indicador novo */ }
    if (doLink) {
      indicadorAtual = doLink;
      try { localStorage.setItem(INDICADOR_STORAGE_KEY, doLink); } catch (err) { /* sem armazenamento: vale só nesta visita */ }
      return;
    }
    try {
      indicadorAtual = sanitizeIndicador(localStorage.getItem(INDICADOR_STORAGE_KEY) || "");
    } catch (err) { indicadorAtual = ""; }
  }
  capturarIndicador();

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getMySavedReservations() {
    try {
      const raw = localStorage.getItem(USER_RESERVATIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveMyReservation(numbers, name, whatsapp) {
    try {
      const current = getMySavedReservations();
      const cleanName = (name || "").trim();
      const cleanWa = (whatsapp || "").trim();
      const now = new Date().toISOString();
      (numbers || []).forEach((n) => {
        const num = Number(n);
        if (Number.isFinite(num)) {
          current[num] = {
            numero: num,
            nome: cleanName,
            whatsapp: cleanWa,
            savedAt: now
          };
        }
      });
      localStorage.setItem(USER_RESERVATIONS_STORAGE_KEY, JSON.stringify(current));
    } catch (err) {
      console.warn("Falha ao salvar cotas locais:", err);
    }
  }

  // ---------- "Meus números": reservas feitas NESTE aparelho (ficam só no navegador da pessoa) ----------
  const MY_RES_KEY = "rifa-minhas-reservas-v2";
  const MY_RES_MAX = 20;
  const MY_RES_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const PUBLIC_SITE_URL = "https://acaoentreamigos.pages.dev/";
  let memoryReservations = []; // plano B quando o navegador não deixa guardar nada
  let lastFocusBeforeMeus = null;
  let modalReservation = null; // reserva mostrada na janela do Pix agora
  let meusFresh = false; // a última conferência das cotas deu certo?

  function cleanMyReservations(list) {
    const now = Date.now();
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r === "object" && typeof r.id === "string" && r.id && Array.isArray(r.numeros) && r.numeros.length)
      .map((r) => ({
        id: r.id,
        numeros: r.numeros.map(Number).filter((n) => Number.isInteger(n) && n >= 0),
        total: Number(r.total) || 0,
        nome: String(r.nome || ""),
        whatsapp: String(r.whatsapp || ""),
        criado_em: String(r.criado_em || "")
      }))
      .filter((r) => {
        const t = new Date(r.criado_em).getTime();
        return r.numeros.length && Number.isFinite(t) && now - t <= MY_RES_MAX_AGE_MS && !seen.has(r.id) && seen.add(r.id);
      })
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .slice(0, MY_RES_MAX);
  }

  function loadMyReservations() {
    try {
      const raw = localStorage.getItem(MY_RES_KEY);
      if (raw) return cleanMyReservations(JSON.parse(raw));
    } catch (err) { /* sem armazenamento: usa a memória desta visita */ }
    return cleanMyReservations(memoryReservations);
  }

  function persistMyReservations(list) {
    memoryReservations = list;
    try {
      localStorage.setItem(MY_RES_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn("Não foi possível guardar as reservas neste aparelho.", err);
    }
  }

  function saveMyReservationRecord(reservation) {
    if (!reservation || !Array.isArray(reservation.numeros) || !reservation.numeros.length) return null;
    const record = {
      id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      numeros: reservation.numeros.map(Number),
      total: Number(reservation.total) || 0,
      nome: String(reservation.nome || ""),
      whatsapp: String(reservation.whatsapp || ""),
      criado_em: reservation.criado_em || new Date().toISOString()
    };
    persistMyReservations(cleanMyReservations([record].concat(loadMyReservations())));
    return record;
  }

  const els = {
    valorNumeroHero: document.getElementById("valorNumeroHero"),
    pixHero: document.getElementById("pixHero"),
    dataSorteioHero: document.getElementById("dataSorteioHero"),
    premioInfo: document.getElementById("premioInfo"),
    responsavelInfo: document.getElementById("responsavelInfo"),
    pixKeyText: document.getElementById("pixKeyText"),
    copyPixBtn: document.getElementById("copyPixBtn"),
    shareBtn: document.getElementById("shareBtn"),
    shareHeroBtn: document.getElementById("shareHeroBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    prevPanelBtn: document.getElementById("prevPanelBtn"),
    nextPanelBtn: document.getElementById("nextPanelBtn"),
    panelSelect: document.getElementById("panelSelect"),
    searchNumberInput: document.getElementById("searchNumberInput"),
    searchNumberBtn: document.getElementById("searchNumberBtn"),
    panelMetaText: document.getElementById("panelMetaText"),
    statusMessage: document.getElementById("statusMessage"),
    numbersGrid: document.getElementById("numbersGrid"),
    selectedNumbersText: document.getElementById("selectedNumbersText"),
    selectedTotalText: document.getElementById("selectedTotalText"),
    reserveForm: document.getElementById("reserveForm"),
    reserveBtn: document.getElementById("reserveBtn"),
    nome: document.getElementById("nome"),
    whatsapp: document.getElementById("whatsapp"),
    observacao: document.getElementById("observacao"),
    bottomSummary: document.getElementById("bottomSummary"),
    bottomSelectedText: document.getElementById("bottomSelectedText"),
    bottomTotalText: document.getElementById("bottomTotalText"),
    bottomSavingsText: document.getElementById("bottomSavingsText"),
    selectedCountText: document.getElementById("selectedCountText"),
    selectedSavingsRow: document.getElementById("selectedSavingsRow"),
    selectedSavingsText: document.getElementById("selectedSavingsText"),
    selectionLive: document.getElementById("selectionLive"),
    statusMessageText: document.getElementById("statusMessageText"),
    statusCloseBtn: document.getElementById("statusCloseBtn"),
    pendingReservation: document.getElementById("pendingReservation"),
    pendingNumbers: document.getElementById("pendingNumbers"),
    reopenPixBtn: document.getElementById("reopenPixBtn"),
    prevPanelBtnBottom: document.getElementById("prevPanelBtnBottom"),
    nextPanelBtnBottom: document.getElementById("nextPanelBtnBottom"),
    goToFormBtn: document.getElementById("goToFormBtn"),
    modal: document.getElementById("successModal"),
    modalNumbers: document.getElementById("modalNumbers"),
    modalTotal: document.getElementById("modalTotal"),
    modalPixKey: document.getElementById("modalPixKey"),
    pixQrCode: document.getElementById("pixQrCode"),
    pixQrFallback: document.getElementById("pixQrFallback"),
    pixHomeQr: document.getElementById("pixHomeQr"),
    pixHomeQrFallback: document.getElementById("pixHomeQrFallback"),
    copyPixStaticBtn: document.getElementById("copyPixStaticBtn"),
    meusBtn: document.getElementById("meusBtn"),
    meusModal: document.getElementById("meusModal"),
    meusList: document.getElementById("meusList"),
    meusEmpty: document.getElementById("meusEmpty"),
    meusStatus: document.getElementById("meusStatus"),
    meusRefreshBtn: document.getElementById("meusRefreshBtn"),
    pixCopyPaste: document.getElementById("pixCopyPaste"),
    copyPixAgainBtn: document.getElementById("copyPixAgainBtn"),
    copyPixPayloadBtn: document.getElementById("copyPixPayloadBtn"),
    openWhatsAppBtn: document.getElementById("openWhatsAppBtn"),
    btnDownloadReceipt: document.getElementById("btnDownloadReceipt"),
    proofFile: document.getElementById("proofFile"),
    proofFileName: document.getElementById("proofFileName"),
    sendProofBtn: document.getElementById("sendProofBtn"),
    proofMessage: document.getElementById("proofMessage"),
    resultadoCard: document.getElementById("resultadoCard"),
    resultadoLive: document.getElementById("resultadoLive"),
    resultadoDemo: document.getElementById("resultadoDemo"),
    resultadoData: document.getElementById("resultadoData"),
    resultadoCota: document.getElementById("resultadoCota"),
    resultadoRegra: document.getElementById("resultadoRegra"),
    resultadoPremios: document.getElementById("resultadoPremios"),
    resultadoAviso: document.getElementById("resultadoAviso"),
    resultadoVerBtn: document.getElementById("resultadoVerBtn")
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    applyConfigToPage();
    renderHomeQr();
    initPanelControls();
    renderComboLabels();
    renderSkeleton();
    bindEvents();
    restoreLastReservation();
    updateSelectionSummary();
    renderPendingBanner();
    loadNumbers();
    loadResultado();
  }

  function applyConfigToPage() {
    els.valorNumeroHero.textContent = formatCurrency(getValuePerNumber());
    els.pixHero.textContent = getPixKey();
    els.pixKeyText.textContent = getPixKey();
    els.dataSorteioHero.textContent = CFG.DATA_SORTEIO || "31/12 (Loteria Federal)";
    els.premioInfo.textContent = CFG.PREMIO_RIFA || "Honda XRE 190 2018 (seminova)";
    els.responsavelInfo.textContent = CFG.RESPONSAVEL_NOME || "Welington Santos";
  }

  function getPanelSize() {
    return Number(CFG.TAMANHO_PAINEL || 100);
  }

  function getStartNumber() {
    return Number.isFinite(Number(CFG.NUMERO_INICIAL)) ? Number(CFG.NUMERO_INICIAL) : 0;
  }

  function getTotalQuantity() {
    return Number(CFG.QUANTIDADE_NUMEROS || 10000);
  }

  function getTotalPanels() {
    return Math.max(1, Math.ceil(getTotalQuantity() / getPanelSize()));
  }

  function formatNumberCode(num) {
    const digits = getTotalQuantity() > 100 ? 4 : 2;
    return String(num).padStart(digits, "0");
  }

  function initPanelControls() {
    if (!els.panelSelect) return;
    const totalPanels = getTotalPanels();
    const panelSize = getPanelSize();
    const startBase = getStartNumber();

    els.panelSelect.innerHTML = "";
    for (let p = 0; p < totalPanels; p += 1) {
      const first = startBase + p * panelSize;
      const last = Math.min(startBase + getTotalQuantity() - 1, first + panelSize - 1);
      const opt = document.createElement("option");
      opt.value = String(p);
      opt.textContent = `Painel ${String(p + 1).padStart(2, "0")} (${formatNumberCode(first)} a ${formatNumberCode(last)})`;
      els.panelSelect.appendChild(opt);
    }
    els.panelSelect.value = String(currentPanelIndex);
    updatePanelMeta();
  }

  function updatePanelMeta() {
    const totalPanels = getTotalPanels();
    const panelSize = getPanelSize();
    const startBase = getStartNumber();
    const first = startBase + currentPanelIndex * panelSize;
    const last = Math.min(startBase + getTotalQuantity() - 1, first + panelSize - 1);

    let freeCount = 0;
    for (let n = first; n <= last; n += 1) {
      const info = statusMap.get(n);
      if (!info || info.status === "livre") freeCount += 1;
    }

    if (els.panelSelect) els.panelSelect.value = String(currentPanelIndex);
    const atFirst = currentPanelIndex <= 0;
    const atLast = currentPanelIndex >= totalPanels - 1;
    if (els.prevPanelBtn) els.prevPanelBtn.disabled = atFirst;
    if (els.nextPanelBtn) els.nextPanelBtn.disabled = atLast;
    if (els.prevPanelBtnBottom) els.prevPanelBtnBottom.disabled = atFirst;
    if (els.nextPanelBtnBottom) els.nextPanelBtnBottom.disabled = atLast;
    if (els.panelMetaText) {
      let tail = "";
      if (loadState === "loading") tail = " (carregando…)";
      else if (loadState === "error") tail = " (status indisponível)";
      else if (freeCount === 0) tail = " (nenhuma livre: veja outro painel)";
      else tail = ` (${freeCount} ${freeCount === 1 ? "livre" : "livres"})`;
      els.panelMetaText.textContent = `Painel ${String(currentPanelIndex + 1).padStart(2, "0")} de ${totalPanels} • Cotas ${formatNumberCode(first)} a ${formatNumberCode(last)}${tail}`;
    }
  }

  function setPanel(index) {
    const totalPanels = getTotalPanels();
    currentPanelIndex = Math.max(0, Math.min(totalPanels - 1, Number(index) || 0));
    renderNumbers();
    updatePanelMeta();
  }

  function handleSearchNumber() {
    if (!els.searchNumberInput) return;
    const raw = els.searchNumberInput.value.replace(/\D/g, "");
    if (!raw) {
      showMessage("Digite um número de 0000 a 9999 para buscar.", "info");
      return;
    }
    const num = Number(raw);
    const startBase = getStartNumber();
    const maxNum = startBase + getTotalQuantity() - 1;
    if (!Number.isFinite(num) || num < startBase || num > maxNum) {
      showMessage(`Número inválido. Digite entre ${formatNumberCode(startBase)} e ${formatNumberCode(maxNum)}.`, "error");
      return;
    }

    const panelIndex = Math.floor((num - startBase) / getPanelSize());
    highlightedNumber = num;
    setPanel(panelIndex);

    const item = getNumberInfo(num);
    if (item.status === "livre") {
      selectedNumbers.add(num);
      renderNumbers();
      updateSelectionSummary();
      showMessage(`Cota ${formatNumberCode(num)} localizada no Painel ${String(panelIndex + 1).padStart(2, "0")} e selecionada!`, "success");
    } else {
      const busyText = item.status === "pago" ? "já foi paga" : "já está reservada";
      showMessage(`A cota ${formatNumberCode(num)} ${busyText}. Exibindo no Painel ${String(panelIndex + 1).padStart(2, "0")}.`, "error");
    }
    scrollToNumber(num);
  }

  function handleQuickPick(count) {
    const startBase = getStartNumber();
    const totalQty = getTotalQuantity();
    const panelSize = getPanelSize();
    const panelFirst = startBase + currentPanelIndex * panelSize;
    const panelLast = Math.min(startBase + totalQty - 1, panelFirst + panelSize - 1);

    const freeInPanel = [];
    for (let n = panelFirst; n <= panelLast; n += 1) {
      if (getNumberInfo(n).status === "livre" && !selectedNumbers.has(n)) {
        freeInPanel.push(n);
      }
    }

    let pool = freeInPanel;
    if (pool.length < count) {
      pool = [];
      for (let n = startBase; n < startBase + totalQty; n += 1) {
        if (getNumberInfo(n).status === "livre" && !selectedNumbers.has(n)) {
          pool.push(n);
        }
      }
    }

    if (!pool.length) {
      showMessage("Não há mais cotas livres disponíveis para adicionar.", "error");
      return;
    }

    const picked = [];
    for (let i = 0; i < count && pool.length > 0; i += 1) {
      const idx = Math.floor(Math.random() * pool.length);
      const chosen = pool.splice(idx, 1)[0];
      selectedNumbers.add(chosen);
      picked.push(chosen);
    }

    highlightedNumber = picked[picked.length - 1];
    renderNumbers();
    updateSelectionSummary();
    const pickedSorted = picked.slice().sort((a, b) => a - b);
    showMessage(`${picked.length === 1 ? "1 cota adicionada" : `${picked.length} cotas adicionadas`}: ${pickedSorted.map(formatNumberCode).join(", ")}`, "success");
  }

  function bindEvents() {
    els.resultadoVerBtn.addEventListener("click", goToResultadoCota);
    els.copyPixBtn.addEventListener("click", () => copyText(getPixKey(), "Chave Pix copiada."));
    els.copyPixAgainBtn.addEventListener("click", () => copyText(getPixKey(), "Chave Pix copiada."));
    els.copyPixPayloadBtn.addEventListener("click", () => {
      const code = els.pixCopyPaste.value;
      const valor = modalReservation && modalReservation.total ? ` Já vai com o valor de ${formatCurrency(modalReservation.total)}.` : "";
      copyText(code, `Código Pix copiado.${valor} Cole no app do seu banco.`);
    });
    if (els.copyPixStaticBtn) {
      els.copyPixStaticBtn.addEventListener("click", () => copyText(buildStaticPixPayload(), "Código Pix copiado (sem valor). Cole no app do seu banco e digite o valor."));
    }
    if (els.meusBtn) els.meusBtn.addEventListener("click", openMeus);
    if (els.meusRefreshBtn) els.meusRefreshBtn.addEventListener("click", refreshMeus);
    if (els.meusList) els.meusList.addEventListener("click", onMeusListClick);
    document.querySelectorAll("[data-close-meus]").forEach((btn) => btn.addEventListener("click", closeMeus));
    if (els.btnDownloadReceipt) {
      els.btnDownloadReceipt.addEventListener("click", () => {
        downloadReservationReceipt(lastReservation);
      });
    }
    els.shareBtn.addEventListener("click", shareRaffle);
    if (els.shareHeroBtn) els.shareHeroBtn.addEventListener("click", shareRaffle);
    els.refreshBtn.addEventListener("click", () => loadNumbers({ announce: true }));
    if (els.statusCloseBtn) els.statusCloseBtn.addEventListener("click", hideMessage);
    if (els.reopenPixBtn) els.reopenPixBtn.addEventListener("click", () => { if (lastReservation) showSuccessModal(lastReservation); });
    els.numbersGrid.addEventListener("click", (event) => {
      const chip = event.target.closest ? event.target.closest(".number-button") : null;
      if (chip && !chip.disabled) toggleNumber(Number(chip.getAttribute("data-number")));
    });
    ["nome", "whatsapp"].forEach((key) => {
      if (els[key]) els[key].addEventListener("input", () => els[key].removeAttribute("aria-invalid"));
    });
    els.reserveForm.addEventListener("submit", handleReservation);
    if (els.nome) {
      els.nome.addEventListener("input", () => {
        if (selectedNumbers.size > 0) {
          renderNumbers();
        }
      });
    }

    els.goToFormBtn.addEventListener("click", () => {
      if (!selectedNumbers.size) {
        scrollToElement(document.getElementById("cartela"));
        showMessage("Escolha pelo menos uma cota livre na cartela ou em um combo.", "info");
        return;
      }
      scrollToElement(document.querySelector(".form-card"));
    });

    if (els.prevPanelBtn) els.prevPanelBtn.addEventListener("click", () => setPanel(currentPanelIndex - 1));
    if (els.nextPanelBtn) els.nextPanelBtn.addEventListener("click", () => setPanel(currentPanelIndex + 1));
    if (els.prevPanelBtnBottom) els.prevPanelBtnBottom.addEventListener("click", () => { setPanel(currentPanelIndex - 1); scrollToElement(document.getElementById("cartela")); });
    if (els.nextPanelBtnBottom) els.nextPanelBtnBottom.addEventListener("click", () => { setPanel(currentPanelIndex + 1); scrollToElement(document.getElementById("cartela")); });
    if (els.panelSelect) els.panelSelect.addEventListener("change", () => setPanel(Number(els.panelSelect.value)));
    if (els.searchNumberBtn) els.searchNumberBtn.addEventListener("click", handleSearchNumber);
    if (els.searchNumberInput) {
      els.searchNumberInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleSearchNumber();
        }
      });
    }

    document.querySelectorAll("[data-quick-pick]").forEach((btn) => {
      btn.addEventListener("click", () => handleQuickPick(Number(btn.getAttribute("data-quick-pick") || 1)));
    });
    const clearBtn = document.getElementById("clearSelectionBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        selectedNumbers.clear();
        highlightedNumber = null;
        renderNumbers();
        updateSelectionSummary();
        showMessage("Seleção de cotas limpa.", "info");
      });
    }

    els.proofFile.addEventListener("change", () => {
      selectedProofFile = els.proofFile.files && els.proofFile.files[0] ? els.proofFile.files[0] : null;
      els.proofFileName.textContent = selectedProofFile ? selectedProofFile.name : "Escolher comprovante ou print";
      hideProofMessage();
    });

    els.sendProofBtn.addEventListener("click", sendProof);

    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeModal));
    document.addEventListener("keydown", (event) => {
      if (isMeusOpen()) {
        if (event.key === "Escape") closeMeus();
        else if (event.key === "Tab") trapModalFocus(event, els.meusModal);
        return;
      }
      if (!isModalOpen()) return;
      if (event.key === "Escape") closeModal();
      else if (event.key === "Tab") trapModalFocus(event, els.modal);
    });
  }

  async function loadNumbers(options) {
    const opts = options && typeof options === "object" && !("target" in options) ? options : {};
    try {
      setLoading(true);
      els.numbersGrid.setAttribute("aria-busy", "true");
      if (opts.announce) showMessage("Atualizando cotas...", "info");
      const response = await apiCall("listar", {});
      normalizeNumbers(response.numeros || []);
      loadState = "ok";
      const removed = pruneSelection();
      renderNumbers();
      updatePanelMeta();
      updateSelectionSummary();
      renderPendingBanner();
      if (removed.length) {
        showMessage(`${removed.length === 1 ? "A cota" : "As cotas"} ${removed.map(formatNumberCode).join(", ")} ${removed.length === 1 ? "foi escolhida" : "foram escolhidas"} por outra pessoa e saiu da sua seleção.`, "error");
      } else if (isDemoMode()) {
        showMessage("Modo teste local: configure a URL do Apps Script para usar a planilha.", "info");
      } else if (opts.announce) {
        showMessage("Cotas atualizadas.", "success");
      } else {
        hideMessage();
      }
    } catch (error) {
      console.error(error);
      const hadData = loadState === "ok";
      if (!hadData) loadState = "error";
      renderNumbers();
      updatePanelMeta();
      showMessage(hadData
        ? "Não foi possível atualizar agora. Mostrando a última lista; toque em Atualizar para tentar de novo."
        : "Não foi possível conferir quais cotas já foram escolhidas. Toque em Atualizar para tentar de novo. A conferência final é feita ao reservar.", "error");
    } finally {
      els.numbersGrid.setAttribute("aria-busy", "false");
      setLoading(false);
    }
  }

  // Tira da seleção as cotas que deixaram de estar livres (ex.: outra pessoa reservou antes).
  function pruneSelection() {
    const removed = [];
    Array.from(selectedNumbers).forEach((num) => {
      if (getNumberInfo(num).status !== "livre") {
        selectedNumbers.delete(num);
        removed.push(num);
      }
    });
    return removed.sort((a, b) => a - b);
  }

  function normalizeNumbers(rows) {
    statusMap.clear();
    const startBase = getStartNumber();
    const maxNum = startBase + getTotalQuantity() - 1;

    (rows || []).forEach((row) => {
      const numero = Number(row.numero);
      if (!Number.isFinite(numero) || numero < startBase || numero > maxNum) return;
      const status = normalizeStatus(row.status);
      if (status === "livre" && !row.comprovante_url) return;
      statusMap.set(numero, {
        numero,
        status,
        comprovante_url: row.comprovante_url || ""
      });
    });
  }

  function getNumberInfo(numero) {
    return statusMap.get(numero) || { numero, status: "livre", comprovante_url: "" };
  }

  // Espaço reservado enquanto as cotas carregam (mesma altura da grade final: sem pulo de layout).
  function renderSkeleton() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < getPanelSize(); i += 1) {
      const cell = document.createElement("div");
      cell.className = "number-skeleton";
      cell.setAttribute("aria-hidden", "true");
      frag.appendChild(cell);
    }
    els.numbersGrid.innerHTML = "";
    els.numbersGrid.appendChild(frag);
  }

  function renderNumbers() {
    els.numbersGrid.innerHTML = "";
    const panelSize = getPanelSize();
    const startBase = getStartNumber();
    const first = startBase + currentPanelIndex * panelSize;
    const last = Math.min(startBase + getTotalQuantity() - 1, first + panelSize - 1);
    const frag = document.createDocumentFragment();

    const mySaved = getMySavedReservations();
    const typedName = (els.nome ? els.nome.value : "").trim();

    for (let num = first; num <= last; num += 1) {
      const item = getNumberInfo(num);
      const code = formatNumberCode(num);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "number-chip number-button";
      btn.setAttribute("data-number", String(num));

      const isSelected = selectedNumbers.has(num);
      const isReserved = item.status === "reservado";
      const isPaid = item.status === "pago";
      const isWinner = resultadoNumero !== null && num === resultadoNumero;
      const isBusy = isReserved || isPaid || isWinner;
      const isMyCota = Boolean(mySaved[num] && isBusy);

      if (isSelected) btn.classList.add("selected");
      if (isReserved) btn.classList.add("reserved");
      if (isPaid) btn.classList.add("paid");
      if (isMyCota) btn.classList.add("my-cota");
      if (item.comprovante_url && !isPaid) btn.classList.add("proof-sent");
      if (highlightedNumber === num) btn.classList.add("search-highlight");
      if (isWinner) btn.classList.add("result-winner");

      // Visual display: Buyer name on user's own marked/reserved cotas, STRICT PRIVACY for others
      if (isSelected) {
        const displayName = typedName || "Sua cota";
        btn.innerHTML = `<span class="cota-num">${code}</span><span class="cota-badge" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, selecionada por você (${displayName})`);
      } else if (isMyCota) {
        const displayName = mySaved[num].nome || typedName || "Sua cota";
        const statusLabel = isPaid ? "Paga" : "Reservada";
        btn.innerHTML = `<span class="cota-num">${code}</span><span class="cota-badge" title="${escapeHtml(displayName)} (${statusLabel})">${escapeHtml(displayName)}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, sua cota (${displayName}, ${statusLabel})`);
      } else if (isBusy) {
        // OTHER BUYERS: STRICT PRIVACY - never render other buyers' names or phone numbers!
        const statusLabel = isWinner ? "Ganhou" : isPaid ? "Paga" : "Reservada";
        btn.innerHTML = `<span class="cota-num">${code}</span><span class="cota-badge">${statusLabel}</span>`;
        btn.setAttribute("aria-label", isWinner ? `Cota ${code}, cota vencedora do sorteio` : `Cota ${code}, ${statusLabel}`);
      } else {
        btn.innerHTML = `<span class="cota-num">${code}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, livre`);
      }

      if (!isBusy) btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      btn.disabled = isBusy;
      frag.appendChild(btn);
    }
    els.numbersGrid.appendChild(frag);
  }

  function findNumberButton(num) {
    return els.numbersGrid.querySelector(`[data-number="${num}"]`);
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function scrollToElement(el) {
    if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function scrollToNumber(num) {
    const chip = findNumberButton(num);
    if (chip) chip.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  }

  function toggleNumber(numero) {
    const item = getNumberInfo(numero);
    const code = formatNumberCode(numero);
    if (!item || item.status !== "livre") {
      showMessage(`A cota ${code} já foi escolhida. Escolha outra.`, "error");
      return;
    }

    if (selectedNumbers.has(numero)) selectedNumbers.delete(numero);
    else selectedNumbers.add(numero);

    highlightedNumber = null;
    renderNumbers();
    updateSelectionSummary();
    hideMessage();
    // renderNumbers recria os botões: devolve o foco ao mesmo número (teclado e leitor de tela).
    const again = findNumberButton(numero);
    if (again) again.focus({ preventScroll: true });
  }

  function updateSelectionSummary() {
    const sorted = getSelectedNumbers();
    const count = sorted.length;
    const pricing = getPromotionPricing(count);
    const total = pricing.total;
    const hasDiscount = pricing.discount > 0;
    const countText = count === 0 ? "Nenhuma cota escolhida" : `${count} ${count === 1 ? "cota escolhida" : "cotas escolhidas"}`;
    els.selectedNumbersText.textContent = count ? sorted.map(formatNumberCode).join(", ") : "Nenhuma cota escolhida";
    els.selectedTotalText.textContent = formatCurrency(total);
    if (els.selectedCountText) els.selectedCountText.textContent = String(count);
    if (els.selectedSavingsRow) els.selectedSavingsRow.hidden = !hasDiscount;
    if (els.selectedSavingsText) els.selectedSavingsText.textContent = formatCurrency(pricing.discount);
    els.bottomSelectedText.textContent = countText;
    if (els.bottomTotalText) els.bottomTotalText.textContent = formatCurrency(total);
    if (els.bottomSavingsText) {
      els.bottomSavingsText.hidden = !hasDiscount;
      els.bottomSavingsText.textContent = `Economia ${formatCurrency(pricing.discount)}`;
    }
    els.goToFormBtn.textContent = count ? "Continuar" : "Escolher cotas";
    els.bottomSummary.classList.toggle("has-selection", count > 0);
    if (!reservingNow) els.reserveBtn.textContent = reserveButtonLabel(total, count);
    if (els.selectionLive) {
      els.selectionLive.textContent = count
        ? `${countText}. Total ${formatCurrency(total)}${hasDiscount ? `, economia de ${formatCurrency(pricing.discount)}` : ""}.`
        : "Nenhuma cota escolhida.";
    }
  }

  function reserveButtonLabel(total, count) {
    return count ? `Reservar e gerar Pix • ${formatCurrency(total)}` : "Reservar e gerar Pix";
  }

  // Preenche os combos com o preço calculado pela mesma regra do pedido (getPromotionPricing).
  function renderComboLabels() {
    document.querySelectorAll("[data-quick-pick]").forEach((btn) => {
      const qty = Number(btn.getAttribute("data-quick-pick") || 1);
      const pricing = getPromotionPricing(qty);
      const price = btn.querySelector(".combo-price");
      const note = btn.querySelector(".combo-note");
      if (price) price.textContent = formatCurrency(pricing.total);
      if (note) note.textContent = pricing.discount > 0 ? `Economia de ${formatCurrency(pricing.discount)}` : "Preço normal";
      btn.setAttribute("aria-label", `Adicionar ${qty} ${qty === 1 ? "cota" : "cotas"} por ${formatCurrency(pricing.total)}${pricing.discount > 0 ? `, economia de ${formatCurrency(pricing.discount)}` : ""}`);
    });
  }

  // Aviso de reserva ainda sem confirmação neste aparelho (para quem fechou a janela do Pix sem querer).
  function renderPendingBanner() {
    if (!els.pendingReservation) return;
    let pending = [];
    const saved = lastReservation;
    const recent = saved && saved.criado_em && Date.now() - new Date(saved.criado_em).getTime() < PENDING_WINDOW_MS;
    if (saved && recent && Array.isArray(saved.numeros)) {
      pending = saved.numeros.map(Number).filter((n) => loadState !== "ok" || getNumberInfo(n).status === "reservado");
    }
    els.pendingReservation.hidden = pending.length === 0 || isModalOpen();
    if (pending.length && els.pendingNumbers) {
      els.pendingNumbers.textContent = `Cotas ${pending.map(formatNumberCode).join(", ")}. Falta pagar o Pix e enviar o comprovante, ou aguardar a confirmação.`;
    }
  }

  async function handleReservation(event) {
    event.preventDefault();

    if (els.reserveBtn.disabled) return;
    const numeros = getSelectedNumbers();
    const nome = els.nome.value.trim();
    const whatsapp = els.whatsapp.value.trim();
    const observacao = els.observacao.value.trim();
    const pricing = getPromotionPricing(numeros.length);

    if (!numeros.length) {
      scrollToElement(document.getElementById("cartela"));
      return showMessage("Escolha pelo menos uma cota livre.", "error");
    }
    if (nome.length < 2) {
      els.nome.setAttribute("aria-invalid", "true");
      els.nome.focus();
      return showMessage("Preencha seu nome completo.", "error");
    }
    const whatsappDigits = whatsapp.replace(/\D/g, "");
    if (!whatsapp || whatsappDigits.length < 10 || whatsappDigits.length > 13) {
      els.whatsapp.setAttribute("aria-invalid", "true");
      els.whatsapp.focus();
      return showMessage("WhatsApp inválido. Informe o DDD e o número (ex.: 22 99999-9999).", "error");
    }

    try {
      reservingNow = true;
      setLoading(true);
      showMessage("Conferindo se as cotas ainda estão livres...", "info");
      const dadosReserva = {
        numeros,
        nome,
        whatsapp: whatsappDigits,
        observacao,
        valorPorNumero: getValuePerNumber(),
        precoBase: pricing.base,
        desconto: pricing.discount,
        valorTotal: pricing.total
      };
      if (indicadorAtual) dadosReserva.indicador = indicadorAtual; // sem código, o campo nem é enviado
      const response = await apiCall("reservar", dadosReserva);

      const finalNumbers = response.numeros || numeros;
      lastReservation = {
        nome,
        whatsapp,
        numeros: finalNumbers.map(Number),
        total: Number(response.valor_total ?? pricing.total),
        precoBase: Number(response.valor_base ?? pricing.base),
        desconto: Number(response.desconto ?? pricing.discount),
        observacao,
        criado_em: new Date().toISOString()
      };
      try {
        localStorage.setItem("rifa-last-reservation", JSON.stringify(lastReservation));
      } catch (storageError) {
        console.warn("Não foi possível guardar a reserva neste aparelho.", storageError);
      }
      saveMyReservation(finalNumbers, nome, whatsapp);
      saveMyReservationRecord(lastReservation);

      selectedProofFile = null;
      els.proofFile.value = "";
      els.proofFileName.textContent = "Escolher comprovante ou print";
      hideProofMessage();

      showSuccessModal(lastReservation);
      els.reserveForm.reset();
      selectedNumbers.clear();
      await loadNumbers();
    } catch (error) {
      console.error(error);
      const msg = error.message || "Não foi possível reservar. Tente novamente.";
      const match = msg.match(/(?:número|cota)\s+(\d+)/i);
      showMessage(match && /acabou|reservad|escolhid/i.test(msg) ? `A cota ${formatNumberCode(Number(match[1]))} acabou de ser escolhida. Escolha outra.` : msg, "error");
      await safeReloadNumbers();
    } finally {
      reservingNow = false;
      setLoading(false);
    }
  }

  function showSuccessModal(reservation) {
    modalReservation = reservation;
    const total = reservation.total;
    const pixPayload = buildPixPayload({ amount: total, txid: makeTxid(reservation.numeros) });
    const whatsMessage = buildWhatsAppProofMessage(reservation);

    els.modalNumbers.textContent = reservation.numeros.map(formatNumberCode).join(", ");
    els.modalTotal.textContent = formatCurrency(total);
    els.modalPixKey.textContent = getPixKey();
    els.pixCopyPaste.value = pixPayload;
    drawQrInto(els.pixQrCode, els.pixQrFallback, pixPayload, `QR Code Pix no valor de ${formatCurrency(total)}. Aponte a câmera do app do banco.`);
    els.openWhatsAppBtn.href = buildWhatsAppUrl(whatsMessage);

    openModal();
  }

  async function sendProof() {
    if (!lastReservation || !lastReservation.numeros || !lastReservation.numeros.length) {
      return showProofMessage("Faça a reserva primeiro para vincular o comprovante às cotas.", "error");
    }
    if (!selectedProofFile) {
      return showProofMessage("Escolha uma foto, print ou PDF do comprovante.", "error");
    }

    try {
      setProofLoading(true);
      showProofMessage("Preparando e enviando o comprovante...", "info");
      const fileData = await prepareProofFile(selectedProofFile);
      const response = await apiCall("enviarComprovante", {
        numeros: lastReservation.numeros,
        nome: lastReservation.nome,
        whatsapp: String(lastReservation.whatsapp || "").replace(/\D/g, ""),
        valorTotal: lastReservation.total,
        arquivoNome: fileData.name,
        arquivoMime: fileData.mimeType,
        arquivoBase64: fileData.base64
      });

      const msg = response.status === "pago"
        ? "Comprovante enviado e cotas marcadas como pagas."
        : "Comprovante enviado. Ele já apareceu no painel da responsável.";
      showProofMessage(msg, "success");
      await safeReloadNumbers();
    } catch (error) {
      console.error(error);
      showProofMessage(error.message || "Não foi possível enviar o comprovante.", "error");
    } finally {
      setProofLoading(false);
    }
  }

  async function prepareProofFile(file) {
    const isImage = /^image\//i.test(file.type || "");
    if (isImage) return compressImage(file);

    if ((file.type || "").toLowerCase() !== "application/pdf") {
      throw new Error("Tipo de arquivo não aceito. Envie uma foto, print ou PDF do comprovante.");
    }
    if (file.size > 4 * 1024 * 1024) {
      throw new Error("O arquivo está grande demais. Envie uma imagem ou PDF de até 4 MB.");
    }
    const dataUrl = await readFileAsDataUrl(file);
    return {
      name: sanitizeFileName(file.name || "comprovante.pdf"),
      mimeType: "application/pdf",
      base64: dataUrl.split(",")[1]
    };
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxSide = 1300;
          let width = img.width;
          let height = img.height;
          if (width > height && width > maxSide) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else if (height >= width && height > maxSide) {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.74);
          if (dataUrl.length > 5_500_000) reject(new Error("A imagem ficou grande demais. Envie um print mais leve."));
          else resolve({
            name: sanitizeFileName((file.name || "comprovante").replace(/\.[^.]+$/, "") + ".jpg"),
            mimeType: "image/jpeg",
            base64: dataUrl.split(",")[1]
          });
        };
        img.onerror = () => reject(new Error("Não foi possível ler a imagem do comprovante."));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(file);
    });
  }

  // Gera uma imagem simples com o resumo da reserva. NAO e comprovante de pagamento.
  function downloadReservationReceipt(reservation) {
    if (!reservation || !Array.isArray(reservation.numeros) || !reservation.numeros.length) {
      showMessage("Faça uma reserva primeiro para baixar o resumo.", "error");
      return;
    }
    try {
      const W = 900;
      const pad = 48;
      const canvas = document.createElement("canvas");
      const measure = canvas.getContext("2d");
      measure.font = "600 30px Arial, sans-serif";
      function wrap(text, maxWidth) {
        const words = String(text).split(" ");
        const out = [];
        let line = "";
        words.forEach((word) => {
          const test = line ? `${line} ${word}` : word;
          if (measure.measureText(test).width > maxWidth && line) { out.push(line); line = word; } else { line = test; }
        });
        if (line) out.push(line);
        return out;
      }
      const when = new Date(reservation.criado_em || Date.now()).toLocaleString("pt-BR");
      const rows = [
        ["Rifa", "Honda XRE 190 2018 + capacete, ou R$ 20 mil no Pix"],
        ["Nome", reservation.nome || "—"],
        ["Cotas", reservation.numeros.map(formatNumberCode).join(", ")],
        ["Valor total", formatCurrency(reservation.total)],
        ["Chave Pix", getPixKey()],
        ["Reserva feita em", when]
      ];
      const note = "Este resumo NÃO é comprovante de pagamento. A confirmação é feita pela responsável depois de conferir o Pix no banco.";
      const blocks = rows.map(([label, value]) => ({ label, lines: wrap(value, W - pad * 2) }));
      const noteLines = wrap(note, W - pad * 2);
      let height = 200;
      blocks.forEach((block) => { height += 40 + block.lines.length * 40 + 18; });
      height += noteLines.length * 38 + 70;
      canvas.width = W;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, height);
      ctx.fillStyle = "#c1121f";
      ctx.fillRect(0, 0, W, 14);
      ctx.fillStyle = "#1d2127";
      ctx.font = "800 44px Arial, sans-serif";
      ctx.fillText("Resumo da reserva", pad, 94);
      ctx.fillStyle = "#596068";
      ctx.font = "600 26px Arial, sans-serif";
      ctx.fillText("Ação Entre Amigos", pad, 140);
      let y = 200;
      blocks.forEach((block) => {
        ctx.fillStyle = "#596068";
        ctx.font = "700 24px Arial, sans-serif";
        ctx.fillText(block.label.toUpperCase(), pad, y);
        y += 40;
        ctx.fillStyle = "#1d2127";
        ctx.font = "600 30px Arial, sans-serif";
        block.lines.forEach((line) => { ctx.fillText(line, pad, y); y += 40; });
        y += 18;
      });
      ctx.fillStyle = "#9b0f19";
      ctx.font = "700 26px Arial, sans-serif";
      y += 10;
      noteLines.forEach((line) => { ctx.fillText(line, pad, y); y += 38; });
      canvas.toBlob((blob) => {
        if (!blob) { showMessage("Não foi possível gerar a imagem. Tire um print desta tela.", "error"); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "reserva-rifa-xre190.png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showMessage("Resumo da reserva salvo como imagem.", "success");
      }, "image/png");
    } catch (error) {
      console.error(error);
      showMessage("Não foi possível gerar a imagem. Tire um print desta tela.", "error");
    }
  }

  function restoreLastReservation() {
    try {
      const saved = localStorage.getItem("rifa-last-reservation");
      if (saved) lastReservation = JSON.parse(saved);
    } catch (error) {
      lastReservation = null;
    }
  }

  function isModalOpen() {
    return els.modal.getAttribute("aria-hidden") === "false";
  }

  function openModal() {
    lastFocusBeforeModal = document.activeElement;
    els.modal.classList.add("open");
    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    const card = els.modal.querySelector(".modal-card");
    if (card) card.scrollTop = 0;
    const title = document.getElementById("modalTitle");
    if (title) title.focus({ preventScroll: true });
    renderPendingBanner();
  }

  function closeModal() {
    if (!isModalOpen()) return;
    els.modal.classList.remove("open");
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    renderPendingBanner();
    const back = lastFocusBeforeModal;
    lastFocusBeforeModal = null;
    if (back && document.contains(back) && typeof back.focus === "function") back.focus({ preventScroll: true });
  }

  // Mantém o Tab dentro da janela do Pix enquanto ela está aberta.
  function trapModalFocus(event, box) {
    const items = Array.from(box.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === firstEl || !box.contains(document.activeElement) || document.activeElement.id === "modalTitle" || document.activeElement.id === "meusTitle")) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  }

  function getSelectedNumbers() {
    return Array.from(selectedNumbers).sort((a, b) => a - b);
  }

  function getPromotionPricing(quantity) {
    const baseUnit = getValuePerNumber();
    const unitCents = Math.round(baseUnit * 100);
    const qty = Number(quantity) || 0;
    const promotions = (Array.isArray(CFG.PROMOCOES_COTAS) ? CFG.PROMOCOES_COTAS : [])
      .map((promo) => ({ size: Number(promo.quantidade), cents: Math.round(Number(promo.valor) * 100) }))
      .filter((promo) => Number.isInteger(promo.size) && promo.size >= 1 && promo.cents >= 0);
    // Menor preco possivel (igual ao servidor): ex.: 12 cotas = 6+6 = R$ 200, nao 10+2 avulsas = R$ 210.
    const best = [0];
    for (let n = 1; n <= qty; n += 1) {
      let cost = best[n - 1] + unitCents;
      promotions.forEach((promo) => {
        if (n >= promo.size) cost = Math.min(cost, best[n - promo.size] + promo.cents);
      });
      best[n] = cost;
    }
    const base = (qty * unitCents) / 100;
    const total = (best[qty] || 0) / 100;
    return { base, total, discount: Math.max(0, Math.round((base - total) * 100) / 100) };
  }

  function setLoading(isLoading) {
    els.reserveBtn.disabled = isLoading;
    els.reserveBtn.setAttribute("aria-busy", String(isLoading));
    els.refreshBtn.disabled = isLoading;
    els.refreshBtn.textContent = isLoading ? "Atualizando…" : "Atualizar";
    if (reservingNow) {
      els.reserveBtn.textContent = isLoading
        ? "Reservando suas cotas…"
        : reserveButtonLabel(getPromotionPricing(selectedNumbers.size).total, selectedNumbers.size);
    }
  }

  function setProofLoading(isLoading) {
    els.sendProofBtn.disabled = isLoading;
    els.sendProofBtn.setAttribute("aria-busy", String(isLoading));
    els.sendProofBtn.textContent = isLoading ? "Enviando comprovante…" : "Enviar comprovante pelo app";
    els.proofFile.disabled = isLoading;
  }

  function showMessage(message, type) {
    const kind = type || "info";
    els.statusMessageText.textContent = message;
    els.statusMessage.className = `toast ${kind} is-visible`;
    clearTimeout(toastTimer);
    // Erros ficam até a pessoa fechar; avisos e confirmações somem sozinhos.
    if (kind !== "error") toastTimer = setTimeout(hideMessage, kind === "success" ? 4500 : 6500);
  }

  function hideMessage() {
    clearTimeout(toastTimer);
    els.statusMessage.classList.remove("is-visible");
  }

  function showProofMessage(message, type) {
    els.proofMessage.hidden = false;
    els.proofMessage.textContent = message;
    els.proofMessage.className = `message-box ${type || "info"}`;
  }

  function hideProofMessage() {
    els.proofMessage.hidden = true;
    els.proofMessage.textContent = "";
  }

  async function safeReloadNumbers() {
    try {
      const response = await apiCall("listar", {});
      normalizeNumbers(response.numeros || []);
      loadState = "ok";
      const removed = pruneSelection();
      renderNumbers();
      updatePanelMeta();
      updateSelectionSummary();
      renderPendingBanner();
      if (removed.length) {
        showMessage(`${removed.length === 1 ? "A cota" : "As cotas"} ${removed.map(formatNumberCode).join(", ")} ${removed.length === 1 ? "foi escolhida" : "foram escolhidas"} por outra pessoa e saiu da sua seleção.`, "error");
      }
      return true;
    } catch (error) {
      console.warn("Falha ao recarregar números", error);
      return false;
    }
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      fallbackCopy(text);
    }
    showMessage(successMessage, "success");
  }

  function fallbackCopy(text) {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.left = "-999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }

  function shareRaffle() {
    const message = [
      "🏍️ Rifa Honda XRE 190 2018 — concorra por R$ 18,90!",
      "",
      "Escolha sua cota de 0000 a 9999 e concorra pela Loteria Federal (31/12).",
      "",
      `🎟️ Valor: ${formatCurrency(getValuePerNumber())} por cota`,
      `🏆 Prêmio: ${CFG.PREMIO_RIFA || "Honda XRE 190 2018 (seminova)"}`,
      `📅 Sorteio: ${CFG.DATA_SORTEIO || "31/12 (Loteria Federal)"}`,
      "",
      "Aponte a câmera ou toque no link e veja o app (só olhar não custa nada):",
      /^https?:$/.test(window.location.protocol) ? window.location.origin + window.location.pathname : ""
    ].join("\n").trim();
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }

  function buildWhatsAppProofMessage(reservation) {
    return [
      "Olá! Fiz uma reserva na Rifa Honda XRE 190 2018.",
      "",
      `Nome: ${reservation.nome}`,
      `WhatsApp: ${reservation.whatsapp}`,
      `Cotas escolhidas: ${reservation.numeros.map(formatNumberCode).join(", ")}`,
      `Valor total: ${formatCurrency(reservation.total)}`,
      `Chave Pix: ${getPixKey()}`,
      "",
      "Já realizei o Pix e estou enviando o comprovante para conferência. Obrigado(a)!"
    ].join("\n");
  }

  function buildWhatsAppUrl(message) {
    const phone = String(CFG.WHATSAPP_RESPONSAVEL || "").replace(/\D/g, "");
    return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function getValuePerNumber() {
    return Number(CFG.VALOR_NUMERO || 18.9);
  }

  // ---------- Resultado do sorteio ----------
  // So leitura. A resposta publica nao traz nome nem WhatsApp, e mesmo assim aqui so se le o que se conhece:
  // data, 5 premios, cota (4 digitos) e ordem. Qualquer outro campo e ignorado; resposta fora do formato = nada na tela.
  function parseResultado(raw) {
    if (!raw || typeof raw !== "object" || raw.ok !== true || raw.registrado !== true) return null;
    const dataMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw.data_extracao || ""));
    if (!dataMatch) return null;
    if (!Array.isArray(raw.premios) || raw.premios.length !== 5) return null;
    const premios = raw.premios.map((p) => (typeof p === "string" ? p.trim() : ""));
    if (!premios.every((p) => /^\d{4,10}$/.test(p))) return null;
    const ordem = raw.ordem_premio_usado === undefined ? null : raw.ordem_premio_usado;
    const numeroTxt = raw.numero_vencedor === undefined ? null : raw.numero_vencedor;
    let numero = null;
    if (ordem === null) {
      if (numeroTxt !== null) return null;
    } else {
      if (!Number.isInteger(ordem) || ordem < 1 || ordem > 6) return null;
      if (typeof numeroTxt !== "string" || !/^\d{4}$/.test(numeroTxt)) return null;
      if (ordem <= 5 && premios[ordem - 1].slice(-4) !== numeroTxt) return null;
      numero = numeroTxt;
    }
    return { data: `${dataMatch[3]}/${dataMatch[2]}/${dataMatch[1]}`, premios, ordem, numero };
  }

  function textoRegraResultado(ordem) {
    if (ordem === 1) return "Valeu o 1º prêmio: vale a cota com os mesmos 4 últimos dígitos.";
    if (ordem >= 2 && ordem <= 5) return `Valeu o ${ordem}º prêmio: as cotas dos prêmios anteriores não estavam vendidas.`;
    if (ordem === 6) return "Nenhuma das cinco cotas estava vendida: vale a cota paga logo acima do 1º prêmio.";
    return "Nenhuma cota paga: sem ganhador apurável.";
  }

  function showResultado(r, isDemo) {
    const temGanhador = r.numero !== null;
    els.resultadoData.textContent = r.data;
    els.resultadoCota.textContent = temGanhador ? `Cota ${r.numero}` : "Sem ganhador apurável";
    els.resultadoCota.classList.toggle("is-empty", !temGanhador);
    els.resultadoRegra.textContent = textoRegraResultado(r.ordem);
    els.resultadoPremios.innerHTML = r.premios.map((p, i) => {
      const usado = r.ordem === i + 1;
      const numero = usado ? `${p.slice(0, -4)}<b>${p.slice(-4)}</b>` : p;
      return `<li class="result-prize${usado ? " is-used" : ""}"><span class="result-prize-n">${i + 1}º prêmio</span><strong class="result-prize-num">${numero}</strong>${usado ? '<span class="result-prize-mark">usado</span>' : ""}</li>`;
    }).join("");
    els.resultadoAviso.hidden = !temGanhador;
    els.resultadoVerBtn.hidden = !temGanhador;
    els.resultadoDemo.hidden = !isDemo;
    els.resultadoCard.hidden = false;
    if (!isDemo) {
      els.resultadoLive.textContent = temGanhador
        ? `Resultado do sorteio disponível. Cota vencedora: ${r.numero}.`
        : "Resultado do sorteio disponível. Sem ganhador apurável.";
    }
    resultadoNumero = temGanhador ? Number(r.numero) : null;
    if (loadState !== "loading") renderNumbers();
  }

  // ?resultado=demo: resultado FICTICIO so para ver o layout (opcional: &ordem=1..6 ou &ordem=nenhuma). Nao chama a API.
  function getResultadoDemo() {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (err) { return null; }
    if (params.get("resultado") !== "demo") return null;
    const premios = ["20042", "71835", "04619", "58270", "93306"];
    const pedido = Number(params.get("ordem"));
    const ordem = Number.isInteger(pedido) && pedido >= 1 && pedido <= 6 ? pedido : (params.get("ordem") === "nenhuma" ? null : 1);
    let numero = null;
    if (ordem !== null) numero = ordem === 6 ? "0043" : premios[ordem - 1].slice(-4);
    return { ok: true, registrado: true, data_extracao: "2026-12-31", premios, numero_vencedor: numero, ordem_premio_usado: ordem };
  }

  async function loadResultado() {
    try {
      const demo = getResultadoDemo();
      let raw = demo;
      if (!demo) {
        if (isDemoMode()) return;
        const url = CFG.API_URL + (CFG.API_URL.includes("?") ? "&" : "?") + "action=resultado";
        const response = await fetch(url, { method: "GET", redirect: "follow" });
        raw = JSON.parse(await response.text());
      }
      const r = parseResultado(raw);
      if (r) showResultado(r, Boolean(demo));
    } catch (err) {
      // Falha silenciosa de proposito: sem resultado, a secao simplesmente nao aparece e a cartela segue normal.
    }
  }

  function goToResultadoCota() {
    if (resultadoNumero === null) return;
    highlightedNumber = resultadoNumero;
    setPanel(Math.floor((resultadoNumero - getStartNumber()) / getPanelSize()));
    scrollToNumber(resultadoNumero);
  }

  function getPixKey() {
    return String(CFG.PIX_KEY || "").trim();
  }

  function normalizeStatus(status) {
    const clean = String(status || "livre").toLowerCase().trim();
    return ["livre", "reservado", "pago"].includes(clean) ? clean : "livre";
  }

  function isDemoMode() {
    return !CFG.API_URL || CFG.API_URL.includes("COLE_AQUI");
  }

  async function apiCall(action, data) {
    if (isDemoMode()) return localDemoApi(action, data);

    let text;
    try {
      const response = await fetch(CFG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, ...data }),
        redirect: "follow"
      });
      text = await response.text();
    } catch (error) {
      throw new Error("Sem conexão com o servidor. Confira sua internet e tente de novo.");
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error("O servidor não respondeu como esperado. Tente de novo em instantes.");
    }
    if (!json.ok) throw new Error(json.error || "Erro na API.");
    return json;
  }

  function localDemoApi(action, data) {
    const key = "rifa-xre190-demo-ocupados-v1";
    const now = new Date().toISOString();

    function getBusyMap() {
      try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : {};
      } catch (e) {
        return {};
      }
    }

    function saveBusyMap(mapObj) {
      localStorage.setItem(key, JSON.stringify(mapObj));
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const busy = getBusyMap();
        if (action === "listar") {
          const rows = Object.values(busy);
          return resolve({ ok: true, numeros: rows });
        }

        if (action === "reservar") {
          const numeros = (data.numeros || []).map(Number);
          for (const numero of numeros) {
            const existing = busy[numero];
            if (existing && existing.status !== "livre") {
              return reject(new Error(`O número ${numero} acabou de ser escolhido.`));
            }
          }
          numeros.forEach((numero) => {
            busy[numero] = {
              numero,
              status: "reservado",
              nome: data.nome || "",
              whatsapp: data.whatsapp || "",
              valor: Number(data.valorPorNumero || getValuePerNumber()),
              data_reserva: now,
              data_pagamento: "",
              observacao: data.observacao || "",
              comprovante_url: "",
              data_comprovante: ""
            };
          });
          saveBusyMap(busy);
          return resolve({ ok: true, numeros });
        }

        if (action === "enviarComprovante") {
          const numeros = (data.numeros || []).map(Number);
          numeros.forEach((numero) => {
            const row = busy[numero];
            if (row && row.status !== "livre") {
              row.comprovante_url = "Comprovante salvo no modo teste local";
              row.data_comprovante = now;
              if (data.autoConfirmar) {
                row.status = "pago";
                row.data_pagamento = now;
              }
            }
          });
          saveBusyMap(busy);
          return resolve({ ok: true, status: data.autoConfirmar ? "pago" : "reservado" });
        }

        reject(new Error("Ação não disponível no modo teste local."));
      }, 180);
    });
  }

  // ---------- QR Code local: gerado aqui no navegador (biblioteca qrcode-generator, MIT); nada é enviado a terceiros ----------
  const QR_QUIET_MODULES = 4; // margem branca mínima exigida pelo padrão do QR
  const QR_MIN_PX = 240;

  function makeQrModel(payload) {
    const lib = window.qrcode;
    if (typeof lib !== "function") throw new Error("Biblioteca de QR Code indisponível.");
    const qr = lib(0, "M"); // versão automática, correção de erro média
    qr.addData(String(payload));
    qr.make();
    return qr;
  }

  function paintQr(canvas, payload) {
    const qr = makeQrModel(payload);
    const count = qr.getModuleCount();
    const total = count + QR_QUIET_MODULES * 2;
    const scale = Math.max(1, Math.ceil(QR_MIN_PX / total)); // pixels inteiros por módulo: borda nítida
    const size = total * scale;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) ctx.fillRect((col + QR_QUIET_MODULES) * scale, (row + QR_QUIET_MODULES) * scale, scale, scale);
      }
    }
  }

  // Desenha o QR no canvas. Se algo falhar, esconde o canvas e mostra o aviso (o "copia e cola" continua valendo).
  function drawQrInto(canvas, fallbackEl, payload, label) {
    if (!canvas) return false;
    try {
      paintQr(canvas, payload);
      canvas.hidden = false;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", label);
      if (fallbackEl) fallbackEl.hidden = true;
      return true;
    } catch (error) {
      console.warn("Não foi possível gerar o QR Code.", error);
      canvas.hidden = true;
      if (fallbackEl) fallbackEl.hidden = false;
      return false;
    }
  }

  // BR Code estático da chave, SEM valor: usa buildPixPayload e tira o campo 54 (valor), refazendo o CRC.
  function buildStaticPixPayload() {
    const full = buildPixPayload({ amount: 0, txid: "RIFA" });
    const body = full.slice(0, -8); // sem "6304" + CRC
    let out = "";
    let i = 0;
    while (i < body.length) {
      const len = Number(body.slice(i + 2, i + 4));
      if (!Number.isInteger(len) || len < 0) throw new Error("BR Code malformado.");
      const end = i + 4 + len;
      if (body.slice(i, i + 2) !== "54") out += body.slice(i, end);
      i = end;
    }
    out += "6304";
    return out + crc16(out);
  }

  function renderHomeQr() {
    if (!els.pixHomeQr) return;
    let payload = "";
    try {
      payload = buildStaticPixPayload();
    } catch (error) {
      console.warn(error);
    }
    drawQrInto(els.pixHomeQr, els.pixHomeQrFallback, payload, "QR Code da chave Pix, sem valor. Aponte a câmera do app do seu banco.");
  }

  // ---------- Meus números e recibo ----------
  function isMeusOpen() {
    return Boolean(els.meusModal) && els.meusModal.getAttribute("aria-hidden") === "false";
  }

  function openMeus() {
    if (!els.meusModal) return Promise.resolve();
    lastFocusBeforeMeus = document.activeElement;
    els.meusModal.classList.add("open");
    els.meusModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    const card = els.meusModal.querySelector(".modal-card");
    if (card) card.scrollTop = 0;
    const title = document.getElementById("meusTitle");
    if (title) title.focus({ preventScroll: true });
    return refreshMeus();
  }

  function closeMeus() {
    if (!isMeusOpen()) return;
    els.meusModal.classList.remove("open");
    els.meusModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    const back = lastFocusBeforeMeus;
    lastFocusBeforeMeus = null;
    if (back && document.contains(back) && typeof back.focus === "function") back.focus({ preventScroll: true });
  }

  // Ao abrir (ou tocar em Atualizar) rebusca a situação pública das cotas, a mesma lista da cartela.
  async function refreshMeus() {
    meusFresh = false;
    renderMeus({ text: "Conferindo a situação das cotas…", type: "info" });
    const ok = await safeReloadNumbers();
    meusFresh = ok;
    renderMeus(ok ? null : {
      text: loadState === "ok"
        ? "Não foi possível atualizar agora. Mostrando a última situação conhecida; o recibo só sai depois de uma conferência bem-sucedida."
        : "Não foi possível conferir a situação agora. Toque em Atualizar situação para tentar de novo.",
      type: "error"
    });
  }

  function statusWord(status) {
    return status === "pago" ? "paga" : status === "reservado" ? "reservada" : status === "livre" ? "liberada" : "—";
  }

  function reservationState(rec) {
    const known = loadState === "ok";
    const infos = rec.numeros.slice().sort((a, b) => a - b).map((n) => ({ n, status: known ? getNumberInfo(n).status : "" }));
    const all = (st) => infos.every((i) => i.status === st);
    const any = (st) => infos.some((i) => i.status === st);
    const out = { infos, lines: [], cls: "is-unknown", paid: false, waiting: false };
    if (!known) {
      out.lines.push("Situação indisponível agora. Toque em Atualizar situação.");
    } else if (all("pago")) {
      out.paid = true;
      out.cls = "is-paid";
      out.lines.push("Pagamento confirmado");
    } else if (all("livre")) {
      out.cls = "is-free";
      out.lines.push("Reserva liberada (o prazo acabou ou o organizador liberou)");
    } else {
      out.cls = any("reservado") ? "is-wait" : "is-free";
      if (any("reservado")) { out.waiting = true; out.lines.push("Aguardando a confirmação do Pix"); }
      if (any("livre")) out.lines.push("Parte das cotas foi liberada (o prazo acabou ou o organizador liberou)");
    }
    return out;
  }

  // Recibo só existe quando TODAS as cotas da reserva estão pagas na cartela pública.
  function canGenerateReceipt(rec) {
    return Boolean(rec) && loadState === "ok" && rec.numeros.length > 0 && rec.numeros.every((n) => getNumberInfo(n).status === "pago");
  }

  function meusItemHtml(rec) {
    const st = reservationState(rec);
    const qty = rec.numeros.length;
    const when = new Date(rec.criado_em).toLocaleString("pt-BR");
    const nums = st.infos.map((i) => `<li class="n-${i.status || "x"}"><b>${formatNumberCode(i.n)}</b><span>${statusWord(i.status)}</span></li>`).join("");
    const id = escapeHtml(rec.id);
    let actions = "";
    if (st.paid && meusFresh) {
      actions += `<button type="button" class="button button-main" data-act="receipt" data-res-id="${id}">Gerar recibo</button>`;
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        actions += `<button type="button" class="button" data-act="share" data-res-id="${id}">Compartilhar recibo</button>`;
      }
    } else if (st.paid) {
      actions += `<p class="meus-hint">Toque em Atualizar situação para liberar o recibo.</p>`;
    }
    if (st.waiting) actions += `<button type="button" class="button" data-act="pay" data-res-id="${id}">Ver Pix para pagar</button>`;
    return `<article class="meus-item ${st.cls}">`
      + `<h3>${qty === 1 ? "1 cota" : `${qty} cotas`} • ${formatCurrency(rec.total)}</h3>`
      + `<p class="meus-when">${rec.nome ? `${escapeHtml(rec.nome)} • ` : ""}reservado em ${escapeHtml(when)}</p>`
      + `<ul class="meus-nums">${nums}</ul>`
      + st.lines.map((l) => `<p class="meus-state">${escapeHtml(l)}</p>`).join("")
      + (actions ? `<div class="meus-actions">${actions}</div>` : "")
      + `</article>`;
  }

  function renderMeus(note) {
    if (!els.meusList) return;
    const list = loadMyReservations();
    els.meusList.innerHTML = list.map(meusItemHtml).join("");
    els.meusList.hidden = list.length === 0;
    if (els.meusEmpty) els.meusEmpty.hidden = list.length > 0;
    if (els.meusRefreshBtn) els.meusRefreshBtn.hidden = list.length === 0;
    if (els.meusStatus) {
      els.meusStatus.hidden = !note || list.length === 0;
      els.meusStatus.textContent = note && list.length ? note.text : "";
      els.meusStatus.className = `message-box ${note ? note.type : "info"}`;
    }
  }

  function onMeusListClick(event) {
    const target = event && event.target;
    const btn = target && target.closest ? target.closest("[data-act]") : null;
    if (!btn) return;
    const rec = loadMyReservations().find((r) => r.id === btn.getAttribute("data-res-id"));
    if (!rec) return;
    const act = btn.getAttribute("data-act");
    if (act === "receipt") generateReceipt(rec, false);
    else if (act === "share") generateReceipt(rec, true);
    else if (act === "pay") {
      lastReservation = { nome: rec.nome, whatsapp: rec.whatsapp, numeros: rec.numeros.slice(), total: rec.total, precoBase: rec.total, desconto: 0, observacao: "", criado_em: rec.criado_em };
      closeMeus();
      showSuccessModal(lastReservation);
    }
  }

  // "22 99283-9362" -> "22 9****-9362": só os 4 últimos dígitos aparecem.
  function maskWhatsapp(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
    if (d.length < 8) return "****";
    const ddd = d.length >= 10 ? d.slice(0, 2) : "";
    const middle = d.slice(ddd.length, -4);
    const first = middle.length === 5 ? middle[0] : "";
    return `${ddd ? `${ddd} ` : ""}${first}${"*".repeat(middle.length - first.length)}-${d.slice(-4)}`;
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const out = [];
    let line = "";
    String(text).split(" ").forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; } else { line = test; }
    });
    if (line) out.push(line);
    return out;
  }

  const RECEIPT_TITLE = "Recibo de participação — Ação Entre Amigos";
  const RECEIPT_NOTE = "Gerado neste aparelho a partir da situação pública das cotas (pagas na cartela). Sorteio pela Loteria Federal; regras em regulamento.html.";

  function buildReceiptCanvas(rec) {
    const W = 900;
    const pad = 48;
    const inner = W - pad * 2;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const qty = rec.numeros.length;
    const rows = [
      ["Nome", rec.nome || "—"],
      ["WhatsApp", maskWhatsapp(rec.whatsapp)],
      ["Cotas", rec.numeros.slice().sort((a, b) => a - b).map(formatNumberCode).join(", ")],
      ["Quantidade", String(qty)],
      ["Valor total", formatCurrency(rec.total)],
      ["Gerado em", new Date().toLocaleString("pt-BR")]
    ];
    ctx.font = "800 40px Arial, sans-serif";
    const titleLines = wrapCanvasText(ctx, RECEIPT_TITLE, inner);
    ctx.font = "600 30px Arial, sans-serif";
    const blocks = rows.map(([label, value]) => ({ label, lines: wrapCanvasText(ctx, value, inner) }));
    ctx.font = "600 24px Arial, sans-serif";
    const noteLines = wrapCanvasText(ctx, RECEIPT_NOTE, inner);
    let height = 60 + titleLines.length * 50 + 60;
    blocks.forEach((b) => { height += 36 + b.lines.length * 40 + 16; });
    height += 20 + noteLines.length * 34 + 20 + 40 + 40;
    canvas.width = W;
    canvas.height = height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, height);
    ctx.fillStyle = "#c1121f";
    ctx.fillRect(0, 0, W, 14);
    let y = 80;
    ctx.fillStyle = "#1d2127";
    ctx.font = "800 40px Arial, sans-serif";
    titleLines.forEach((line) => { ctx.fillText(line, pad, y); y += 50; });
    ctx.fillStyle = "#596068";
    ctx.font = "600 24px Arial, sans-serif";
    ctx.fillText("Rifa Honda XRE 190 2018", pad, y);
    y += 56;
    blocks.forEach((b) => {
      ctx.fillStyle = "#596068";
      ctx.font = "700 22px Arial, sans-serif";
      ctx.fillText(b.label.toUpperCase(), pad, y);
      y += 36;
      ctx.fillStyle = "#1d2127";
      ctx.font = "600 30px Arial, sans-serif";
      b.lines.forEach((line) => { ctx.fillText(line, pad, y); y += 40; });
      y += 16;
    });
    y += 20;
    ctx.fillStyle = "#3d434b";
    ctx.font = "600 24px Arial, sans-serif";
    noteLines.forEach((line) => { ctx.fillText(line, pad, y); y += 34; });
    y += 20;
    ctx.fillStyle = "#9b0f19";
    ctx.font = "700 24px Arial, sans-serif";
    ctx.fillText(PUBLIC_SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, ""), pad, y + 20);
    return canvas;
  }

  async function generateReceipt(rec, wantShare) {
    if (!canGenerateReceipt(rec)) {
      showMessage("O recibo só sai quando todas as cotas da reserva estão pagas.", "error");
      return false;
    }
    try {
      const canvas = buildReceiptCanvas(rec);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Sem imagem.");
      const fileName = "recibo-acao-entre-amigos.png";
      if (wantShare && typeof navigator.share === "function") {
        try {
          const file = new File([blob], fileName, { type: "image/png" });
          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: RECEIPT_TITLE });
            return true;
          }
        } catch (shareError) {
          if (shareError && shareError.name === "AbortError") return false;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showMessage("Recibo salvo como imagem.", "success");
      return true;
    } catch (error) {
      console.error(error);
      showMessage("Não foi possível gerar o recibo. Tire um print desta tela.", "error");
      return false;
    }
  }

  function buildPixPayload({ amount, txid }) {
    const key = getPixKey();
    const name = sanitizePixText(CFG.PIX_RECEBEDOR || CFG.RESPONSAVEL_NOME || "ACAO ENTRE AMIGOS", 25);
    const city = sanitizePixText(CFG.PIX_CIDADE || "CARMO", 15);
    const description = sanitizePixText("RIFA XRE 190", 72);
    const tx = sanitizePixText(txid || "RIFA", 25).replace(/[^A-Z0-9]/g, "") || "RIFA";

    const merchantAccountInfo = tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", key) + tlv("02", description));
    const payloadNoCrc =
      tlv("00", "01") +
      merchantAccountInfo +
      tlv("52", "0000") +
      tlv("53", "986") +
      tlv("54", Number(amount || 0).toFixed(2)) +
      tlv("58", "BR") +
      tlv("59", name) +
      tlv("60", city) +
      tlv("62", tlv("05", tx)) +
      "6304";

    return payloadNoCrc + crc16(payloadNoCrc);
  }

  function tlv(id, value) {
    const text = String(value || "");
    return id + String(text.length).padStart(2, "0") + text;
  }

  function crc16(payload) {
    let crc = 0xffff;
    for (let i = 0; i < payload.length; i += 1) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j += 1) {
        crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  function sanitizePixText(text, maxLen) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 .\-]/g, "")
      .trim()
      .toUpperCase()
      .slice(0, maxLen);
  }

  function sanitizeFileName(name) {
    return String(name || "comprovante.jpg")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 90);
  }

  function makeTxid(numbers) {
    return `RIFA${(numbers || []).map(formatNumberCode).join("")}${Date.now().toString().slice(-4)}`.slice(0, 25);
  }
})();
