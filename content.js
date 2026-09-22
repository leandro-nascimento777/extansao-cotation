// content.js
// Ativa uma sobreposição de seleção de área (estilo "print de tela").
// Ao soltar o mouse, varre os elementos DOM dentro do retângulo, reconstrói
// o texto em formato de "linhas/tabela" e salva em chrome.storage.local
// para o popup ler quando for reaberto.

(() => {
  if (window.__flightQuoteSelectionActive) return; // evita ativar 2x
  window.__flightQuoteSelectionActive = true;

  const OVERLAY_ID = "__flight-quote-overlay__";
  const BOX_ID = "__flight-quote-box__";
  const TOAST_ID = "__flight-quote-toast__";

  let startX = 0, startY = 0;
  let selecting = false;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(15, 23, 42, 0.15)",
  });

  const hint = document.createElement("div");
  hint.textContent = "Arraste para selecionar a área com os voos. Pressione ESC para cancelar.";
  Object.assign(hint.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#0f172a",
    color: "#e2e8f0",
    padding: "8px 14px",
    borderRadius: "8px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
    pointerEvents: "none",
  });
  overlay.appendChild(hint);

  const box = document.createElement("div");
  box.id = BOX_ID;
  Object.assign(box.style, {
    position: "fixed",
    border: "2px dashed #38bdf8",
    background: "rgba(56, 189, 248, 0.15)",
    display: "none",
    pointerEvents: "none",
  });
  overlay.appendChild(box);

  document.documentElement.appendChild(overlay);

  function cleanup() {
    overlay.remove();
    window.__flightQuoteSelectionActive = false;
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      cleanup();
    }
  }
  document.addEventListener("keydown", onKeyDown, true);

  overlay.addEventListener("mousedown", (e) => {
    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.display = "block";
    box.style.left = startX + "px";
    box.style.top = startY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!selecting) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!selecting) return;
    selecting = false;
    const rect = {
      left: Math.min(e.clientX, startX),
      top: Math.min(e.clientY, startY),
      right: Math.max(e.clientX, startX),
      bottom: Math.max(e.clientY, startY),
    };
    rect.width = rect.right - rect.left;
    rect.height = rect.bottom - rect.top;

    // Esconde o overlay antes do print para que a captura saia limpa
    overlay.style.display = "none";

    if (rect.width < 10 || rect.height < 10) {
      cleanup();
      showToast("Seleção muito pequena, tente novamente.", true);
      return;
    }

    const extraction = extractFromRect(rect);

    // Pequeno delay para garantir que o navegador redesenhou a tela sem o overlay
    setTimeout(() => {
      chrome.runtime.sendMessage(
        {
          type: "capture-selection",
          rect,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
        (response) => {
          cleanup();
          const screenshot = response?.screenshot || null;
          chrome.storage.local.set(
            {
              lastExtraction: {
                url: location.href,
                pageTitle: document.title,
                capturedAt: Date.now(),
                rawText: extraction.rawText,
                rows: extraction.rows,
                screenshot,
              },
            },
            () => {
              showToast("Área e imagem capturadas! Abra a extensão para ver a proposta.", false);
            }
          );
        }
      );
    }, 60);
  });

  function showToast(message, isError) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: isError ? "#7f1d1d" : "#064e3b",
      color: "#f8fafc",
      padding: "10px 16px",
      borderRadius: "8px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      zIndex: "2147483647",
      boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
    });
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function extractFromRect(rect) {
    const all = document.querySelectorAll("body *");
    const candidates = [];

    for (const el of all) {
      if (el.id === OVERLAY_ID || el.closest(`#${OVERLAY_ID}`)) continue;
      // considera apenas elementos "folha" (sem filhos elemento) com texto direto
      if (el.children.length > 0) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      // interseção com o retângulo selecionado
      const intersects =
        r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
      if (!intersects) continue;

      candidates.push({ text, top: r.top, left: r.left, height: r.height });
    }

    // ordena por posição (linha, depois coluna)
    candidates.sort((a, b) => a.top - b.top || a.left - b.left);

    // agrupa em "linhas" por proximidade vertical
    const rows = [];
    const rowTolerance = 10;
    for (const c of candidates) {
      let row = rows.find((r) => Math.abs(r.top - c.top) <= rowTolerance);
      if (!row) {
        row = { top: c.top, cells: [] };
        rows.push(row);
      }
      row.cells.push(c);
    }
    rows.sort((a, b) => a.top - b.top);
    rows.forEach((r) => r.cells.sort((a, b) => a.left - b.left));

    const rowsOut = rows.map((r) => r.cells.map((c) => c.text));
    const rawText = rowsOut.map((cells) => cells.join(" | ")).join("\n");

    return { rawText, rows: rowsOut };
  }
})();
