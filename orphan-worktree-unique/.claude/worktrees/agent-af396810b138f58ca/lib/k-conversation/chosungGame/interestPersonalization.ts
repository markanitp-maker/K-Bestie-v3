import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChosungCategory } from "./wordPool";

const INTEREST_CATEGORY_RULES: ReadonlyArray<{
  category: ChosungCategory;
  keywords: readonly string[];
}> = [
  { category: "캐릭터", keywords: ["포켓몬", "피카츄", "뽀로로", "캐릭터", "헬로키티", "도라에몽", "미니언"] },
  { category: "스포츠", keywords: ["축구", "야구", "농구", "수영", "배드민턴", "탁구", "운동"] },
  { category: "게임", keywords: ["마인크래프트", "마크", "닌텐도", "테트리스", "보드게임", "게임"] },
  { category: "동물", keywords: ["강아지", "고양이", "동물", "펭귄", "토끼"] },
  { category: "음식", keywords: ["요리", "음식", "간식", "과일", "디저트"] },
  { category: "놀이", keywords: ["종이접기", "숨바꼭질", "놀이터", "놀이"] },
  { category: "자연", keywords: ["곤충", "식물", "우주", "별", "자연"] },
];

export const categoryFromInterestTexts = (
  texts: readonly string[],
): ChosungCategory | undefined => {
  const normalized = texts.join(" ").toLocaleLowerCase("ko-KR");
  return INTEREST_CATEGORY_RULES.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword)))?.category;
};

export const pickPersonalizedCategory = async (
  db: SupabaseClient,
  childId: string,
): Promise<ChosungCategory | undefined> => {
  try {
    const { data, error } = await db
      .from("memory_facts")
      .select("subject, content")
      .eq("child_id", childId)
      .eq("fact_type", "interest")
      .eq("status", "active")
      .order("last_confirmed_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("[k-conversation/chosungGame/interestPersonalization] memory_facts query failed", error.message);
      return undefined;
    }

    if (!Array.isArray(data)) return undefined;
    return categoryFromInterestTexts(data.flatMap((row) => [row.subject ?? "", row.content ?? ""]));
  } catch (error) {
    console.error(
      "[k-conversation/chosungGame/interestPersonalization] personalized category failed",
      (error as Error).message,
    );
    return undefined;
  }
};
