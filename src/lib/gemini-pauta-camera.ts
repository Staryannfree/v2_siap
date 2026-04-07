/**
 * Extração de faltas em pauta fotografada via Gemini Vision (lista oficial de alunos + imagem).
 */

const DEFAULT_MODEL = "gemini-2.5-flash";

function getApiKey(): string {
  const k = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  return (k && k.trim()) || "";
}

export type PautaAlunoRef = {
  number: number;
  name: string;
};

function formatListaAlunos(lista: PautaAlunoRef[]): string {
  return lista
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((a) => `${a.number}. ${a.name}`)
    .join("\n");
}

/**
 * Extrai o número do dia (01–31) para o prompt, a partir do state da extensão.
 * Aceita: "23", "04 Sex", "23/03/2026", ou `selectedDayNumber` do SIAP.
 */
export function formatDiaSelecionadoParaPrompt(
  selectedDay: string,
  selectedDayNumber: number | null,
  isGhostMode: boolean,
): string {
  if (selectedDayNumber != null && selectedDayNumber >= 1 && selectedDayNumber <= 31) {
    return String(selectedDayNumber).padStart(2, "0");
  }
  const t = selectedDay.trim();
  if (t) {
    const slash = t.match(/^(\d{1,2})\/\d{1,2}\/\d{4}/);
    if (slash) return slash[1].padStart(2, "0");
    const ws = t.match(/^(\d{1,2})\s+\S/u);
    if (ws) return ws[1].padStart(2, "0");
    const solo = t.match(/^(\d{1,2})$/);
    if (solo) return solo[1].padStart(2, "0");
  }
  if (isGhostMode) return String(new Date().getDate()).padStart(2, "0");
  return "";
}

/** Rótulo curto para toast (sem zero à esquerda). */
export function formatDiaParaMensagemUsuario(diaPadded: string): string {
  const n = parseInt(diaPadded, 10);
  return Number.isFinite(n) && n >= 1 && n <= 31 ? String(n) : diaPadded;
}

/** Remove cercas ```json ... ``` que o modelo às vezes inclui. */
export function stripGeminiJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return t.trim();
}

/**
 * Chama o Gemini Vision com a imagem da pauta e retorna os **números de chamada** dos alunos que faltaram.
 *
 * TODO: Future Scalability: If Gemini Vision struggles with complex/messy tables, migrate this endpoint
 * to Google Cloud Document AI (Form Parser), which returns spatial coordinates for table cells, preventing
 * line-jumping errors.
 */
export async function extractAbsentNumbersFromPautaImage(
  base64DataUrlOrRaw: string,
  mimeType: string,
  listaAlunos: PautaAlunoRef[],
  diaSelecionado: string,
): Promise<number[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "Chave da API não configurada. Defina VITE_GEMINI_API_KEY no .env e faça o build novamente.",
    );
  }

  const model =
    (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let rawBase64 = base64DataUrlOrRaw;
  if (rawBase64.includes(",")) {
    rawBase64 = rawBase64.split(",")[1] || rawBase64;
  }

  const listaAlunosFormatada = formatListaAlunos(listaAlunos);
  const dia = diaSelecionado.trim();
  if (!dia) {
    throw new Error("Dia selecionado inválido para leitura da pauta.");
  }

  const promptText = `Você é um assistente de extração de dados de pautas escolares.
Abaixo está a lista oficial de alunos desta turma:

${listaAlunosFormatada}

TAREFA:

Olhe para o cabeçalho da tabela na imagem e encontre EXATAMENTE a coluna correspondente ao dia "${dia}".

Se o dia "${dia}" NÃO estiver visível ou não existir no cabeçalho da tabela, PARE IMEDIATAMENTE e retorne apenas um array vazio: []

Se a coluna existir, desça por ela e identifique as marcações de falta (letras 'F' ou marcações claras de ausência).

Cruze a linha da falta com o número do aluno na lista à esquerda.

Retorne EXCLUSIVAMENTE um array JSON contendo os números da chamada (IDs) dos alunos que faltaram no dia "${dia}". Não inclua nenhum outro texto, markdown ou explicação. Exemplo de saída: [2, 5, 12]`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: rawBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = (errBody as { error?: { message?: string } })?.error?.message || response.statusText;
    throw new Error(`Gemini (${response.status}): ${msg}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "[]";
  const cleaned = stripGeminiJsonFence(textResponse);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\d,]*\]/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error("Resposta da IA não é um JSON de array válido.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("A IA deve retornar um array de números.");
  }

  const numbers = parsed
    .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);

  const validSet = new Set(listaAlunos.map((a) => a.number));
  return [...new Set(numbers)].filter((n) => validSet.has(n));
}
