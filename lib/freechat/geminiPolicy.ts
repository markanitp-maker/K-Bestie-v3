export interface FreeChatHistoryTurn {
  role: "child" | "k";
  text: string;
}

export type FreeChatContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

export const FREE_CHAT_HISTORY_LIMIT = 20;

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

export function validateFreeChatResponse(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length > 30) return false;
  
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 2) return false;
  
  if (/[?？]/.test(trimmed)) return false;

  if (/(왜|뭐|어디|언제|누구|알려줄래|말해줄래|해볼래|하고 싶어)/.test(trimmed)) return false;
  if (/(까|니|어때)[.!?\s]*$/.test(trimmed)) return false;

  if (/(또는|아니면|혹은)/.test(trimmed)) return false;

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
