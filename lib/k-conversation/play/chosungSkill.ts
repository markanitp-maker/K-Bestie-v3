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
  displayName: "초성게임",
  childFacingDescription: "내가 초성을 주면 무슨 말인지 맞히는 놀이",
  proposal: {
    label: "초성게임",
    shortDescription: "자음 힌트를 보고 단어를 맞히는 퀴즈 놀이",
  },
  matchesDirectRequest(signals: UtteranceSignals, _utterance: string): boolean {
    return Boolean(signals?.hasChosungGameStart);
  },
  async getActiveSession(db: SupabaseClient, childId: string): Promise<{ id: string; updatedAt?: string | null; startedAt?: string | null } | null> {
    if (!db || !childId) return null;
    const session = await getActiveChosungGameSession(db, childId);
    return session
      ? {
          id: session.id,
          updatedAt: session.updated_at,
          startedAt: session.started_at,
        }
      : null;
  },
  async start(input: PlaySkillStartInput): Promise<PlaySkillTurnResult> {
    const existing = await getActiveChosungGameSession(input.db, input.childId);
    const isResume = Boolean(existing);

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

    let openingLine: string | undefined;
    if (result.handled) {
      const activeSession = await getActiveChosungGameSession(input.db, input.childId);
      if (activeSession && activeSession.current_chosung) {
        const line = isResume
          ? `우리 아까 하던 거 이어서 하자! ${activeSession.current_chosung}, 뭘까?`
          : `좋아, 초성게임 하자! ${activeSession.current_chosung}, 뭘까?`;
        // 정답 낱말 유출 절대 방어: 정답 문자열이 포함되어 있으면 openingLine을 비운다.
        if (activeSession.current_word && line.includes(activeSession.current_word)) {
          openingLine = undefined;
        } else {
          openingLine = line;
        }
      }
    }

    return {
      handled: result.handled,
      instruction: result.instruction,
      ended: false,
      openingLine,
      answerMustNotAppear: result.answerMustNotAppear,
      requiredChosungInOutput: result.requiredChosungInOutput,
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
      answerMustNotAppear: result.answerMustNotAppear,
      requiredChosungInOutput: result.requiredChosungInOutput,
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
