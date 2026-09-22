import { parseRows, parsePriceToNumber, formatBRL, hasPrice, emptyLegField, classifyScope } from "./parser.js";
import { getAISettings, saveAISettings, analyzeFlightWithAI, testAIConnection } from "./ai-service.js";

const LEG_FIELDS = ["airline", "origemLabel", "destinoLabel", "data", "saida", "chegada", "duracao", "paradas"];
const LEG_PLACEHOLDERS = {
  airline: "LATAM",
  origemLabel: "GRU - Guarulhos",
  destinoLabel: "AMS - Amsterdam",
  data: "17 set.",
  saida: "18:00",
  chegada: "11:00",
  duracao: "12h0m",
  paradas: "Direto",
};
const SCOPE_OPTIONS = ["", "Nacional", "Internacional"];
const STORAGE_STATE_KEY = "workingState";
const FORM_IDS = [
  "clientName", "agencyName", "markup", "serviceFee", "validity",
  "agentName", "agentContact", "notes",
];

const flightsBody = document.getElementById("flightsBody");
const emptyState = document.getElementById("emptyState");
const captureInfo = document.getElementById("captureInfo");
const rawDetails = document.getElementById("rawDetails");
const rawTextEl = document.getElementById("rawText");
const selectAllCheckbox = document.getElementById("selectAllCheckbox");

// Elementos da interface de IA
const btnToggleSettings = document.getElementById("btnToggleSettings");
const aiSettingsPanel = document.getElementById("aiSettingsPanel");
const btnCloseSettings = document.getElementById("btnCloseSettings");
const aiProviderSelect = document.getElementById("aiProvider");
const aiModelSelect = document.getElementById("aiModel");
const aiApiKeyInput = document.getElementById("aiApiKey");
const btnToggleApiKeyVisibility = document.getElementById("btnToggleApiKeyVisibility");
const geminiHelp = document.getElementById("geminiHelp");
const openaiHelp = document.getElementById("openaiHelp");
const aiAutoUseCheckbox = document.getElementById("aiAutoUse");
const btnTestAI = document.getElementById("btnTestAI");
const btnSaveAISettings = document.getElementById("btnSaveAISettings");
const aiTestResult = document.getElementById("aiTestResult");

const btnAnalyzeAI = document.getElementById("btnAnalyzeAI");
const aiStatus = document.getElementById("aiStatus");
const aiStatusText = document.getElementById("aiStatusText");
const screenshotDetails = document.getElementById("screenshotDetails");
const screenshotImg = document.getElementById("screenshotImg");

let packages = [];
let saveTimer = null;
let currentAiSettings = null;
let lastLoadedExtraction = null;

function emptyPackage() {
  return { selected: true, precoBase: "", escopo: "", ida: emptyLegField(), volta: emptyLegField() };
}

function legHasData(leg) {
  return Boolean(leg && (leg.origemLabel || leg.destinoLabel || leg.saida || leg.chegada));
}

// ---------- Persistência entre aberturas do popup ----------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}

function currentFormValues() {
  const form = {};
  FORM_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) form[id] = el.value;
  });
  return form;
}

function saveState(extra) {
  chrome.storage.local.get(STORAGE_STATE_KEY, (data) => {
    const prev = data[STORAGE_STATE_KEY] || {};
    const next = {
      packages,
      form: currentFormValues(),
      lastExtractionAppliedAt: prev.lastExtractionAppliedAt || null,
      ...extra,
    };
    chrome.storage.local.set({ [STORAGE_STATE_KEY]: next });
  });
}

function restoreFormValues(form) {
  if (!form) return;
  FORM_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && form[id] !== undefined) el.value = form[id];
  });
}

// ---------- Renderização da tabela ----------

function appendLegInputs(tr, pkgIdx, legName, leg) {
  LEG_FIELDS.forEach((field) => {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = leg[field] || "";
    input.placeholder = LEG_PLACEHOLDERS[field] || "";
    input.dataset.leg = legName;
    input.dataset.field = field;
    td.appendChild(input);
    tr.appendChild(td);
  });
}

function renderTable() {
  flightsBody.innerHTML = "";
  emptyState.classList.toggle("hidden", packages.length > 0);

  packages.forEach((pkg, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);

    const tdCheck = document.createElement("td");
    tdCheck.className = "checkbox-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = pkg.selected !== false;
    checkbox.dataset.field = "selected";
    tdCheck.appendChild(checkbox);
    tr.appendChild(tdCheck);

    appendLegInputs(tr, idx, "ida", pkg.ida);
    appendLegInputs(tr, idx, "volta", pkg.volta);

    const tdScope = document.createElement("td");
    const scopeSelect = document.createElement("select");
    scopeSelect.dataset.field = "escopo";
    SCOPE_OPTIONS.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt || "—";
      if ((pkg.escopo || "") === opt) option.selected = true;
      scopeSelect.appendChild(option);
    });
    tdScope.appendChild(scopeSelect);
    tr.appendChild(tdScope);

    const tdPrice = document.createElement("td");
    const priceInput = document.createElement("input");
    priceInput.type = "text";
    priceInput.value = pkg.precoBase || "";
    priceInput.placeholder = "R$ 7.847";
    priceInput.dataset.field = "precoBase";
    tdPrice.appendChild(priceInput);
    tr.appendChild(tdPrice);

    const tdRemove = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.className = "remove-btn";
    removeBtn.title = "Remover pacote";
    removeBtn.addEventListener("click", () => {
      packages.splice(idx, 1);
      renderTable();
      recomputeTotals();
      scheduleSave();
    });
    tdRemove.appendChild(removeBtn);
    tr.appendChild(tdRemove);

    flightsBody.appendChild(tr);
  });

  updateSelectAllCheckbox();
}

function updateSelectAllCheckbox() {
  if (packages.length === 0) {
    selectAllCheckbox.checked = true;
    return;
  }
  selectAllCheckbox.checked = packages.every((p) => p.selected !== false);
}

function handleTableChange(e) {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const idx = Number(tr.dataset.index);
  const field = e.target.dataset.field;
  const leg = e.target.dataset.leg;
  if (!packages[idx] || !field) return;

  if (field === "selected") {
    packages[idx].selected = e.target.checked;
    recomputeTotals();
  } else if (leg) {
    packages[idx][leg][field] = e.target.value;
  } else {
    packages[idx][field] = e.target.value;
    if (field === "precoBase") recomputeTotals();
  }
  scheduleSave();
}

flightsBody.addEventListener("input", handleTableChange);
flightsBody.addEventListener("change", handleTableChange);

selectAllCheckbox.addEventListener("change", () => {
  packages.forEach((p) => (p.selected = selectAllCheckbox.checked));
  renderTable();
  recomputeTotals();
  scheduleSave();
});

document.getElementById("btnAddRow").addEventListener("click", () => {
  packages.push(emptyPackage());
  renderTable();
  scheduleSave();
});

document.getElementById("btnClearAll").addEventListener("click", () => {
  if (packages.length === 0) return;
  const ok = confirm("Limpar todos os pacotes detectados/adicionados? Essa ação não pode ser desfeita.");
  if (!ok) return;
  packages = [];
  renderTable();
  recomputeTotals();
  saveState({ lastExtractionAppliedAt: Date.now() });
});

document.getElementById("btnSelect").addEventListener("click", () => {
  saveState();
  chrome.runtime.sendMessage({ type: "start-selection" }, () => {
    window.close();
  });
});

FORM_IDS.forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    if (id === "markup" || id === "serviceFee") recomputeTotals();
    scheduleSave();
  });
});

// ---------- Cálculo compartilhado (texto, imagem, PDF e totais usam a mesma base) ----------

function computePackageFinals() {
  const markup = parseFloat(document.getElementById("markup").value) || 0;
  const computed = packages.map((pkg, index) => {
    const priceInformed = hasPrice(pkg.precoBase);
    const base = parsePriceToNumber(pkg.precoBase);
    const final = priceInformed ? base * (1 + markup / 100) : 0;
    return { index, pkg, base, final, priceInformed };
  });
  return { computed, markup };
}

function selectedComputed() {
  const { computed } = computePackageFinals();
  const selected = computed.filter((c) => c.pkg.selected !== false);
  let bestIdx = -1;
  selected.forEach((c, i) => {
    if (c.priceInformed && (bestIdx === -1 || c.final < selected[bestIdx].final)) bestIdx = i;
  });
  return { selected, bestIdx };
}

function computeTotals() {
  const serviceFee = parseFloat(document.getElementById("serviceFee").value) || 0;
  const { selected } = selectedComputed();
  const totalBase = selected.reduce((sum, c) => sum + c.base, 0);
  const { markup } = computePackageFinals();
  const totalMarkup = totalBase * (1 + markup / 100);
  const totalFinal = totalMarkup + serviceFee;
  return { totalBase, totalMarkup, totalFinal, serviceFee };
}

function recomputeTotals() {
  const { totalBase, totalMarkup, totalFinal } = computeTotals();
  document.getElementById("totalBase").textContent = formatBRL(totalBase);
  document.getElementById("totalMarkup").textContent = formatBRL(totalMarkup);
  document.getElementById("totalFinal").textContent = formatBRL(totalFinal);
}

// ---------- Configuração e Manipulação da IA ----------

const PROVIDER_MODELS = {
  gemini: [
    { value: "gemini-flash-latest", label: "Gemini Flash (Mais Recente e Rápido - Grátis)" },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash (Ultra Rápido)" },
    { value: "gemini-pro-latest", label: "Gemini Pro (Mais Preciso)" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini (Econômico e Rápido)" },
    { value: "gpt-4o", label: "GPT-4o (Completo)" },
  ],
};

function populateModelOptions(provider, selectedModel) {
  const models = PROVIDER_MODELS[provider] || PROVIDER_MODELS.gemini;
  aiModelSelect.innerHTML = "";
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    if (m.value === selectedModel) opt.selected = true;
    aiModelSelect.appendChild(opt);
  });
}

function updateProviderHelp(provider) {
  if (provider === "openai") {
    geminiHelp.classList.add("hidden");
    openaiHelp.classList.remove("hidden");
  } else {
    geminiHelp.classList.remove("hidden");
    openaiHelp.classList.add("hidden");
  }
}

async function initAISettings() {
  currentAiSettings = await getAISettings();
  aiProviderSelect.value = currentAiSettings.provider || "gemini";
  populateModelOptions(aiProviderSelect.value, currentAiSettings.model);
  aiApiKeyInput.value = currentAiSettings.apiKey || "";
  aiAutoUseCheckbox.checked = currentAiSettings.autoUseAI !== false;

  updateProviderHelp(aiProviderSelect.value);

  aiProviderSelect.addEventListener("change", () => {
    const provider = aiProviderSelect.value;
    populateModelOptions(provider);
    updateProviderHelp(provider);
  });

  btnToggleSettings.addEventListener("click", () => {
    aiSettingsPanel.classList.toggle("hidden");
  });

  btnCloseSettings.addEventListener("click", () => {
    aiSettingsPanel.classList.add("hidden");
  });

  btnToggleApiKeyVisibility.addEventListener("click", () => {
    aiApiKeyInput.type = aiApiKeyInput.type === "password" ? "text" : "password";
  });

  btnTestAI.addEventListener("click", async () => {
    const provider = aiProviderSelect.value;
    const apiKey = aiApiKeyInput.value.trim();
    const model = aiModelSelect.value;

    aiTestResult.textContent = "Testando conexão com a IA...";
    aiTestResult.style.color = "#94a3b8";

    try {
      await testAIConnection({ provider, apiKey, model });
      aiTestResult.textContent = "✅ Conexão bem-sucedida! Chave válida.";
      aiTestResult.style.color = "#4ade80";
    } catch (err) {
      aiTestResult.textContent = `❌ ${err.message}`;
      aiTestResult.style.color = "#f87171";
    }
  });

  btnSaveAISettings.addEventListener("click", async () => {
    currentAiSettings = {
      provider: aiProviderSelect.value,
      model: aiModelSelect.value,
      apiKey: aiApiKeyInput.value.trim(),
      autoUseAI: aiAutoUseCheckbox.checked,
    };
    await saveAISettings(currentAiSettings);
    aiTestResult.textContent = "💾 Configurações salvas!";
    aiTestResult.style.color = "#38bdf8";
    setTimeout(() => {
      aiSettingsPanel.classList.add("hidden");
      aiTestResult.textContent = "";
    }, 1200);
  });

  btnAnalyzeAI.addEventListener("click", () => {
    if (lastLoadedExtraction) {
      runAIAnalysis(lastLoadedExtraction, true);
    }
  });
}

async function runAIAnalysis(extraction, force = false) {
  if (!extraction) return;
  if (!currentAiSettings?.apiKey) {
    if (force) {
      alert("Por favor, configure sua chave de API nas opções de IA (botão ⚙️ IA) antes de usar.");
      aiSettingsPanel.classList.remove("hidden");
    }
    return;
  }

  aiStatus.classList.remove("hidden");
  aiStatusText.textContent = "🤖 Analisando imagem do print com IA... (reconhecendo logos e horários)";
  btnAnalyzeAI.disabled = true;

  try {
    const aiPackages = await analyzeFlightWithAI({
      screenshot: extraction.screenshot,
      rawText: extraction.rawText,
      settings: currentAiSettings,
    });

    if (aiPackages && aiPackages.length > 0) {
      aiPackages.forEach((pkg) => {
        if (!pkg.escopo) pkg.escopo = classifyScope(pkg);
        packages.push(pkg);
      });

      renderTable();
      recomputeTotals();
      saveState({ lastExtractionAppliedAt: extraction.capturedAt });

      aiStatusText.textContent = `✨ ${aiPackages.length} pacote(s) extraído(s) com precisão pela IA!`;
      setTimeout(() => {
        aiStatus.classList.add("hidden");
      }, 4000);
    } else {
      throw new Error("Nenhum voo detectado pela IA.");
    }
  } catch (err) {
    console.warn("Falha na análise com IA:", err);
    aiStatusText.textContent = `⚠️ Erro na IA (${err.message}). Usando leitor local de texto...`;

    const parsed = parseRows(extraction.rows || []);
    parsed.forEach((p) => packages.push(p));
    renderTable();
    recomputeTotals();
    saveState({ lastExtractionAppliedAt: extraction.capturedAt });

    setTimeout(() => {
      aiStatus.classList.add("hidden");
    }, 6000);
  } finally {
    btnAnalyzeAI.disabled = false;
  }
}

// ---------- Carregamento inicial: restaura estado + aplica nova captura ----------

function loadState() {
  chrome.storage.local.get([STORAGE_STATE_KEY, "lastExtraction"], async (data) => {
    const state = data[STORAGE_STATE_KEY];
    if (state) {
      packages = Array.isArray(state.packages) ? state.packages : [];
      restoreFormValues(state.form);
    }

    const extraction = data.lastExtraction;
    lastLoadedExtraction = extraction;

    if (extraction) {
      const when = new Date(extraction.capturedAt).toLocaleTimeString("pt-BR");
      captureInfo.textContent = `Última captura: "${extraction.pageTitle}" às ${when}`;

      if (extraction.screenshot) {
        screenshotImg.src = extraction.screenshot;
        screenshotDetails.classList.remove("hidden");
        btnAnalyzeAI.classList.remove("hidden");
      }

      if (extraction.rawText) {
        rawTextEl.textContent = extraction.rawText;
        rawDetails.classList.remove("hidden");
      }

      const alreadyApplied = state && state.lastExtractionAppliedAt === extraction.capturedAt;
      if (!alreadyApplied) {
        if (currentAiSettings && currentAiSettings.apiKey && currentAiSettings.autoUseAI) {
          await runAIAnalysis(extraction);
        } else {
          const parsed = parseRows(extraction.rows || []);
          parsed.forEach((p) => packages.push(p));
          saveState({ lastExtractionAppliedAt: extraction.capturedAt });
        }
      }
    }

    renderTable();
    recomputeTotals();
  });
}

// ---------- Geração do texto para WhatsApp ----------

function legBlock(label, leg) {
  if (!legHasData(leg)) return "";
  let out = `*${label}*\n`;
  out += `${leg.origemLabel || "?"} → ${leg.destinoLabel || "?"}\n`;
  const dt = [];
  if (leg.data) dt.push(leg.data);
  if (leg.saida || leg.chegada) dt.push(`${leg.saida || "?"} - ${leg.chegada || "?"}`);
  if (leg.duracao) dt.push(`(${leg.duracao})`);
  if (dt.length) out += dt.join("   ") + "\n";
  out += `${leg.paradas || "a confirmar"}\n\n`;
  return out;
}

function buildWhatsAppText() {
  const clientName = document.getElementById("clientName").value.trim();
  const agencyName = document.getElementById("agencyName").value.trim();
  const validity = document.getElementById("validity").value.trim();
  const notes = document.getElementById("notes").value.trim();
  const agentName = document.getElementById("agentName").value.trim();
  const agentContact = document.getElementById("agentContact").value.trim();
  const today = new Date().toLocaleDateString("pt-BR");

  const { selected, bestIdx } = selectedComputed();
  const divider = "---------------------------------------";

  let text = "";
  if (agencyName) text += `*${agencyName.toUpperCase()}*\n`;
  text += `Orçamento de Viagem\n`;
  if (clientName) text += `Cliente: ${clientName}\n`;
  text += `Data do orçamento: ${today}\n`;
  if (validity) text += `Validade: ${validity}\n`;
  text += "\n";

  selected.forEach((c, i) => {
    const p = c.pkg;
    const isBest = i === bestIdx;
    const tags = [];
    if (isBest) tags.push("melhor preço");
    if (p.escopo) tags.push(p.escopo.toLowerCase());
    text += `${divider}\n`;
    text += `*Opção ${i + 1}*${tags.length ? ` (${tags.join(" · ")})` : ""}\n\n`;
    text += legBlock("IDA", p.ida);
    text += legBlock("VOLTA", p.volta);
    text += `Valor: *${c.priceInformed ? formatBRL(c.final) : "sob consulta"}*\n`;
  });
  text += `${divider}\n\n`;

  const { totalFinal, serviceFee } = computeTotals();
  if (serviceFee > 0) text += `Taxa de serviço: ${formatBRL(serviceFee)}\n`;
  text += `*Total: ${formatBRL(totalFinal)}*\n`;

  if (validity) text += `\nProposta válida por ${validity}.\n`;
  if (notes) text += `${notes}\n`;

  if (agentName || agentContact) {
    text += `\n${divider}\n`;
    if (agentName) text += `Atendido(a) por: *${agentName}*\n`;
    if (agentContact) text += `${agentContact}\n`;
    text += divider;
  }

  return text.trim();
}

document.getElementById("btnCopyText").addEventListener("click", async () => {
  const text = buildWhatsAppText();
  const btn = document.getElementById("btnCopyText");
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = "✅ Copiado!";
    setTimeout(() => (btn.textContent = original), 1800);
  } catch (err) {
    alert("Não foi possível copiar automaticamente. Texto gerado:\n\n" + text);
  }
});

// ---------- Geração da imagem / PDF do orçamento ----------

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function countWrappedLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  let line = "";
  let lines = 1;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines++;
      line = word;
    } else {
      line = test;
    }
  }
  return lines;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let curY = y;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

function drawLegLine(ctx, leg, x, y, tagLabel, tagColor) {
  ctx.font = "bold 10px Arial";
  const tagW = ctx.measureText(tagLabel).width + 14;
  ctx.fillStyle = tagColor;
  roundRectPath(ctx, x, y - 12, tagW, 16, 8);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(tagLabel, x + 7, y);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 11px Arial";
  const route = [leg.origemLabel, leg.destinoLabel].filter(Boolean).join("   →   ");
  ctx.fillText(route || "—", x + tagW + 10, y);

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Arial";
  const parts = [];
  if (leg.data) parts.push(leg.data);
  if (leg.saida || leg.chegada) parts.push(`${leg.saida || "?"}–${leg.chegada || "?"}`);
  if (leg.duracao) parts.push(leg.duracao);
  if (leg.paradas) parts.push(leg.paradas);
  ctx.fillText(parts.join("    "), x, y + 17);
}

function buildQuoteCanvas() {
  const clientName = document.getElementById("clientName").value.trim();
  const agencyName = document.getElementById("agencyName").value.trim() || "Proposta de Viagem";
  const validity = document.getElementById("validity").value.trim();
  const notes = document.getElementById("notes").value.trim();
  const agentName = document.getElementById("agentName").value.trim();
  const agentContact = document.getElementById("agentContact").value.trim();

  const { selected, bestIdx } = selectedComputed();
  const { totalBase, totalFinal, serviceFee } = computeTotals();

  const width = 760;
  const margin = 32;
  const cardX = margin;
  const cardWidth = width - margin * 2;
  const headerHeight = 134;
  const totalsHeight = 90;
  const rowGap = 12;

  const canvas = document.getElementById("renderCanvas");
  const measureCtx = canvas.getContext("2d");
  measureCtx.font = "italic 13px Arial";
  const notesLines = notes ? countWrappedLines(measureCtx, notes, cardWidth - 40) : 0;
  const footerHeight =
    46 + (validity ? 22 : 0) + (notesLines ? notesLines * 18 + 6 : 0) + (agentName || agentContact ? 66 : 0) + 20;

  const rowHeights = selected.length
    ? selected.map((c) => (legHasData(c.pkg.volta) ? 148 : 96))
    : [90];
  const bodyHeight = rowHeights.reduce((s, h) => s + h + rowGap, 0);

  const height = 3 + headerHeight + 20 + bodyHeight + totalsHeight + footerHeight + margin;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#eef2f7";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
  roundRectPath(ctx, cardX + 3, 6, cardWidth, height - margin - 3, 18);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, cardX, 3, cardWidth, height - margin, 18);
  ctx.fill();

  const grad = ctx.createLinearGradient(cardX, 0, cardX + cardWidth, headerHeight);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(1, "#1e3a5f");
  ctx.save();
  roundRectPath(ctx, cardX, 3, cardWidth, headerHeight, 18);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(cardX, 0, cardWidth, headerHeight + 20);
  ctx.restore();

  const cardCenterX = cardX + cardWidth / 2;

  ctx.textAlign = "center";
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 27px Arial";
  const agencyText = agencyName;
  ctx.fillText(agencyText, cardCenterX, 46);

  const agencyTextWidth = ctx.measureText(agencyText).width;
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(cardCenterX - agencyTextWidth / 2, 56, agencyTextWidth, 3);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 15px Arial";
  ctx.fillText(clientName ? `Proposta de viagem — ${clientName}` : "Proposta de Viagem", cardCenterX, 82);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px Arial";
  const now = new Date().toLocaleDateString("pt-BR");
  const headerRight = validity ? `Gerado em ${now}  •  Válido por ${validity}` : `Gerado em ${now}`;
  ctx.fillText(headerRight, cardCenterX, 104);
  ctx.textAlign = "left";

  let y = 3 + headerHeight + 20;
  ctx.textBaseline = "alphabetic";

  if (selected.length === 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = "14px Arial";
    ctx.fillText("Nenhum pacote selecionado para esta proposta.", cardX + 28, y + 30);
    y += rowHeights[0];
  }

  selected.forEach((c, i) => {
    const p = c.pkg;
    const isBest = i === bestIdx;
    const rowH = rowHeights[i];
    const rowX = cardX + 20;
    const rowW = cardWidth - 40;

    ctx.fillStyle = isBest ? "#f0fdf4" : "#f8fafc";
    roundRectPath(ctx, rowX, y, rowW, rowH, 12);
    ctx.fill();
    ctx.strokeStyle = isBest ? "#86efac" : "#e2e8f0";
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, rowX, y, rowW, rowH, 12);
    ctx.stroke();

    const badgeCx = rowX + 24;
    const badgeCy = y + 22;
    ctx.fillStyle = isBest ? "#16a34a" : "#334155";
    ctx.beginPath();
    ctx.arc(badgeCx, badgeCy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), badgeCx, badgeCy + 4);
    ctx.textAlign = "left";

    const textX = rowX + 50;

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 13px Arial";
    const title = `Opção ${i + 1}${p.ida.airline ? " — " + p.ida.airline : ""}`;
    ctx.fillText(title, textX, y + 20);
    if (isBest) {
      const tw = ctx.measureText(title).width;
      ctx.fillStyle = "#16a34a";
      ctx.font = "bold 10px Arial";
      ctx.fillText("MELHOR PREÇO", textX + tw + 10, y + 19);
    }

    drawLegLine(ctx, p.ida, textX, y + 40, "IDA", "#0c4a6e");
    if (legHasData(p.volta)) {
      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(textX, y + 70);
      ctx.lineTo(rowX + rowW - 24, y + 70);
      ctx.stroke();
      drawLegLine(ctx, p.volta, textX, y + 90, "VOLTA", "#3730a3");
    }

    const priceText = c.priceInformed ? formatBRL(c.final) : "Sob consulta";
    ctx.font = "bold 15px Arial";
    const priceTextWidth = ctx.measureText(priceText).width;
    const pillW = priceTextWidth + 26;
    const pillH = 30;
    const pillX = rowX + rowW - pillW - 14;
    const pillY = y + rowH - pillH - 10;
    ctx.fillStyle = c.priceInformed ? (isBest ? "#dcfce7" : "#e0f2fe") : "#f1f5f9";
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = c.priceInformed ? (isBest ? "#15803d" : "#0369a1") : "#64748b";
    ctx.fillText(priceText, pillX + 13, pillY + 20);

    y += rowH + rowGap;
  });

  const totalsY = y + 4;
  ctx.fillStyle = "#0f172a";
  roundRectPath(ctx, cardX + 20, totalsY, cardWidth - 40, totalsHeight - 14, 12);
  ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px Arial";
  const subtotalLine =
    serviceFee > 0
      ? `Subtotal: ${formatBRL(totalBase)}    +    Taxa de serviço: ${formatBRL(serviceFee)}`
      : `Subtotal: ${formatBRL(totalBase)}`;
  ctx.fillText(subtotalLine, cardX + 40, totalsY + 28);

  ctx.fillStyle = "#4ade80";
  ctx.font = "bold 24px Arial";
  const totalText = `Total: ${formatBRL(totalFinal)}`;
  const totalWidth = ctx.measureText(totalText).width;
  ctx.fillText(totalText, cardX + cardWidth - 40 - totalWidth, totalsY + 50);
  y = totalsY + totalsHeight;

  ctx.fillStyle = "#475569";
  ctx.font = "13px Arial";
  let footerY = y + 22;
  if (validity) {
    ctx.fillText(`Proposta válida por ${validity}.`, cardX + 28, footerY);
    footerY += 22;
  }
  if (notes) {
    ctx.font = "italic 13px Arial";
    footerY = drawWrappedText(ctx, notes, cardX + 28, footerY, cardWidth - 56, 18);
    footerY += 4;
  }
  if (agentName || agentContact) {
    const boxY = footerY + 6;
    const boxH = 54;
    const boxX = cardX + 20;
    const boxW = cardWidth - 40;

    ctx.fillStyle = "#f8fafc";
    roundRectPath(ctx, boxX, boxY, boxW, boxH, 10);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    roundRectPath(ctx, boxX, boxY, 4, boxH, 2);
    ctx.fill();

    const avatarCx = boxX + 30;
    const avatarCy = boxY + boxH / 2;
    ctx.fillStyle = "#1e3a5f";
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "center";
    const initials = (agentName || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("");
    ctx.fillText(initials || "?", avatarCx, avatarCy + 5);
    ctx.textAlign = "left";

    const textX = boxX + 56;
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 14px Arial";
    ctx.fillText(agentName || "Atendimento", textX, boxY + 24);

    if (agentContact) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px Arial";
      ctx.fillText(agentContact, textX, boxY + 42);
    }
  }

  return canvas;
}

function slugClientName() {
  return (document.getElementById("clientName").value.trim() || "cliente")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

document.getElementById("btnDownloadImage").addEventListener("click", () => {
  const canvas = buildQuoteCanvas();
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orcamento-voo-${slugClientName()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
});

document.getElementById("btnDownloadPdf").addEventListener("click", () => {
  const canvas = buildQuoteCanvas();
  const { jsPDF } = window.jspdf;

  // converte pixels do canvas para mm (a 96dpi) e monta um PDF de uma página
  // só com o tamanho exato do orçamento, sem cortar nem sobrar margem.
  const pxToMm = (px) => (px * 25.4) / 96;
  const pdfWidth = pxToMm(canvas.width);
  const pdfHeight = pxToMm(canvas.height);

  const doc = new jsPDF({
    orientation: pdfWidth > pdfHeight ? "landscape" : "portrait",
    unit: "mm",
    format: [pdfWidth, pdfHeight],
  });

  const imgData = canvas.toDataURL("image/png");
  doc.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  doc.save(`orcamento-voo-${slugClientName()}.pdf`);
});

// init
renderTable();
recomputeTotals();
initAISettings().then(() => {
  loadState();
});
