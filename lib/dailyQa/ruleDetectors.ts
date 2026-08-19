// 요청서 019 §3-5, §3-6 — 일일 24시간 대화 QA 규칙 기반 detector 5종.
//
// DB 접근·LLM 호출·네트워크 없이 동작하는 순수 함수 모듈이다.
// 오탐이 미탐보다 나쁘다는 원칙(§3-6)에 따라 확신할 수 있는 규칙만 탐지한다.

import { UNCLEAR_AUDIO_TEMPLATES } from "../freechat/reactionEngine";
import { countConsecutiveUnclearTurns } from "../freechat/unclearAudioRecovery";
import { MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY } from "../mission-v3/missionAdapter";
// 복사본을 두지 않는다 — 한쪽만 바뀌면 탐지가 조용히 멎는다(2026-08-19 리뷰 반영).
import {
  EMPATHY_OPENERS,
  FREE_CHAT_FALLBACK_TEXT,
} from "../k-conversation/responseGenerator";
import { isDiscardableTranscript } from "../stt/transcriptFilter";
import { DAILY_QA_EXCERPT_MAX_CHARS } from "./taxonomy";

export interface DailyQaMessage {
  id: string;
  sessionId: string;
  childId: string;
  role: "child" | "k";
  content: string;
  /** 음성 보정 전 원문. 보정이 없었으면 null. */
  rawTranscript: string | null;
  mode: "mission" | "free_chat";
  createdAt: string; // ISO
}

export interface DailyQaDetection {
  taxonomyCode: string;
  sessionId: string;
  childId: string;
  /** 문제가 된 메시지. 대표 사례 저장에 쓴다. */
  messageId: string;
  /** 200자 이내로 잘린 익명화 excerpt. 아이 이름 등 식별정보를 넣지 마라. */
  excerpt: string;
  occurredAt: string;
}

/**
 * lib/k-conversation/responseGenerator.ts:390
 * 비export 상수이므로 동일 문자열을 상수로 정의하여 사용한다.
 */

/**
 * lib/k-conversation/responseGenerator.ts:88
 * 비export 상수이므로 동일 목록을 상수로 정의하여 사용한다.
 */

/**
 * 세션별로 메시지를 묶고 createdAt 기준 시간순으로 정렬한다.
 */
function groupAndSortBySession(messages: readonly DailyQaMessage[]): Map<string, DailyQaMessage[]> {
  const map = new Map<string, DailyQaMessage[]>();
  for (const msg of messages) {
    let list = map.get(msg.sessionId);
    if (!list) {
      list = [];
      map.set(msg.sessionId, list);
    }
    list.push(msg);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  return map;
}

function makeExcerpt(content: string | null | undefined): string {
  if (!content) return "";
  return content.slice(0, DAILY_QA_EXCERPT_MAX_CHARS);
}

// ── 1. LLM_FALLBACK ──────────────────────────────────────────────────────────
/**
 * 1. LLM_FALLBACK — 케이 응답이 생성 실패 폴백 문구와 정확히 일치하는 경우.
 *
 * 근거:
 * - 자유대화 폴백: "응, 듣고 있어. 더 얘기해줄래?" (lib/k-conversation/responseGenerator.ts:390)
 * - 미션 폴백: "그렇구나, 얘기해줘서 고마워." (lib/mission-v3/missionAdapter.ts:168 MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY)
 */
export function detectLlmFallback(messages: readonly DailyQaMessage[]): DailyQaDetection[] {
  const detections: DailyQaDetection[] = [];

  for (const msg of messages) {
    if (msg.role !== "k") continue;
    const trimmed = msg.content.trim();
    if (
      trimmed === FREE_CHAT_FALLBACK_TEXT ||
      trimmed === MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY
    ) {
      detections.push({
        taxonomyCode: "LLM_FALLBACK",
        sessionId: msg.sessionId,
        childId: msg.childId,
        messageId: msg.id,
        excerpt: makeExcerpt(msg.content),
        occurredAt: msg.createdAt,
      });
    }
  }

  return detections;
}

// ── 2. PARDON_REPEAT ─────────────────────────────────────────────────────────
/**
 * 케이 발화가 "못 알아들었다" 계열인지 판정한다.
 *
 * 근거:
 * - lib/freechat/reactionEngine.ts:15 UNCLEAR_AUDIO_TEMPLATES (21종)
 * - lib/freechat/unclearAudioRecovery.ts:37 UNCLEAR_K_TURN_PATTERN 및 countConsecutiveUnclearTurns
 */
function isPardonUtterance(text: string): boolean {
  const trimmed = text.trim();
  if (UNCLEAR_AUDIO_TEMPLATES.includes(trimmed)) return true;
  return countConsecutiveUnclearTurns([trimmed]) > 0;
}

/**
 * 2. PARDON_REPEAT — "못 알아들었다" 계열 K 발화가 같은 세션에서 연속 2회 이상 발생한 경우.
 * 반복 구간마다 1건으로 집계하며, 2회차 반복 발생 메시지를 대표 사례로 기록한다.
 */
export function detectPardonRepeat(messages: readonly DailyQaMessage[]): DailyQaDetection[] {
  const detections: DailyQaDetection[] = [];
  const sessionMap = groupAndSortBySession(messages);

  for (const sessionMessages of sessionMap.values()) {
    const kMessages = sessionMessages.filter((m) => m.role === "k");
    let currentStreak: DailyQaMessage[] = [];

    for (const kMsg of kMessages) {
      if (isPardonUtterance(kMsg.content)) {
        currentStreak.push(kMsg);
      } else {
        if (currentStreak.length >= 2) {
          detections.push({
            taxonomyCode: "PARDON_REPEAT",
            sessionId: currentStreak[1].sessionId,
            childId: currentStreak[1].childId,
            messageId: currentStreak[1].id,
            excerpt: makeExcerpt(currentStreak[1].content),
            occurredAt: currentStreak[1].createdAt,
          });
        }
        currentStreak = [];
      }
    }

    if (currentStreak.length >= 2) {
      detections.push({
        taxonomyCode: "PARDON_REPEAT",
        sessionId: currentStreak[1].sessionId,
        childId: currentStreak[1].childId,
        messageId: currentStreak[1].id,
        excerpt: makeExcerpt(currentStreak[1].content),
        occurredAt: currentStreak[1].createdAt,
      });
    }
  }

  return detections;
}

// ── 3. STT_TRANSCRIPT_ANOMALY ────────────────────────────────────────────────
/**
 * 일상 축약어(ㅋㅋ, ㅎㅎ, ㅇㅇ 등)인지 검사한다.
 */
function isEverydayAbbreviation(stripped: string): boolean {
  return /^[ㅋㅎㅇ]+$/.test(stripped);
}

/**
 * 3. STT_TRANSCRIPT_ANOMALY — 아이 발화가 깨진 경우.
 *
 * 판정 기준 (아이 메시지에만 적용):
 * 1) 한글 자모만으로 이루어진 발화(예: "ㅍ", "ㅠㅠ", "ㅇㅈㄹ") — 단, ㅋㅋ/ㅎㅎ/ㅇㅇ 등 일상 축약은 제외.
 *    근거: lib/stt/transcriptFilter.ts:20 isDiscardableTranscript
 * 2) rawTranscript 가 있고 content 와 다른데 content 길이가 rawTranscript 의 절반 이하로 줄어든 경우.
 */
export function detectSttTranscriptAnomaly(messages: readonly DailyQaMessage[]): DailyQaDetection[] {
  const detections: DailyQaDetection[] = [];

  for (const msg of messages) {
    if (msg.role !== "child") continue;

    // 1) 자모 전사 이상 (일상 축약 제외)
    const stripped = msg.content.replace(/[\s\p{P}\p{S}]/gu, "");
    const isJamoAnomaly =
      stripped.length > 0 &&
      isDiscardableTranscript(msg.content) &&
      !isEverydayAbbreviation(stripped);

    // 2) 음성 보정으로 발화가 절반 이하로 깎인 경우
    const hasRaw = typeof msg.rawTranscript === "string" && msg.rawTranscript.trim().length > 0;
    const isContentDifferent = hasRaw && msg.rawTranscript !== msg.content;
    const isTruncatedAnomaly =
      hasRaw &&
      isContentDifferent &&
      msg.content.trim().length <= msg.rawTranscript!.trim().length * 0.5;

    if (isJamoAnomaly || isTruncatedAnomaly) {
      detections.push({
        taxonomyCode: "STT_TRANSCRIPT_ANOMALY",
        sessionId: msg.sessionId,
        childId: msg.childId,
        messageId: msg.id,
        excerpt: makeExcerpt(msg.content || msg.rawTranscript || ""),
        occurredAt: msg.createdAt,
      });
    }
  }

  return detections;
}

// ── 4. REACTION_REPETITION ───────────────────────────────────────────────────
/**
 * 텍스트 시작 부분의 공감 문구를 찾는다.
 */
export function findEmpathyOpener(text: string): string | null {
  const trimmed = text.trim();
  for (const opener of EMPATHY_OPENERS) {
    if (trimmed.startsWith(opener)) {
      return opener;
    }
  }
  return null;
}

/**
 * 4. REACTION_REPETITION — K 가 같은 공감 문구로 연속 시작한 경우.
 *
 * 근거: lib/k-conversation/responseGenerator.ts:88 EMPATHY_OPENERS
 * 같은 세션에서 연속 2턴 이상 동일 공감 문구로 시작하면 1건으로 집계하며, 2회차 메시지를 대표 사례로 기록한다.
 */
export function detectReactionRepetition(messages: readonly DailyQaMessage[]): DailyQaDetection[] {
  const detections: DailyQaDetection[] = [];
  const sessionMap = groupAndSortBySession(messages);

  for (const sessionMessages of sessionMap.values()) {
    const kMessages = sessionMessages.filter((m) => m.role === "k");
    let currentOpener: string | null = null;
    let currentStreak: DailyQaMessage[] = [];

    for (const kMsg of kMessages) {
      const opener = findEmpathyOpener(kMsg.content);

      if (opener !== null && opener === currentOpener) {
        currentStreak.push(kMsg);
      } else {
        if (currentStreak.length >= 2) {
          detections.push({
            taxonomyCode: "REACTION_REPETITION",
            sessionId: currentStreak[1].sessionId,
            childId: currentStreak[1].childId,
            messageId: currentStreak[1].id,
            excerpt: makeExcerpt(currentStreak[1].content),
            occurredAt: currentStreak[1].createdAt,
          });
        }
        if (opener !== null) {
          currentOpener = opener;
          currentStreak = [kMsg];
        } else {
          currentOpener = null;
          currentStreak = [];
        }
      }
    }

    if (currentStreak.length >= 2) {
      detections.push({
        taxonomyCode: "REACTION_REPETITION",
        sessionId: currentStreak[1].sessionId,
        childId: currentStreak[1].childId,
        messageId: currentStreak[1].id,
        excerpt: makeExcerpt(currentStreak[1].content),
        occurredAt: currentStreak[1].createdAt,
      });
    }
  }

  return detections;
}

// ── 5. MISSION_ABRUPT_END ────────────────────────────────────────────────────
const MISSION_IN_PROGRESS_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5분

/**
 * 5. MISSION_ABRUPT_END — 미션이 마무리 없이 끊긴 경우.
 *
 * 판정: mode="mission" 세션의 마지막 메시지가 아이 발화이고 그 뒤 K 응답이 없다.
 * 단, 세션 마지막 메시지가 window 끝 5분 이내면 아직 진행 중일 수 있으므로 제외한다.
 */
export function detectMissionAbruptEnd(
  messages: readonly DailyQaMessage[],
  windowEnd: string
): DailyQaDetection[] {
  const detections: DailyQaDetection[] = [];
  const sessionMap = groupAndSortBySession(messages);
  const windowEndTime = new Date(windowEnd).getTime();

  if (Number.isNaN(windowEndTime)) return [];

  for (const sessionMessages of sessionMap.values()) {
    if (sessionMessages.length === 0) continue;

    const lastMsg = sessionMessages[sessionMessages.length - 1];
    if (lastMsg.mode !== "mission") continue;
    if (lastMsg.role !== "child") continue;

    const lastMsgTime = new Date(lastMsg.createdAt).getTime();
    if (Number.isNaN(lastMsgTime)) continue;

    // window 끝 5분 이내이면 아직 진행 중일 수 있으므로 제외
    if (windowEndTime - lastMsgTime <= MISSION_IN_PROGRESS_GRACE_PERIOD_MS) {
      continue;
    }

    detections.push({
      taxonomyCode: "MISSION_ABRUPT_END",
      sessionId: lastMsg.sessionId,
      childId: lastMsg.childId,
      messageId: lastMsg.id,
      excerpt: makeExcerpt(lastMsg.content),
      occurredAt: lastMsg.createdAt,
    });
  }

  return detections;
}

// ── 통합 Runner ─────────────────────────────────────────────────────────────
/**
 * 규칙 기반 detector 5종을 순차 실행하여 결과를 통합 반환한다.
 */
export function runRuleDetectors(
  messages: readonly DailyQaMessage[],
  windowEnd?: string
): DailyQaDetection[] {
  const detections: DailyQaDetection[] = [
    ...detectLlmFallback(messages),
    ...detectPardonRepeat(messages),
    ...detectSttTranscriptAnomaly(messages),
    ...detectReactionRepetition(messages),
  ];

  if (windowEnd) {
    detections.push(...detectMissionAbruptEnd(messages, windowEnd));
  }

  return detections;
}
