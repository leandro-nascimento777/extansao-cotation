// background.js

async function cropImage(dataUrl, rect, dpr = 1) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  const cropX = Math.max(0, Math.round(rect.left * dpr));
  const cropY = Math.max(0, Math.round(rect.top * dpr));
  const cropW = Math.max(1, Math.min(Math.round(rect.width * dpr), bitmap.width - cropX));
  const cropH = Math.max(1, Math.min(Math.round(rect.height * dpr), bitmap.height - cropY));

  const offscreen = new OffscreenCanvas(cropW, cropH);
  const ctx = offscreen.getContext("2d");
  ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const croppedBlob = await offscreen.convertToBlob({ type: "image/png" });
  const buffer = await croppedBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const len = bytes.length;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "start-selection") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: ["content.js"],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn("Falha ao injetar content script:", chrome.runtime.lastError.message);
          }
        }
      );
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "capture-selection") {
    const windowId = sender.tab?.windowId || null;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.warn("Falha ao capturar aba:", chrome.runtime.lastError?.message);
        sendResponse({ error: chrome.runtime.lastError?.message || "Erro na captura de tela", screenshot: null });
        return;
      }

      try {
        const cropped = await cropImage(dataUrl, message.rect, message.devicePixelRatio || 1);
        sendResponse({ screenshot: cropped });
      } catch (err) {
        console.error("Erro ao recortar imagem:", err);
        sendResponse({ screenshot: dataUrl }); // Fallback
      }
    });
    return true; // Mantém sendResponse ativo assincronamente
  }
});

