export const numberMap: Record<string, number> = {
  'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
  'seis': 6, 'meia': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
  'onze': 11, 'doze': 12, 'treze': 13, 'quatorze': 14, 'catorze': 14,
  'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19,
  'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60,
  'setenta': 70, 'oitenta': 80, 'noventa': 90, 'cem': 100, 'cento': 100,
  'zero': 0, 'meu': 0, 'o': 0
};

export const normalizeName = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .toLowerCase()
    .replace(/[h]/g, ""); // ignore silent 'h'
};

/**
 * Função utilitária pura para encontrar alunos em uma transcrição de voz.
 * Retorna uma lista de objetos do tipo 'student' com a propriedade confirmed: true.
 */
export const findStudentsFromTranscript = (
  text: string, 
  allStudents: any[], 
  markedMatriculas: Set<string>
) => {
  let preparedText = text.toLowerCase()
    .replace(/[.,!?;:]/g, ' ')
    .replace(/número|numero|aluno|aluna|estudante|matrícula|matricula/g, ' ');
  
  // Convert words to numbers (including compound like "vinte e cinco")
  const words = preparedText.split(/\s+/).filter(w => w.length > 0);
  const stopWords = new Set(['falta', 'faltam', 'para', 'a', 'e', 'chamada', 'faltou', 'de', 'do', 'da', 'marcar']);
  
  const foundStudents: any[] = [];
  const identifiedMatriculas = new Set(markedMatriculas);

  // 1. Precise check for literal numbers (regex)
  const literalNumbers = preparedText.match(/\d+/g);
  if (literalNumbers) {
    literalNumbers.forEach(numStr => {
      const num = parseInt(numStr, 10);
      const student = allStudents.find((s: any) => s.number === num);
      if (student && !identifiedMatriculas.has(student.matricula)) {
        foundStudents.push({ ...student, confirmed: true });
        identifiedMatriculas.add(student.matricula);
      }
    });
  }

  // 2. Check for number words
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (numberMap[w] !== undefined) {
      let value = numberMap[w];
      // Look ahead for "e" + digit (e.g., "vinte e cinco")
      if (['vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'].includes(w) && words[i+1] === 'e' && numberMap[words[i+2]]) {
        value += numberMap[words[i+2]];
        i += 2;
      }
      
      const student = allStudents.find((s: any) => s.number === value);
      if (student && !identifiedMatriculas.has(student.matricula)) {
        foundStudents.push({ ...student, confirmed: true });
        identifiedMatriculas.add(student.matricula);
      }
    } else if (!stopWords.has(w) && w.length > 2) {
      // 3. Fallback: Search by name part
      const normalizedW = normalizeName(w);
      const matches = allStudents.filter((s:any) => 
        normalizeName(s.name).includes(normalizedW) && !identifiedMatriculas.has(s.matricula)
      );
      if (matches.length === 1) {
        foundStudents.push({ ...matches[0], confirmed: true });
        identifiedMatriculas.add(matches[0].matricula);
      }
    }
  }

  return foundStudents;
};
