import type { SupabaseClient } from "@supabase/supabase-js";
import type { UtteranceSignals } from "../utteranceSignals";
import type { GenerateContentFn } from "../responseGenerator";

export type PlaySkillId = "CHOSUNG" | "WORD_CHAIN" | "NONSENSE_QUIZ";

/** Router가 게임 규칙을 모르도록 하는 최소 계약(§3-3). */
export interface PlaySkillTurnResult {
  handled: boolean;
  /** 이번 턴을 처리한 놀이 스킬 ID */
  skillId?: PlaySkillId;
  /** Gemini에 얹을 결정론 지시문. handled=false면 없다. */
  instruction?: string;
  /** 이 턴으로 게임이 끝났는가. */
  ended?: boolean;
  /**
   * 아이에게 그대로 들려줄 케이의 첫 마디. `start()` 에서만 채운다.
   * `instruction` 과 달리 **아이가 직접 듣는 문장**이므로 내부 지시문·정답을
   * 절대 담지 않는다. 2026-08-18 프롬프트 유출 사고 참고.
   */
  openingLine?: string;
  /** 이번 턴에서 응답에 나타나면 안 되는 정답 단어 (유출 방지 검증용) */
  answerMustNotAppear?: string;
  /**
   * 이번 턴 케이의 응답에 **반드시 들어 있어야 하는** 낱말.
   * 끝말잇기는 케이가 낼 낱말을 스킬이 결정론적으로 고른다. 모델이 그걸
   * 말하지 않으면 DB 상태와 아이가 들은 말이 어긋나 게임이 무너진다.
   */
  requiredWordInOutput?: string;
  /**
   * 아이에게 **그대로** 들려줄 완성 문장. 이 값이 있으면 엔진은 LLM 생성을 건너뛰고
   * 이 문장을 그대로 쓴다.
   *
   * 요청서 018(requests/a06.png) — 끝말잇기 응답 형식을 정확히 3줄로 고정한다.
   * 지시문으로는 형식이 지켜지지 않았다(실측: "아이가 "레스토랑"으로 멋지게
   * 이어줬어! 케이는 "낭떠러지"로 받을게. 이제 "지"로 시작하는 단어를 말해줘." 가
   * 한 덩어리로 나왔다). 낱말·다음 음절은 이미 세션 상태에서 결정론으로 정해지므로
   * 문장까지 여기서 만들면 LLM 이 끼어들 여지가 없다.
   */
  deterministicText?: string;
  /**
   * 이번 턴 케이의 응답에 **반드시 들어 있어야 하는** 초성 문자열.
   * 케이가 문제를 낼 때 스킬이 결정론적으로 고른 초성을 모델이 말하지 않고
   * 지어내는 사고(2026-08-18)를 막기 위해 출력을 직접 검증한다.
   */
  requiredChosungInOutput?: string;
}

export interface PlaySkillStartInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  gradeRaw?: string | number | null;
  utterance: string;
  signals: UtteranceSignals;
}

export interface PlaySkillTurnInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  gradeRaw?: string | number | null;
  utterance: string;
  signals: UtteranceSignals;
  /**
   * LLM 클라이언트. 끝말잇기가 사전에 없는 낱말을 판정할 때만 쓴다
   * (2026-08-20 대표님 지시: "LLM 연동해서 끝말잇기 진행하라니까").
   * 없으면 사전 판정만 쓴다 — 놀이가 멈추지는 않는다.
   */
  ai?: { models: { generateContent: GenerateContentFn } };
}

export interface PlaySkillEndInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId?: string;
  reason?: string;
}

export interface ActivePlaySessionInfo {
  id: string;
  updatedAt?: string | null;
  startedAt?: string | null;
}

export interface PlaySkillModule {
  id: PlaySkillId;
  /** 아이에게 말할 때 쓰는 놀이 이름 */
  displayName: string;
  /** 아이가 "무슨 놀이 있어?"라고 물었을 때 한 줄로 설명하는 문구 */
  childFacingDescription: string;
  /** 아이가 이 Skill을 직접 지목했는가(예: "끝말잇기 하자"). */
  matchesDirectRequest(signals: UtteranceSignals, utterance: string): boolean;
  /** 이 아이에게 지금 활성 세션이 있는가. 없으면 null. */
  getActiveSession(db: SupabaseClient, childId: string): Promise<ActivePlaySessionInfo | null>;
  start(input: PlaySkillStartInput): Promise<PlaySkillTurnResult>;
  handleTurn(input: PlaySkillTurnInput): Promise<PlaySkillTurnResult>;
  end(input: PlaySkillEndInput): Promise<void>;
  /** 제안 문구 생성을 위한 metadata(§3-4). 규칙이 아니라 소개다. */
  proposal: { label: string; shortDescription: string };
}
