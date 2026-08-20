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

/**
 * 소리 내어 읽을 때 **부호 이름이 들리지 않게** 다듬는다.
 *
 * 2026-08-20 대표님 QA — "마침표, 물음표, 이런거 안 읽게 해줘".
 * 한국어 음성 엔진 일부가 문장부호를 이름 그대로 읽는다.
 *
 * 분할은 부호로 하고 **제거는 분할 뒤에** 한다. 순서를 바꾸면 문장 경계가 사라져
 * 긴 리포트가 한 덩어리로 읽힌다.
 *
 * 쉼표는 남긴다 — 끊어 읽는 호흡을 만들고, 이름으로 읽히는 경우가 거의 없다.
 */
function stripSpokenPunctuation(sentence: string): string {
  return sentence
    // 문장 끝 부호. 물음표를 떼면 올림 억양이 약해지지만, 부호 이름이 들리는 쪽이 더 나쁘다.
    .replace(/[.!?。！？…]+\s*$/gu, "")
    // 문장 속에서 이름으로 읽히기 쉬운 부호들.
    // 따옴표는 공백으로 바꾼다. 붙여 지우면 `"좋아"라고` 가 `좋아라고` 로 뭉쳐
    // 케이가 한 낱말처럼 읽는다(실측).
    .replace(/["'“”‘’「」『』]/gu, " ")
    .replace(/[()[\]{}<>《》〈〉]/gu, " ")
    .replace(/[:;/\\|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function splitTtsSentences(raw: string): string[] {
  const text = cleanTtsText(raw);
  if (!text) return [];
  return text
    .split(/(?<=[.!?。！？])\s*/gu)
    .map((sentence) => stripSpokenPunctuation(sentence))
    .filter(Boolean);
}

/** 낭독 큐의 한 조각. `pauseAfterMs` 만큼 쉬고 다음 조각으로 넘어간다. */
export interface TtsChunk {
  text: string;
  pauseAfterMs: number;
}

/** 문장 사이 쉼. 너무 길면 답답하고 너무 짧으면 이어 들린다. */
export const SENTENCE_PAUSE_MS = 350;
/** 항목(제목·본문 덩어리) 사이 쉼. 화제가 바뀌므로 더 길게 둔다. */
export const ITEM_PAUSE_MS = 800;

/**
 * 낭독 대상 **항목 목록**을 쉼이 있는 큐로 만든다.
 *
 * 2026-08-20 대표님 QA — "여러 항목을 쭉 이어서 읽어서 답답하고 내용도 이해가 안 간다".
 *
 * 원인이 둘이었다.
 * 1) 호출부가 `content.join(". ")` 으로 항목을 한 덩어리로 붙인 뒤 다시 쪼갰다.
 *    그래서 "제목"과 "본문", 서로 다른 항목의 경계가 모두 같은 무게가 됐다.
 * 2) 재생이 `onend` 즉시 다음 문장을 시작해 **쉼이 0** 이었다. 게다가 문장부호를
 *    지우면서 끝 억양까지 약해져 더 이어 들린다.
 *
 * 그래서 항목 경계를 **살린 채로** 각 항목을 문장 단위로 쪼개고, 문장 사이보다
 * 항목 사이를 더 길게 쉰다.
 */
export function buildTtsChunks(items: readonly string[]): TtsChunk[] {
  const chunks: TtsChunk[] = [];
  for (const item of items) {
    const sentences = splitTtsSentences(item);
    sentences.forEach((text, index) => {
      const isLastOfItem = index === sentences.length - 1;
      chunks.push({
        text,
        pauseAfterMs: isLastOfItem ? ITEM_PAUSE_MS : SENTENCE_PAUSE_MS,
      });
    });
  }
  // 마지막 조각 뒤에는 쉴 필요가 없다.
  if (chunks.length > 0) chunks[chunks.length - 1].pauseAfterMs = 0;
  return chunks;
}
