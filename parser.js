// parser.js
// Heurísticas simples (regex) para transformar as linhas de texto extraídas
// da página em "pacotes" de viagem (ida + volta com um preço só, do jeito
// que sites de venda normalmente exibem). Não é mágica: o resultado é
// sempre editável pelo usuário no popup antes de gerar a proposta.

const AIRLINES = [
  "LATAM", "GOL", "AZUL", "TAP", "AVIANCA", "AMERICAN AIRLINES", "AMERICAN",
  "DELTA", "UNITED", "IBERIA", "AIR FRANCE", "KLM", "COPA AIRLINES", "COPA",
  "AEROMEXICO", "AEROMÉXICO", "LUFTHANSA", "BRITISH AIRWAYS", "EMIRATES",
  "QATAR AIRWAYS", "ITA AIRWAYS", "AIR EUROPA", "JETSMART", "SKY AIRLINE",
  "PASSAREDO", "VOEPASS",
];

const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
// Aceita preços com ou sem centavos, com ou sem "R$", com separador de milhar
// em ponto ou vírgula (ex: "R$ 1.850", "1850,00", "R$2.450,00", "450,00",
// "R$ 9.970" sem centavos).
const PRICE_RE =
  /R\$\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b|\b\d{1,4},\d{2}\b/g;
const DURATION_RE = /\b(\d{1,2})\s*h(?:oras?)?\s*(\d{1,2})?\s*(?:min)?\b/i;
const STOPS_RE = /(sem escalas|direto|voo direto|(\d+)\s*paradas?|(\d+)\s*conex(?:ão|ões))/i;
const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(\d{1,2})\s?(?:de\s)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç.]*\b/i;
const IATA_RE = /\b[A-Z]{3}\b/g;
const TIME_TEST_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const NON_PLACE_RE =
  /^(direto|voo direto|\d*\s*paradas?|ida\b|volta\b|ida e volta|\d+\s*pessoas?|econ[oô]mica|executiva|primeira classe|tarifa.*|ver (mais|menos)|todos|carrinho.*|r\$.*|bagage[nm].*|.*bagage[nm].*|.*despach.*|.*mala.*|franquia.*)$/i;

// Palavras que sites de venda usam para rotular explicitamente qual trecho é
// qual (ex: badge/rótulo "Ida" acima do horário, ou "Voo de volta" no meio do
// texto). Usamos \b para não confundir com "partida", "saída", "revolta" etc.
const ROUND_TRIP_RE = /\bida\s+e\s+volta\b/i;
const IDA_TAG_RE = /\bida\b/i;
const VOLTA_TAG_RE = /\bvolta\b/i;

/** Tenta identificar, pelo texto da linha, se ela está rotulada como "Ida"
 * ou "Volta". Retorna null quando não há rótulo, quando o rótulo é ambíguo
 * (ambas as palavras na mesma linha, ex: cabeçalho "Ida | Volta") ou quando
 * é só o rótulo de tarifa "ida e volta" (não indica um trecho específico). */
function detectLegTag(rowText) {
  if (ROUND_TRIP_RE.test(rowText)) return null;
  const hasIda = IDA_TAG_RE.test(rowText);
  const hasVolta = VOLTA_TAG_RE.test(rowText);
  if (hasIda && hasVolta) return null;
  if (hasVolta) return "volta";
  if (hasIda) return "ida";
  return null;
}

// Códigos IATA de aeroportos brasileiros (principais) — usado só para
// classificar um pacote como Nacional/Internacional a partir dos trechos
// já identificados. Lista não exaustiva; cobre os aeroportos comerciais
// mais comuns nas buscas de voo.
const BRAZIL_AIRPORTS = new Set([
  "GRU", "CGH", "VCP", "GIG", "SDU", "BSB", "CNF", "PLU", "CWB", "POA",
  "SSA", "REC", "FOR", "BEL", "MAO", "NAT", "MCZ", "AJU", "THE", "SLZ",
  "VIX", "GYN", "CGB", "CGR", "FLN", "JOI", "NVT", "IGU", "UDI", "RAO",
  "LDB", "MGF", "PVH", "RBR", "BVB", "MCP", "PMW", "IMP", "STM", "JPA",
  "PNZ", "CXJ", "XAP", "JTC", "BPS", "CZS", "PET", "SJK", "JDO", "IOS",
  "MOC", "CFB", "ARU", "BAU", "PPB", "UBT", "URG", "MAB", "CMG", "QDC",
]);

function extractIataCode(label) {
  if (!label) return "";
  const m = String(label).match(/\b[A-Z]{3}\b/);
  return m ? m[0] : "";
}

/** Classifica um pacote como "Nacional" ou "Internacional" a partir dos
 * códigos IATA dos trechos de ida/volta já identificados. Retorna "" quando
 * nenhum código foi identificado (deixa em aberto para o usuário decidir). */
export function classifyScope(pkg) {
  const codes = [
    extractIataCode(pkg?.ida?.origemLabel),
    extractIataCode(pkg?.ida?.destinoLabel),
    extractIataCode(pkg?.volta?.origemLabel),
    extractIataCode(pkg?.volta?.destinoLabel),
  ].filter(Boolean);
  if (codes.length === 0) return "";
  return codes.every((c) => BRAZIL_AIRPORTS.has(c)) ? "Nacional" : "Internacional";
}

/** Tenta achar dois "nomes de lugar" (cidades) numa linha quando não há
 * código de aeroporto (3 letras) visível — comum em sites que só mostram
 * o nome da cidade por extenso. É best-effort: pega células que parecem
 * nome próprio (começam com maiúscula, sem números, não são status/tarifa). */
function findRouteFallback(cells, airline) {
  const candidates = cells
    .map((c) => c.trim())
    .filter((c) => c.length >= 2 && c.length <= 40)
    .filter((c) => !TIME_TEST_RE.test(c))
    .filter((c) => !/\d/.test(c))
    .filter((c) => !c.includes("$"))
    .filter((c) => !NON_PLACE_RE.test(c))
    .filter((c) => !STOPS_RE.test(c))
    .filter((c) => !DURATION_RE.test(c))
    .filter((c) => !airline || c.toUpperCase() !== airline.toUpperCase())
    .filter((c) => /^[A-ZÀ-Ý]/.test(c));
  return candidates;
}

function findAirline(text) {
  const upper = text.toUpperCase();
  for (const a of AIRLINES) {
    if (upper.includes(a)) return a;
  }
  return "";
}

function findAll(regex, text) {
  const out = [];
  let m;
  const re = new RegExp(regex, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (out.length > 10) break;
  }
  return out;
}

function findAirportCodes(text, excludeAirline) {
  const stopWords = new Set(["VOO", "IDA", "R$", "OFF", "GOL"]);
  if (excludeAirline && excludeAirline.length === 3) stopWords.add(excludeAirline.toUpperCase());
  const matches = findAll(IATA_RE, text).filter((c) => !stopWords.has(c));
  return [...new Set(matches)];
}

/**
 * Dado um código IATA e as células da linha, tenta achar o nome da cidade
 * que aparece junto do código na mesma célula (ex: "GRU - São Paulo" ou
 * "São Paulo (GRU)"). Retorna "" se não conseguir isolar um nome plausível.
 */
function findCityForCode(cells, code) {
  if (!code) return "";
  for (const cell of cells) {
    if (!cell.includes(code)) continue;
    const cleaned = cell
      .replace(code, "")
      .replace(/^[\s\-–—,()]+|[\s\-–—,()]+$/g, "")
      .trim();
    if (!cleaned || cleaned.length > 60 || /^\d+$/.test(cleaned)) continue;
    if (/^[A-Z]{3}$/.test(cleaned)) continue; // é outro código IATA, não uma cidade
    return cleaned;
  }
  return "";
}

function emptyLeg() {
  return {
    airline: "", origemLabel: "", destinoLabel: "",
    data: "", saida: "", chegada: "", duracao: "", paradas: "",
  };
}

function combineLabel(code, city) {
  if (code && city) return `${code} - ${city}`;
  return code || city || "";
}

/** Interpreta uma linha como um "trecho de voo" (perna), se ela tiver horários. */
function parseLeg(cells) {
  const rowText = cells.join(" | ");
  const times = findAll(TIME_RE, rowText);
  if (times.length === 0) return null;

  const airline = findAirline(rowText);
  const airportCodes = findAirportCodes(rowText, airline);
  const durationMatch = rowText.match(DURATION_RE);
  const stopsMatch = rowText.match(STOPS_RE);
  const dateMatch = rowText.match(DATE_RE);
  const origem = airportCodes[0] || "";
  const destino = airportCodes[1] || "";

  let origemLabel = combineLabel(origem, findCityForCode(cells, origem));
  let destinoLabel = combineLabel(destino, findCityForCode(cells, destino));

  if (!origemLabel && !destinoLabel) {
    const fallback = findRouteFallback(cells, airline);
    if (fallback.length >= 2) {
      origemLabel = fallback[0];
      destinoLabel = fallback[1];
    }
  }

  return {
    airline,
    origemLabel,
    destinoLabel,
    data: dateMatch ? dateMatch[0] : "",
    saida: times[0] || "",
    chegada: times.length > 1 ? times[1] : "",
    duracao: durationMatch ? durationMatch[0].replace(/\s+/g, " ").trim() : "",
    paradas: stopsMatch ? stopsMatch[0] : "",
  };
}

function makePackage(ida, volta, precoBase) {
  const pkg = { selected: true, ida: ida || emptyLeg(), volta: volta || emptyLeg(), precoBase: precoBase || "" };
  pkg.escopo = classifyScope(pkg);
  return pkg;
}

/**
 * @param {string[][]} rows - linhas, cada uma um array de células de texto
 * @returns {Array<object>} pacotes (ida + volta + 1 preço) detectados,
 *   sempre editáveis pelo usuário. Um pacote pode ficar só com "ida"
 *   preenchida (busca somente de ida) ou sem preço (se não foi encontrado
 *   logo depois dos trechos na área selecionada).
 */
export function parseRows(rows) {
  const results = [];
  let current = { ida: null, volta: null };
  // rótulo "Ida"/"Volta" visto numa linha sem horário (badge numa linha
  // separada do trecho, comum quando o layout empilha o rótulo acima do
  // horário) e ainda não consumido pela próxima perna encontrada.
  let pendingTag = null;

  const hasPending = () => current.ida || current.volta;

  function assignLeg(leg, rowText) {
    // um rótulo explícito na própria linha da perna tem prioridade sobre um
    // rótulo pendente de uma linha anterior.
    const tag = detectLegTag(rowText) || pendingTag;
    pendingTag = null;

    if (tag === "ida") {
      if (current.ida) {
        // já tínhamos uma ida sem preço encontrado ainda: fecha o pacote
        // anterior e começa um novo com esta perna.
        results.push(makePackage(current.ida, current.volta, ""));
        current = { ida: leg, volta: null };
      } else {
        current.ida = leg;
      }
      return;
    }

    if (tag === "volta") {
      if (current.volta) {
        results.push(makePackage(current.ida, current.volta, ""));
        current = { ida: null, volta: leg };
      } else {
        current.volta = leg;
      }
      return;
    }

    // sem rótulo explícito (ou ambíguo): mantém o comportamento por ordem
    // de chegada, que já cobre a maioria dos sites sem rótulo nenhum.
    if (!current.ida) {
      current.ida = leg;
    } else if (!current.volta) {
      current.volta = leg;
    } else {
      results.push(makePackage(current.ida, current.volta, ""));
      current = { ida: leg, volta: null };
    }
  }

  for (const cells of rows) {
    const rowText = cells.join(" | ");
    const prices = findAll(PRICE_RE, rowText);
    const leg = parseLeg(cells);

    if (leg) {
      assignLeg(leg, rowText);
      continue;
    }

    if (prices.length === 0) {
      // linha sem horário e sem preço: pode ser só um rótulo "Ida"/"Volta"
      // isolado (badge numa linha própria) — guarda para a próxima perna.
      const tag = detectLegTag(rowText);
      if (tag) pendingTag = tag;
      // outras linhas sem horário/preço (ex: "Tarifa: Econômica", "Ver
      // mais") são ignoradas.
      continue;
    }

    const price = prices[prices.length - 1];
    if (hasPending()) {
      results.push(makePackage(current.ida, current.volta, price));
      current = { ida: null, volta: null };
      pendingTag = null;
    }
    // preço "solto" sem nenhuma perna coletada antes é ignorado — sem rota
    // nenhuma, não há o que oferecer ao cliente.
  }

  if (hasPending()) {
    results.push(makePackage(current.ida, current.volta, ""));
  }

  return results;
}

/**
 * Converte uma string de preço em qualquer formato razoável (com/sem "R$",
 * com/sem centavos, separador de milhar em ponto ou vírgula, ou até no
 * padrão americano "1,234.56") para um número. Retorna 0 apenas quando não
 * há nenhum dígito na string.
 */
export function parsePriceToNumber(priceStr) {
  if (!priceStr) return 0;
  let s = String(priceStr).replace(/R\$|BRL|reais/gi, "").trim();
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimalIdx = -1;

  if (lastComma > -1 && lastDot > -1) {
    decimalIdx = Math.max(lastComma, lastDot);
  } else if (lastComma > -1) {
    if (s.length - lastComma - 1 <= 2) decimalIdx = lastComma;
  } else if (lastDot > -1) {
    if (s.length - lastDot - 1 <= 2) decimalIdx = lastDot;
  }

  let integerPart, decimalPart;
  if (decimalIdx > -1) {
    integerPart = s.slice(0, decimalIdx).replace(/[.,]/g, "");
    decimalPart = s.slice(decimalIdx + 1).padEnd(2, "0").slice(0, 2);
  } else {
    integerPart = s.replace(/[.,]/g, "");
    decimalPart = "00";
  }

  const n = parseFloat(`${integerPart || "0"}.${decimalPart}`);
  return isNaN(n) ? 0 : n;
}

export function hasPrice(priceStr) {
  return Boolean(priceStr && /\d/.test(priceStr));
}

export function formatBRL(value) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function emptyLegField() {
  return emptyLeg();
}
