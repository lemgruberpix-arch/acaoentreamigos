(function () {
  "use strict";

  const CFG = window.RIFA_CONFIG || {};
  const selectedNumbers = new Set();
  const statusMap = new Map();
  let currentPanelIndex = 0; // 0 to 99 (Painel 01 a 100)
  let highlightedNumber = null;
  let lastReservation = null;
  let selectedProofFile = null;

  const USER_RESERVATIONS_STORAGE_KEY = "minhas_cotas_usuario_v1";

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

  const els = {
    valorNumeroHero: document.getElementById("valorNumeroHero"),
    pixHero: document.getElementById("pixHero"),
    dataSorteioHero: document.getElementById("dataSorteioHero"),
    premioInfo: document.getElementById("premioInfo"),
    responsavelInfo: document.getElementById("responsavelInfo"),
    pixKeyText: document.getElementById("pixKeyText"),
    copyPixBtn: document.getElementById("copyPixBtn"),
    shareBtn: document.getElementById("shareBtn"),
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
    goToFormBtn: document.getElementById("goToFormBtn"),
    modal: document.getElementById("successModal"),
    modalNumbers: document.getElementById("modalNumbers"),
    modalTotal: document.getElementById("modalTotal"),
    modalPixKey: document.getElementById("modalPixKey"),
    pixQrCode: document.getElementById("pixQrCode"),
    pixCopyPaste: document.getElementById("pixCopyPaste"),
    copyPixAgainBtn: document.getElementById("copyPixAgainBtn"),
    copyPixPayloadBtn: document.getElementById("copyPixPayloadBtn"),
    openWhatsAppBtn: document.getElementById("openWhatsAppBtn"),
    btnDownloadReceipt: document.getElementById("btnDownloadReceipt"),
    proofFile: document.getElementById("proofFile"),
    proofFileName: document.getElementById("proofFileName"),
    sendProofBtn: document.getElementById("sendProofBtn"),
    proofMessage: document.getElementById("proofMessage")
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    applyConfigToPage();
    initPanelControls();
    bindEvents();
    restoreLastReservation();
    loadNumbers();
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
    if (els.prevPanelBtn) els.prevPanelBtn.disabled = currentPanelIndex <= 0;
    if (els.nextPanelBtn) els.nextPanelBtn.disabled = currentPanelIndex >= totalPanels - 1;
    if (els.panelMetaText) {
      els.panelMetaText.textContent = `Painel ${String(currentPanelIndex + 1).padStart(2, "0")} de ${totalPanels} • Cotas ${formatNumberCode(first)} a ${formatNumberCode(last)} (${freeCount} livres)`;
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
      showMessage(`A cota ${formatNumberCode(num)} está ${item.status}. Exibindo no Painel ${String(panelIndex + 1).padStart(2, "0")}.`, "error");
    }
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
    showMessage(`+${picked.length} cota(s) da sorte adicionada(s): ${picked.map(formatNumberCode).join(", ")}`, "success");
  }

  function bindEvents() {
    els.copyPixBtn.addEventListener("click", () => copyText(getPixKey(), "Chave Pix copiada."));
    els.copyPixAgainBtn.addEventListener("click", () => copyText(getPixKey(), "Chave Pix copiada."));
    els.copyPixPayloadBtn.addEventListener("click", () => copyText(els.pixCopyPaste.value, "Pix copia e cola copiado."));
    if (els.btnDownloadReceipt) {
      els.btnDownloadReceipt.addEventListener("click", () => {
        downloadReservationReceipt(lastReservation);
      });
    }
    els.shareBtn.addEventListener("click", shareRaffle);
    els.refreshBtn.addEventListener("click", loadNumbers);
    els.reserveForm.addEventListener("submit", handleReservation);
    if (els.nome) {
      els.nome.addEventListener("input", () => {
        if (selectedNumbers.size > 0) {
          renderNumbers();
        }
      });
    }

    els.goToFormBtn.addEventListener("click", () => document.querySelector(".form-card").scrollIntoView({ behavior: "smooth", block: "start" }));

    if (els.prevPanelBtn) els.prevPanelBtn.addEventListener("click", () => setPanel(currentPanelIndex - 1));
    if (els.nextPanelBtn) els.nextPanelBtn.addEventListener("click", () => setPanel(currentPanelIndex + 1));
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
      if (event.key === "Escape") closeModal();
    });
  }

  async function loadNumbers() {
    try {
      setLoading(true);
      showMessage("Carregando cotas...", "info");
      const response = await apiCall("listar", {});
      normalizeNumbers(response.numeros || []);
      renderNumbers();
      updatePanelMeta();
      updateSelectionSummary();
      if (isDemoMode()) showMessage("Modo teste local: configure a URL do Apps Script para usar a planilha.", "info");
      else hideMessage();
    } catch (error) {
      console.error(error);
      showMessage(error.message || "Não foi possível carregar os números.", "error");
      normalizeNumbers([]);
      renderNumbers();
      updatePanelMeta();
    } finally {
      setLoading(false);
    }
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
      const isBusy = isReserved || isPaid;
      const isMyCota = Boolean(mySaved[num] && isBusy);

      if (isSelected) btn.classList.add("selected");
      if (isReserved) btn.classList.add("reserved");
      if (isPaid) btn.classList.add("paid");
      if (isMyCota) btn.classList.add("my-cota");
      if (item.comprovante_url && !isPaid) btn.classList.add("proof-sent");
      if (highlightedNumber === num) btn.classList.add("search-highlight");

      // Visual display: Buyer name on user's own marked/reserved cotas, STRICT PRIVACY for others
      if (isSelected) {
        const displayName = typedName || "Sua Cota";
        btn.innerHTML = `<span class="cota-num">${code}</span><span class="cota-badge" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, selecionada por você (${displayName})`);
      } else if (isMyCota) {
        const displayName = mySaved[num].nome || typedName || "Sua Cota";
        const statusLabel = isPaid ? "Paga" : "Reservada";
        btn.innerHTML = `<span class="cota-num">${code}</span><span class="cota-badge" title="${escapeHtml(displayName)} (${statusLabel})">${escapeHtml(displayName)}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, sua cota (${displayName}, ${statusLabel})`);
      } else if (isBusy) {
        // OTHER BUYERS: STRICT PRIVACY - never render other buyers' names or phone numbers!
        const statusLabel = isPaid ? "Paga" : "Reservada";
        btn.innerHTML = `<span class="cota-num">${code}</span><span class="cota-badge">${statusLabel}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, ${statusLabel}`);
      } else {
        btn.innerHTML = `<span class="cota-num">${code}</span>`;
        btn.setAttribute("aria-label", `Cota ${code}, livre`);
      }

      btn.disabled = isBusy;
      btn.addEventListener("click", () => toggleNumber(num));
      frag.appendChild(btn);
    }
    els.numbersGrid.appendChild(frag);
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
  }

  function updateSelectionSummary() {
    const sorted = getSelectedNumbers();
    const pricing = getPromotionPricing(sorted.length);
    const total = pricing.total;
    const numbersText = sorted.length ? sorted.map(formatNumberCode).join(", ") : "Nenhuma";
    els.selectedNumbersText.textContent = numbersText;
    els.selectedTotalText.textContent = formatCurrency(total);
    els.bottomSelectedText.textContent = sorted.length ? `${sorted.length} cota(s) • ${formatCurrency(total)}${pricing.discount ? ` • Economize ${formatCurrency(pricing.discount)}` : ""}` : "Nenhuma";
    els.bottomSummary.hidden = sorted.length === 0;
  }

  async function handleReservation(event) {
    event.preventDefault();

    const numeros = getSelectedNumbers();
    const nome = els.nome.value.trim();
    const whatsapp = els.whatsapp.value.trim();
    const observacao = els.observacao.value.trim();
    const pricing = getPromotionPricing(numeros.length);

    if (!numeros.length) return showMessage("Escolha pelo menos uma cota livre.", "error");
    if (nome.length < 2 || !whatsapp) return showMessage("Preencha nome completo e WhatsApp.", "error");
    const whatsappDigits = whatsapp.replace(/\D/g, "");
    if (whatsappDigits.length < 10 || whatsappDigits.length > 13) {
      return showMessage("WhatsApp inválido. Informe o DDD e o número (ex.: 22 99999-9999).", "error");
    }

    try {
      setLoading(true);
      showMessage("Conferindo se as cotas ainda estão livres...", "info");
      const response = await apiCall("reservar", {
        numeros,
        nome,
        whatsapp: whatsappDigits,
        observacao,
        valorPorNumero: getValuePerNumber(),
        precoBase: pricing.base,
        desconto: pricing.discount,
        valorTotal: pricing.total
      });

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
      localStorage.setItem("rifa-last-reservation", JSON.stringify(lastReservation));
      saveMyReservation(finalNumbers, nome, whatsapp);

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
      setLoading(false);
    }
  }

  function showSuccessModal(reservation) {
    const total = reservation.total;
    const pixPayload = buildPixPayload({ amount: total, txid: makeTxid(reservation.numeros) });
    const whatsMessage = buildWhatsAppProofMessage(reservation);

    els.modalNumbers.textContent = reservation.numeros.map(formatNumberCode).join(", ");
    els.modalTotal.textContent = formatCurrency(total);
    els.modalPixKey.textContent = getPixKey();
    els.pixCopyPaste.value = pixPayload;
    els.pixQrCode.src = buildQrUrl(pixPayload);
    els.openWhatsAppBtn.href = buildWhatsAppUrl(whatsMessage);

    els.modal.classList.add("open");
    els.modal.setAttribute("aria-hidden", "false");
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

  function restoreLastReservation() {
    try {
      const saved = localStorage.getItem("rifa-last-reservation");
      if (saved) lastReservation = JSON.parse(saved);
    } catch (error) {
      lastReservation = null;
    }
  }

  function closeModal() {
    els.modal.classList.remove("open");
    els.modal.setAttribute("aria-hidden", "true");
  }

  function getSelectedNumbers() {
    return Array.from(selectedNumbers).sort((a, b) => a - b);
  }

  function getPromotionPricing(quantity) {
    const baseUnit = getValuePerNumber();
    let remaining = Number(quantity) || 0;
    let totalCents = 0;
    const promotions = Array.isArray(CFG.PROMOCOES_COTAS) ? CFG.PROMOCOES_COTAS : [];
    promotions.slice().sort((a, b) => Number(b.quantidade) - Number(a.quantidade)).forEach((promo) => {
      const size = Number(promo.quantidade);
      const valueCents = Math.round(Number(promo.valor) * 100);
      if (!Number.isInteger(size) || size < 1 || valueCents < 0) return;
      const groups = Math.floor(remaining / size);
      totalCents += groups * valueCents;
      remaining -= groups * size;
    });
    totalCents += remaining * Math.round(baseUnit * 100);
    const base = quantity * baseUnit;
    const total = totalCents / 100;
    return { base, total, discount: Math.max(0, base - total) };
  }

  function setLoading(isLoading) {
    els.reserveBtn.disabled = isLoading;
    els.refreshBtn.disabled = isLoading;
  }

  function setProofLoading(isLoading) {
    els.sendProofBtn.disabled = isLoading;
    els.proofFile.disabled = isLoading;
  }

  function showMessage(message, type) {
    els.statusMessage.hidden = false;
    els.statusMessage.textContent = message;
    els.statusMessage.className = `message-box ${type || "info"}`;
  }

  function hideMessage() {
    els.statusMessage.hidden = true;
    els.statusMessage.textContent = "";
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
      renderNumbers();
      updatePanelMeta();
      updateSelectionSummary();
    } catch (error) {
      console.warn("Falha ao recarregar números", error);
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
      "🏍️ Rifa Honda XRE 190 2018 — concorra por R$ 20,00!",
      "",
      "Escolha sua cota de 0000 a 9999 e concorra a uma Honda XRE 190 2018 seminova pela Loteria Federal (31/12).",
      "",
      `🎟️ Valor: ${formatCurrency(getValuePerNumber())} por cota`,
      `🏆 Prêmio: ${CFG.PREMIO_RIFA || "Honda XRE 190 2018 (seminova)"}`,
      `📅 Sorteio: ${CFG.DATA_SORTEIO || "31/12 (Loteria Federal)"}`,
      `🔑 Chave Pix: ${getPixKey()}`,
      "",
      "Escolha seu número e participe. Quanto antes, melhor!"
    ].join("\n");
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
    return Number(CFG.VALOR_NUMERO || 20);
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

    const response = await fetch(CFG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...data }),
      redirect: "follow"
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error("A API respondeu em formato inválido. Verifique a publicação do Apps Script.");
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

  function buildQrUrl(payload) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(payload)}`;
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
