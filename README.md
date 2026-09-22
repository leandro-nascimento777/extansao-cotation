# ✈️ Gerador de Orçamento de Voos (Extensão Chrome com IA)

Extensão para Google Chrome voltada para agentes de viagens e viajantes. Permite selecionar visualmente uma área em qualquer site de busca de passagens aéreas (Google Flights, Decolar, Smiles, Latam, Gol, Azul, Kayak, Skyscanner, etc.), extrair os dados dos voos automaticamente com **Inteligência Artificial Multimodal (Google Gemini / OpenAI)** ou leitor local de texto, e gerar propostas prontas para o cliente (WhatsApp, imagem PNG ou PDF).

---

## ✨ Funcionalidades

- **🖱️ Seleção Visual de Área:** Arraste e selecione com o mouse a área dos voos diretamente na página do site.
- **🤖 Extração Multimodal com IA:**
  - Reconhece logotipos de companhias aéreas (LATAM, GOL, Azul, TAP, etc.) a partir da imagem do print.
  - Identifica trechos de ida e volta, horários, aeroportos de origem e destino, duração, conexões e preços.
  - Suporte a **Google Gemini** (gratuito) e **OpenAI (ChatGPT)**.
- **⚡ Fallback Offline / Local:** Se não houver IA configurada ou internet, conta com parser de texto e Regex local.
- **📋 Exportação Rápida:**
  - Copiar proposta formatada para WhatsApp com 1 clique.
  - Baixar imagem (.PNG) pronta para enviar em redes sociais ou WhatsApp.
  - Baixar proposta em documento PDF formatado.
- **💰 Cálculo Automático:** Markup (margem de lucro) e taxa de serviço configuráveis.

---

## 🚀 Como Instalar

1. Clone ou baixe este repositório:
   ```bash
   git clone https://github.com/leandro-nascimento777/extansao-cotation.git
   ```
2. Abra o Google Chrome e acesse:
   ```text
   chrome://extensions/
   ```
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **"Carregar sem compactação"** (Load unpacked) e selecione a pasta do projeto.

---

## ⚙️ Configuração da IA (Opcional, mas Recomendada)

1. Abra a extensão no navegador e clique no botão **`⚙️ IA`** no canto superior direito.
2. Escolha o provedor (Google Gemini ou OpenAI).
3. Insira sua chave de API:
   - Para o **Google Gemini (Gratuito)**: obtenha sua chave no [Google AI Studio](https://aistudio.google.com/app/apikey).
4. Clique em **"🧪 Testar Conexão"** e depois em **"💾 Salvar"**.

---

## 🛠️ Tecnologias Utilizadas

- **Google Chrome Extensions Manifest V3**
- **JavaScript (ES Modules)**
- **Google Gemini API (Gemini Flash)** / **OpenAI API**
- **HTML5 Canvas & jsPDF** para renderização de orçamentos visuais e PDFs.
