export const E_REACTION_POOL = [
  "그랬구나!",
  "이야기해 줘서 고마워!",
  "그런 일이 있었구나!",
  "알겠어!",
] as const;

export type EReactionText = (typeof E_REACTION_POOL)[number];

export function pickNonRepeatingReaction(lastReaction: string | null): string {
  const pool = E_REACTION_POOL;
  if (!lastReaction) {
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  let selected: string = pool[0];
  for (let i = 0; i < 5; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected = pool[idx];
    if (selected !== lastReaction) {
      return selected;
    }
  }

  return selected;
}
