export function cleanTtsText(raw: string): string {
  return raw
    // 인라인 태그(<b>, <em> 등)는 붙여서 지운다 — 공백으로 바꾸면 `서아 는` 이 된다.
    // 블록 태그(<p>, <br>, <li> 등)는 문장 경계이므로 공백으로 바꾼다.
    .replace(/<\/?(?:p|br|div|li|ul|ol|tr|td|th|h[1-6]|section|article)\b[^>]*>/giu, " ")
    .replace(/<[^>]*>/gu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/```(?:\w+)?/gu, " "))
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^\s*(?:[-*+•·▪◦‣⁃]|\d+[.)])\s+/gmu, "")
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, "")
    // 강조 표시는 **붙여서** 지운다. 공백으로 바꾸면 조사가 떨어져
    // `서아 가`, `중요 한` 처럼 케이가 어색하게 끊어 읽는다(2026-08-20 실측).
    .replace(/\*{1,3}(?=\S)|(?<=\S)\*{1,3}/gu, "")
    .replace(/_{2,3}(?=\S)|(?<=\S)_{2,3}/gu, "")
    .replace(/~{1,2}(?=\S)|(?<=\S)~{1,2}/gu, "")
    // 줄머리 제목·인용 기호만 없앤다. 문장 속 기호는 건드리지 않는다 —
    // `3 * 4` 의 곱셈 기호까지 지우면 뜻이 바뀐다(지시서 §4: 의미 불변).
    .replace(/^\s*[#>|]+\s*/gmu, "")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, "")
    .replace(/[◆◇■□●○▲△▼▽★☆※]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function splitTtsSentences(raw: string): string[] {
  const text = cleanTtsText(raw);
  if (!text) return [];
  return text
    .split(/(?<=[.!?。！？])\s*/gu)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
