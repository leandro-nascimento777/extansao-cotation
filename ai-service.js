// ai-service.js
// Serviço de integração com IA Multimodal (Google Gemini ou OpenAI)
// para análise de prints de voos com reconhecimento de logotipos,
// datas, horários, conexões e valores.

export const AI_STORAGE_KEY = "aiSettings";

export const DEFAULT_AI_SETTINGS = {
  provider: "gemini", // "gemini" | "openai"
  apiKey: "",
  model: "gemini-flash-latest",
  autoUseAI: true,
};

export async function getAISettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(AI_STORAGE_KEY, (data) => {
      resolve({ ...DEFAULT_AI_SETTINGS, ...(data[AI_STORAGE_KEY] || {}) });
    });
  });
}

export async function saveAISettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [AI_STORAGE_KEY]: settings }, () => {
      resolve(true);
    });
  });
}

const SYSTEM_PROMPT = `Você é um assistente especialista em analisar imagens e dados de sites de passagens aéreas (Google Flights, Decolar, Smiles, Latam, Gol, Azul, 123Milhas, Kayak, etc.).

Extraia todos os pacotes de voos visíveis no print recortado e/ou texto.
INSTRUÇÕES:
1. COMPANHIAS: Se houver apenas logotipo (LATAM, GOL, AZUL, TAP, American, Copa etc.), identifique a cia pelo logo visual.
2. IDA E VOLTA: Se for pacote ida e volta com preço único, agrupe no mesmo objeto. Se for somente ida, preencha apenas ida e deixe volta vazia.
3. Formate horários rigorosamente como HH:MM (ex: 08:30, 21:45).
4. Retorne APENAS um JSON puro no formato:
{
  "packages": [
    {
      "precoBase": "R$ 1.850",
      "escopo": "Nacional",
      "ida": {
        "airline": "LATAM",
        "origemLabel": "GRU - São Paulo",
        "destinoLabel": "REC - Recife",
        "data": "15 out.",
        "saida": "08:30",
        "chegada": "11:45",
        "duracao": "3h 15m",
        "paradas": "Direto"
      },
      "volta": {
        "airline": "LATAM",
        "origemLabel": "REC - Recife",
        "destinoLabel": "GRU - São Paulo",
        "data": "22 out.",
        "saida": "14:10",
        "chegada": "17:35",
        "duracao": "3h 25m",
        "paradas": "Direto"
      }
    }
  ]
}`;

async function callGemini({ apiKey, model, screenshot, rawText }) {
  const chosenModel = model || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [];
  let promptText = SYSTEM_PROMPT;
  if (rawText && rawText.trim()) {
    promptText += `\n\n[TEXTO DO DOM DA PÁGINA PARA CONFERÊNCIA]:\n${rawText.trim()}`;
  }
  parts.push({ text: promptText });

  if (screenshot && screenshot.startsWith("data:image/")) {
    const base64Data = screenshot.split(",")[1];
    const mimeMatch = screenshot.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    parts.push({
      inline_data: {
        mime_type: mimeMatch ? mimeMatch[1] : "image/png",
        data: base64Data,
      },
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json",
      },
    }),
  });

  if (!response.ok) {
    let errMsg = `Erro Gemini (${response.status})`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) errMsg = errData.error.message;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const result = await response.json();
  const candidateText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText) throw new Error("O Gemini não retornou nenhum conteúdo válido.");
  return cleanJsonResponse(candidateText);
}

async function callOpenAI({ apiKey, model, screenshot, rawText }) {
  const chosenModel = model || "gpt-4o-mini";
  const url = "https://api.openai.com/v1/chat/completions";

  const userContent = [];
  let textPrompt = "Analise este print de voo e extraia todos os pacotes em JSON.";
  if (rawText && rawText.trim()) {
    textPrompt += `\n\n[TEXTO DO DOM EXTRAÍDO]:\n${rawText.trim()}`;
  }
  userContent.push({ type: "text", text: textPrompt });

  if (screenshot && screenshot.startsWith("data:image/")) {
    userContent.push({
      type: "image_url",
      image_url: { url: screenshot },
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: chosenModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    let errMsg = `Erro OpenAI (${response.status})`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) errMsg = errData.error.message;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  if (!content) throw new Error("A OpenAI não retornou nenhum conteúdo válido.");
  return cleanJsonResponse(content);
}

function normalizeAIPackages(rawPackages) {
  if (!Array.isArray(rawPackages)) return [];
  return rawPackages.map((pkg) => ({
    selected: true,
    precoBase: pkg?.precoBase || "",
    escopo: pkg?.escopo || "",
    ida: {
      airline: pkg?.ida?.airline || "",
      origemLabel: pkg?.ida?.origemLabel || "",
      destinoLabel: pkg?.ida?.destinoLabel || "",
      data: pkg?.ida?.data || "",
      saida: pkg?.ida?.saida || "",
      chegada: pkg?.ida?.chegada || "",
      duracao: pkg?.ida?.duracao || "",
      paradas: pkg?.ida?.paradas || "",
    },
    volta: {
      airline: pkg?.volta?.airline || "",
      origemLabel: pkg?.volta?.origemLabel || "",
      destinoLabel: pkg?.volta?.destinoLabel || "",
      data: pkg?.volta?.data || "",
      saida: pkg?.volta?.saida || "",
      chegada: pkg?.volta?.chegada || "",
      duracao: pkg?.volta?.duracao || "",
      paradas: pkg?.volta?.paradas || "",
    },
  }));
}

export async function analyzeFlightWithAI({ screenshot, rawText, settings }) {
  const currentSettings = settings || (await getAISettings());
  if (!currentSettings.apiKey || !currentSettings.apiKey.trim()) {
    throw new Error("Chave de API não configurada. Configure a sua chave nas opções de IA.");
  }

  const cleanKey = currentSettings.apiKey.trim();
  let jsonResult = null;

  if (currentSettings.provider === "openai") {
    jsonResult = await callOpenAI({
      apiKey: cleanKey,
      model: currentSettings.model || "gpt-4o-mini",
      screenshot,
      rawText,
    });
  } else {
    jsonResult = await callGemini({
      apiKey: cleanKey,
      model: currentSettings.model || "gemini-1.5-flash",
      screenshot,
      rawText,
    });
  }

  const rawPackages = jsonResult?.packages || (Array.isArray(jsonResult) ? jsonResult : []);
  return normalizeAIPackages(rawPackages);
}

export async function testAIConnection({ provider, apiKey, model }) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Por favor, informe a chave da API.");
  }
  const cleanKey = apiKey.trim();
  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${cleanKey}` },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Falha na autenticação (${resp.status})`);
    }
    return true;
  } else {
    const testModel = model || "gemini-flash-latest";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cleanKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Falha na autenticação (${resp.status})`);
    }
    return true;
  }
}

function cleanJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return JSON.parse(cleaned);
}
