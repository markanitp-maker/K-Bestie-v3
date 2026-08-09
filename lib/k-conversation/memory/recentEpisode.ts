// Recent Episode tier — 최근에 있었던 눈에 띄는 사건 1건(memory_facts fact_type='event').
// lib/relationship/relationshipContext.ts의 selectRecentEpisode 로직을 그대로 이관.
import type { RetrievedMemoryFact } from "@/lib/memory/vectorRetrieval";

export function selectRecentEpisode(facts: RetrievedMemoryFact[]): RetrievedMemoryFact | null {
  const episodes = facts.filter((fact) => fact.factType === "event");
  if (episodes.length === 0) return null;
  return [...episodes].sort((a, b) => b.sourceDate.localeCompare(a.sourceDate))[0] ?? null;
}
