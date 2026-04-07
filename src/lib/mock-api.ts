export interface StudentAbsence {
  numero: number;
  nome: string;
  confirmed?: boolean;
}

const API_KEY = "AIzaSyCECinChR2igjQDl3rkBBMj0P0H62hnpM8";
const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = (error) => reject(error);
  });
}

export async function extractAbsencesFromImage(
  file: File,
  selectedDay: string
): Promise<StudentAbsence[]> {
  const base64Image = await fileToBase64(file);

  console.log(`SIAP: Iniciando extração com o modelo ${MODEL} (v1beta)...`);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Você é um robô de transcrição de alta precisão especializado em planilhas manuscritas densas. Siga estas etapas estritamente:

Analise o cabeçalho e identifique a posição visual exata (o índice da coluna) correspondente ao dia ${selectedDay}.

Crie uma lista interna transcrevendo o caractere que está EXATAMENTE nesta coluna para TODAS as 35 linhas de alunos.

Se você vir a letra 'F' ou 'f', transcreva como 'F' (Falta).

Se você vir um ponto '.', '..', ou espaço vazio, transcreva como '.' (Presença). Ignore riscos de caneta fora do quadradinho.

Para o dia ${selectedDay}, gere a resposta EXCLUSIVAMENTE baseada nessa lista de transcrição, filtrando e retornando apenas os alunos cujo caractere transrito foi 'F'.
Retorne um array JSON limpo: [{"numero": 7, "nome": "ANDRÉ DUARTE"}].`,
            },
            {
              inlineData: {
                mimeType: file.type,
                data: base64Image,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error(`SIAP: Erro no modelo ${MODEL}:`, errorData);
    throw new Error(`Erro na API do Gemini (${response.status}): ${errorData.error?.message || 'Erro desconhecido'}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  
  try {
    const jsonMatch = textResponse.match(/\[.*\]/s);
    const jsonString = jsonMatch ? jsonMatch[0] : textResponse;
    const students: StudentAbsence[] = JSON.parse(jsonString);

    console.log(`SIAP: Extração concluída com sucesso. Alunos encontrados: ${students.length}`);
    return students;
  } catch (error) {
    console.error("SIAP: Erro ao converter resposta do Gemini:", textResponse, error);
    throw new Error("A resposta da IA não está no formato esperado.");
  }
}
