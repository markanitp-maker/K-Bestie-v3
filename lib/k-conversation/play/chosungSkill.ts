import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlaySkillModule,
  PlaySkillStartInput,
  PlaySkillTurnInput,
  PlaySkillEndInput,
  PlaySkillTurnResult,
} from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { runChosungTurn } from "../chosungGame/gameOrchestrator";
import {
  getActiveChosungGameSession,
  endChosungGameSession,
} from "../chosungGame/gameSessionManager";

/**
 * 초성게임 PlaySkill 어댑터.
 * 기존 chosungGame 내부 로직을 수정하지 않고 PlaySkillModule 인터페이스로 얇게 감쌉니다.
 */
export const CHOSUNG_SKILL: PlaySkillModule = {
  id: "CHOSUNG",
  proposal: {
    label: "초성게임",
    shortDescription: "자음 힌트를 보고 단어를 맞히는 퀴즈 놀이",
  },
  matchesDirectRequest(signals: UtteranceSignals, _utterance: string): boolean {
    return Boolean(signals?.hasChosungGameStart);
  },
  async getActiveSession(db: SupabaseClient, childId: string): Promise<{ id: string } | null> {
    if (!db || !childId) return null;
    const session = await getActiveChosungGameSession(db, childId);
    return session ? { id: session.id } : null;
  },
  async start(input: PlaySkillStartInput): Promise<PlaySkillTurnResult> {
    const result = await runChosungTurn({
      db: input.db,
      childId: input.childId,
      chatSessionId: input.chatSessionId,
      gradeRaw: input.gradeRaw,
      utterance: input.utterance,
      signals: {
        ...input.signals,
        hasChosungGameStart: true,
      },
    });
    return {
      handled: result.handled,
      instruction: result.instruction,
      ended: false,
    };
  },
  async handleTurn(input: PlaySkillTurnInput): Promise<PlaySkillTurnResult> {
    const result = await runChosungTurn({
      db: input.db,
      childId: input.childId,
      chatSessionId: input.chatSessionId,
      gradeRaw: input.gradeRaw,
      utterance: input.utterance,
      signals: input.signals,
    });
    return {
      handled: result.handled,
      instruction: result.instruction,
      ended: false,
    };
  },
  async end(input: PlaySkillEndInput): Promise<void> {
    if (!input.db || !input.childId) return;
    const active = await getActiveChosungGameSession(input.db, input.childId);
    if (active) {
      await endChosungGameSession(input.db, {
        sessionId: active.id,
        childId: input.childId,
      });
    }
  },
};
