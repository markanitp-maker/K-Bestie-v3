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

export function isValidFreeChatResponse(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length > 60) return false;
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 2) return false;
  const sentenceEndings = trimmed.match(/[.!?。！？]+/g) ?? [];
  if (sentenceEndings.length > 2) return false;
  if (PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return (trimmed.match(/[?？]/g) ?? []).length <= 1;
}
