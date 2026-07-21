// 미션 대화 턴(child<->k) 상태머신의 순수 판정 로직 — 프레임워크/DOM/오디오와 무관한 부분만
// 분리해 단위 테스트가 가능하게 한다. app/child/missions/page.tsx가 실제 ref 상태(answerInFlightRef,
// turnPhaseRef 등)를 읽어 이 함수들에 넘긴다.
//
// 배경(버그①②③ 공통 원인): 기존에는 "이전 답변이 아직 서버에서 처리 중"이거나 "케이가 아직
// 말하는 중"인 상태에서도 아이가 새 녹음을 시작할 수 있었다(수동 모드 버튼에 가드가 전혀 없었음).
// classifyAnswer가 최대 10~32초 걸릴 수 있는데 그 사이 아이가 다시 녹음을 시작하면:
//  - 그 발화가 화면에 새 말풍선으로 표시되고 chat_messages에도 저장되지만,
//  - answerInFlightRef(또는 Live의 turnPhaseRef)에 막혀 /api/mission/answer로 제출되지 않고
// 쌓임(버그②) + 아이 입장에선 "케이가 내 답을 기다리지 않고 진행한다"로 느껴짐(버그③).
// 이 모듈은 "지금 새 녹음을 시작해도 되는가"(canStartRecording)와 "지금 도착한 child 턴을
// 실제로 저장/제출해도 되는가"(shouldAcceptChildTurn)를 각각 명시적으로 판정한다.
// 특히 K가 말하는 중(k_speaking)이나 답변 대기 중(waiting_k)에는 아이 발화를 무시하고 오직 idle 상태에서만 접수하도록 엄격하게 가드한다.

/** Live(Tier3) 전용 미션 턴 상태머신 — missions/page.tsx의 turnPhaseRef와 동일한 타입. */
export type TurnPhase = "idle" | "child_listening" | "child_finalizing" | "waiting_k" | "k_speaking";

export interface RecordingGuardInput {
  /** true면 Live(Tier3) 경로, false면 STT/TTS(Tier1/2) 경로. */
  isLiveMode: boolean;
  /** STT/TTS 전용 — 이전 답변의 /api/mission/answer→/api/mission/respond 처리 체인이 아직 진행 중인지. */
  answerInFlight: boolean;
  /** STT/TTS 전용 — 케이의 TTS 음성이 현재 재생 중인지. */
  kaySpeaking: boolean;
  /** Live 전용 — 현재 미션 턴 상태머신 단계. */
  turnPhase: TurnPhase;
}

/**
 * 지금 아이가 새 녹음(수동 모드 버튼 탭 / Live activityStart)을 시작해도 되는지 판정한다.
 * false면 호출부는 아무 것도 하지 않고 탭을 무시해야 한다(케이 발화를 강제로 끊거나, 처리 중인
 * 이전 답변과 겹치는 새 녹음을 만들면 안 됨).
 */
export function canStartRecording(input: RecordingGuardInput): boolean {
  if (input.isLiveMode) return input.turnPhase === "idle";
  return !input.answerInFlight && !input.kaySpeaking;
}

export interface ChildTurnAcceptInput {
  isLiveMode: boolean;
  answerInFlight: boolean;
  turnPhase: TurnPhase;
  /** missionState === "active" 인지 (completing/completed면 항상 true를 반환 — 기존 동작 유지,
   *  저장은 하되 판정 로직은 태우지 않는 처리는 호출부 책임). */
  missionActive: boolean;
}

/**
 * 방금 도착한 child 턴을 실제로 저장(saveMessage)하고 답변 판정 파이프라인에 태워도 되는지
 * 판정한다. false면 이 턴은 완전히 폐기한다 — 화면에 표시하지도, chat_messages에 저장하지도
 * 않는다(이전 답변이 아직 처리 중인데 도착한 턴이므로 신뢰할 수 없음).
 */
export function shouldAcceptChildTurn(input: ChildTurnAcceptInput): boolean {
  if (!input.missionActive) return true;
  if (input.isLiveMode) return input.turnPhase === "idle" || input.turnPhase === "child_listening" || input.turnPhase === "child_finalizing";
  return !input.answerInFlight;
}
