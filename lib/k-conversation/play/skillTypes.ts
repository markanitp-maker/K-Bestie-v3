import type { SupabaseClient } from "@supabase/supabase-js";
import type { UtteranceSignals } from "../utteranceSignals";

export type PlaySkillId = "CHOSUNG" | "WORD_CHAIN" | "NONSENSE_QUIZ";

/** Router가 게임 규칙을 모르도록 하는 최소 계약(§3-3). */
export interface PlaySkillTurnResult {
  handled: boolean;
  /** Gemini에 얹을 결정론 지시문. handled=false면 없다. */
  instruction?: string;
  /** 이 턴으로 게임이 끝났는가. */
  ended?: boolean;
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
}

export interface PlaySkillEndInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId?: string;
  reason?: string;
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
  getActiveSession(db: SupabaseClient, childId: string): Promise<{ id: string } | null>;
  start(input: PlaySkillStartInput): Promise<PlaySkillTurnResult>;
  handleTurn(input: PlaySkillTurnInput): Promise<PlaySkillTurnResult>;
  end(input: PlaySkillEndInput): Promise<void>;
  /** 제안 문구 생성을 위한 metadata(§3-4). 규칙이 아니라 소개다. */
  proposal: { label: string; shortDescription: string };
}
