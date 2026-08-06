export interface FreeChatHistoryTurn {
  role: "child" | "k";
  text: string;
}

export type FreeChatContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

export const FREE_CHAT_HISTORY_LIMIT = 20;

// requests/request-free-chat-response-policy-friend-mode.md §4 — LLM Wiki에 없는
// 내용을 질문받았을 때 항상 쓰는 고정 문구. 의도적으로 물음표를 포함하므로
// validateFreeChatResponse를 거치지 않고 그대로 반환해야 한다(직접 작성한
// 고정 문자열이라 검증이 필요 없음 — LLM 생성 텍스트가 아님).
export const FREE_CHAT_UNKNOWN_CONTENT_PHRASE =
  "잘 모르겠는데, 너가 알려줄 수 있어? 내가 안 잊어버리고 기억할게";

const PROMPT_LEAK_PATTERNS = [
  /\[[^\]]*\]/,
  /시스템\s*지시/,
  /시스템\s*프롬프트/,
  /내부\s*규칙/,
  /라고\s*말하면\s*돼/,
  /제미나이|Gemini|GPT|Claude|AI\s*모델/i,
];

export function buildFreeChatContents(
  history: FreeChatHistoryTurn[]
): FreeChatContent[] {
  const validTurns = history.filter(
    (turn): turn is FreeChatHistoryTurn =>
      (turn.role === "child" || turn.role === "k") &&
      typeof turn.text === "string" &&
      Boolean(turn.text.trim())
  );
  const lastChildIndex = validTurns.findLastIndex(
    (turn) => turn.role === "child"
  );

  if (lastChildIndex < 0) return [];

  const boundedTurns = validTurns
    .slice(0, lastChildIndex + 1)
    .slice(-FREE_CHAT_HISTORY_LIMIT);
  const userFirstTurns =
    boundedTurns[0]?.role === "k" ? boundedTurns.slice(1) : boundedTurns;

  return userFirstTurns
    .map((turn) => ({
      role: turn.role === "k" ? "model" : "user",
      parts: [{ text: turn.text.trim() }],
    }));
}

// 일반 대화(§3.2의 15자 규칙은 "질문인데 관련 기억 없음" 케이스 전용이며, 그 경우는
// direct_question 분류로 FREE_CHAT_UNKNOWN_CONTENT_PHRASE 고정 문구를 쓰므로 이
// 검증기를 거치지 않는다 — 여기 30자/2줄은 일반 공감·반응 응답의 기존 상한 유지).
const FREE_CHAT_MAX_LENGTH = 30;
const FREE_CHAT_MAX_LINES = 2;

// §6.2 금지 표현 — 훈계·교육적 조언 톤이면 재생성 대상.
const FORBIDDEN_ADVICE_PATTERNS = [
  /해야\s*해/,
  /것이\s*좋아/,
  /게\s*좋아/,
  /중요해/,
];

export function validateFreeChatResponse(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length > FREE_CHAT_MAX_LENGTH) return false;

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > FREE_CHAT_MAX_LINES) return false;

  if (/[?？]/.test(trimmed)) return false;

  if (/(왜|뭐|어디|언제|누구|알려줄래|말해줄래|해볼래|하고 싶어)/.test(trimmed)) return false;
  if (/(까|니|어때)[.!?\s]*$/.test(trimmed)) return false;

  if (/(또는|아니면|혹은)/.test(trimmed)) return false;

  if (FORBIDDEN_ADVICE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;

  if (PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;

  return true;
}

export function normalizeFreeChatResponse(text: string | null | undefined): string {
  if (validateFreeChatResponse(text)) {
    return text!.trim();
  }
  
  const trimmed = text?.trim() ?? "";
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s && validateFreeChatResponse(s)) {
      return s;
    }
  }
  
  return "응, 네 이야기 잘 듣고 있어.";
}
