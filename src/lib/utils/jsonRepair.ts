/**
 * Utilitário de Sanitização, Reparo e Fallback de JSON para LLMs
 * 
 * Processa saídas de modelos de linguagem (Claude, Gemini) mesmo com quebras de linha literais,
 * aspas internas desescapadas, caracteres de controle ou blocos markdown.
 */

export function cleanAndParseJSON<T = any>(rawText: string): T | null {
  if (!rawText || typeof rawText !== "string") return null;

  try {
    let clean = rawText.trim();

    // 1. Remover markdown blocks (```json ... ``` ou ``` ... ```)
    clean = clean.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

    // 2. Extrair delimitadores '{' e '}'
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1);
    }

    // Tentativa 1: Parse direto
    try {
      return JSON.parse(clean) as T;
    } catch {
      // Prossegue para o reparo inteligente por máquina de estados
    }

    // 3. Sanitização Robusta por Varredura de Caracteres
    let inString = false;
    let isEscaped = false;
    let result = "";

    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      const code = clean.charCodeAt(i);

      if (inString) {
        if (isEscaped) {
          result += char;
          isEscaped = false;
        } else if (char === "\\") {
          result += char;
          isEscaped = true;
        } else if (char === '"') {
          // Verificar se esta aspa realmente fecha a string ou é uma aspa interna não escapada
          // Olhar os próximos caracteres não-espaço
          let nextNonSpace = "";
          for (let j = i + 1; j < Math.min(i + 30, clean.length); j++) {
            if (!/\s/.test(clean[j])) {
              nextNonSpace = clean[j];
              break;
            }
          }
          // Uma aspa de fechamento válida no JSON é seguida por ':', ',', '}', ']' ou fim
          if (nextNonSpace === ":" || nextNonSpace === "," || nextNonSpace === "}" || nextNonSpace === "]" || nextNonSpace === "") {
            inString = false;
            result += char;
          } else {
            // Aspa interna não escapada -> escapar
            result += '\\"';
          }
        } else if (char === "\n") {
          result += "\\n";
        } else if (char === "\r") {
          result += "\\r";
        } else if (char === "\t") {
          result += "\\t";
        } else if (code < 0x20) {
          // Caractere de controle proibido no JSON -> converter para espaço
          result += " ";
        } else {
          result += char;
        }
      } else {
        if (char === '"') {
          inString = true;
          result += char;
        } else {
          result += char;
        }
      }
    }

    // 4. Remover trailing commas antes de '}' ou ']'
    result = result.replace(/,\s*([}\]])/g, "$1");

    // Tentativa 2: Parse após sanitização de strings e trailing commas
    try {
      return JSON.parse(result) as T;
    } catch {
      // Tentativa 3: Remoção de comentários residuais
      result = result.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return JSON.parse(result) as T;
    }
  } catch (err) {
    console.warn("[jsonRepair] Falha no reparo do JSON:", err);
    return null;
  }
}
