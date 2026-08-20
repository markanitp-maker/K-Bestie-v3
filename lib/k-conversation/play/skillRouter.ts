import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule, PlaySkillTurnResult } from "./skillTypes";
import type { PlaySkillTurnInput } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { PLAY_SKILL_REGISTRY, findDirectlyRequestedSkill, findSkillById } from "./skillRegistry";
import { isKPlayEnabled } from "./playAvailability";
import { resolveActiveSkill } from "./activeSkillCoordinator";
import { recordKPlayEvent } from "./kPlayAnalytics";
import {
  getPendingPlayProposal,
  clearPendingPlayProposal,
  setPendingPlayProposal,
} from "./pendingProposalStore";

export interface RoutePlaySkillTurnInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  gradeRaw?: string | number | null;
  utterance: string;
  signals: UtteranceSignals;
  registry?: readonly PlaySkillModule[];
  recordEvent?: typeof recordKPlayEvent;
  /** 끝말잇기 낱말 판정용 LLM 클라이언트. 스킬에 그대로 전달된다. */
  ai?: PlaySkillTurnInput["ai"];
}

/**
 * 못 읽은 스킬이 남은 상태에서 종료를 확정하려면, 그 스킬들을 다시 확인해야 한다.
 *
 * `{ended:true, sessionLookupFailed:true}` 라는 조합 자체가 문제였다 —
 * 엔진이 둘 중 하나를 반드시 무시하게 되고, 어느 쪽을 무시해도 틀린다.
 * "끝났다고 하면 살아 있는 세션이 숨고, 미확정이라 하면 아이가 끝내달라 한 UI 가
 * 안 닫힌다." 그래서 그 조합을 만들지 않고, 여기서 상태를 확정한다.
 *
 * @returns 남은 놀이를 모두 닫아 상태를 확정했으면 true.
 */
async function settleRemainingSessions(input: {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  registry: readonly PlaySkillModule[];
  reason: string;
  /** 재확인에서 찾은 세션을 끝낼 것인가(기본 true). 상태만 확인할 때는 false. */
  endFound?: boolean;
}): Promise<boolean> {
  const { db, childId, chatSessionId, registry, reason } = input;
  const endFound = input.endFound ?? true;
  const recheck = await resolveActiveSkill(db, childId, {
    registry,
    chatSessionId,
  });

  if (recheck.skill && endFound) {
    try {
      await recheck.skill.end({ db, childId, chatSessionId, reason });
    } catch (err) {
      console.error(
        `[skillRouter] 재확인에서 찾은 ${recheck.skill.id} 종료 실패:`,
        err
      );
      return false;
    }
  }

  // 재확인에서도 못 읽은 스킬이 있으면 확정이 아니다.
  return !recheck.lookupFailed;
}

/**
 * K Play Skill Router (§3-3, 007 Hard Guard, 009 Coordinator).
 *
 * Router는 게임 규칙을 전혀 알지 못하며, 오직 등록된 Skill들의 생명주기 계약
 * (getActiveSession, matchesDirectRequest, handleTurn, start, end)과
 * Pending Play Proposal 상태 해석 및 Active Session Hard Guard를 조율합니다.
 *
 * 라우팅 우선순위:
 * 1. 명시적 종료/거절이면 세션을 끝낸다. 부정 감정만으로는 끝내지 않는다(015).
 * 2. 직접 요청 확인 (findDirectlyRequestedSkill 또는 Pending Proposal 선택 매칭)
 *    - Pending Proposal 즉시 clear
 *    - 활성 세션과 다르면 원자적 전환(end -> start)
 *    - 새 세션 start 후 [Hard Guard: getActiveSession 검증]
 * 3. 직접 요청이 없으면: 활성 세션의 handleTurn 실행 (Invariant 3: stickiness 유지)
 * 4. 활성 세션 없음 & Pending Proposal 존재:
 *    - (A) 포괄 수락(signals.hasGenericPlayAcceptance):
 *        - offeredSkills가 1개: 해당 Skill start 시도 -> Hard Guard 검증 -> 성공 시 clear, 실패 시 handled: false
 *        - offeredSkills가 2개 이상: 임의 선택 안 함! 되묻기 지침 반환 (selection required)
 *    - (B) 제안된 스킬 중 하나를 선택한 발화: 해당 Skill start 시도 -> Hard Guard 검증
 * 5. 둘 다 없으면: { handled: false } 반환 (일반 대화로 fall-through)
 *
 * 실패 격리 (§3-22): 모든 경로에서 예외 발생 시 fail-open({ handled: false })하여
 * 게임 문제로 인해 일반 대화가 중단되지 않도록 보장합니다.
 */
export async function routePlaySkillTurn(
  input: RoutePlaySkillTurnInput
): Promise<PlaySkillTurnResult> {
  if (!isKPlayEnabled()) {
    return { handled: false };
  }

  try {
    const { db, childId, chatSessionId, utterance, signals } = input;

    if (!db || !childId || !chatSessionId) {
      return { handled: false };
    }

    const registry = input.registry ?? PLAY_SKILL_REGISTRY;
    const pendingProposal = await getPendingPlayProposal(chatSessionId, db, childId);

    // 1. 활성 Skill 확인 & Single Active Skill Coordinator (§3-5, §3-6, §3-15, §3-16)
    const activeSkillResolution = await resolveActiveSkill(db, childId, {
      registry,
      chatSessionId,
    });
    const activeSkill = activeSkillResolution.skill;
    // 조회가 실패했으면 activeSkill: null 은 "놀이 없음" 이 아니라 모름이다.
    // 엔진이 이 값을 보고 "놀이 없음" 으로 단정하지 않게 한다.
    const sessionLookupFailed = activeSkillResolution.lookupFailed;

    // 2. 명시적 종료 / 거절 / 감정 신호 확인 (Proposal 및 세션 정리)
    //
    // 015 — 부정 감정만으로는 놀이를 끝내지 않는다.
    //
    // 원래는 hasNegativeEmotion/hasConflict/hasPhysicalNeed 중 하나만 있어도 활성 세션을
    // 끝냈다. 그런데 아이가 짜증내는 대상은 대부분 놀이 자체다 — 케이가 못 알아들어서
    // 답답한 것이다. 그 짜증이 놀이를 꺼버리니 아이는 더 답답해진다.
    // 2026-08-19 김서아 Dev 로그 실측:
    //   아이: "아 진짜 졸라 짜증나네" → 초성게임 종료
    //   아이: "지금 방금 니 멋대로 KR 놀이가 꺼져버렸어 지금 우리 초성 게임 하고 있었는데
    //          갑자기 이렇게 꺼져버리면 어떡하냐"
    //   아이: "케이 놀이 선택 했으면 케이 놀이 끝날 때까지는 놀이에만 집중해"
    //
    // 그래서 놀이를 끝내는 것은 아이가 그만하자고 말했을 때뿐이다. 부정 감정이 있으면
    // 제안(proposal)만 거두고 세션은 살려 둔다 — 케이는 그 감정에 먼저 반응하고,
    // 다음 턴에 하던 놀이를 이어간다.
    //
    // 안전은 여기서 다루지 않는다. 실제 위험 신호는 respond() 1단계 Safety 가 이미
    // 가로채므로 이 지점에 도달하지 않는다.
    const isExplicitStop = Boolean(signals?.hasPlayStop || signals?.hasPlayRejection);
    const hasNegativeEmotion = Boolean(
      signals?.hasNegativeEmotion || signals?.hasConflict || signals?.hasPhysicalNeed
    );

    if (isExplicitStop) {
      await clearPendingPlayProposal(chatSessionId, db);
      // 종료가 실제로 성공했는지 따로 센다. 실패를 삼키고 ended:true 를 돌려주면
      // 세션이 남아 있는데 클라이언트는 놀이 UI 를 닫는다 — 다음 턴에 놀이가
      // 되살아나 아이 뜻과 어긋난다(리뷰 지적, 2026-08-20).
      let endSucceeded = false;
      if (activeSkill) {
        try {
          await activeSkill.end({
            db,
            childId,
            chatSessionId,
            reason: "EXPLICIT_STOP",
          });
          endSucceeded = true;
        } catch (endError) {
          console.error(
            `[skillRouter] Failed to end active skill ${activeSkill.id}:`,
            endError
          );
        }
      }
      // 같은 누락이 여기에도 있었다(리뷰 지적, 2026-08-20). 아이가 "그만" 이라고 해서
      // 세션을 닫았는데 `ended` 를 안 올리면 엔진은 놀이가 살아 있다고 본다. 그러면
      // 케이가 "하던 놀이 계속하자" 라고 말하고, 013 의 클라이언트도 종료 신호
      // (activePlaySkillId=null)를 못 받아 입력모드가 텍스트로 잠긴 채 남는다.
      // 조회가 실패해 activeSkill 이 null 인 경우도 있다. 그때는 "끝낼 게 없었다" 가
      // 아니라 **모른다** 이므로 종료를 확정하지 않고 실패를 그대로 실어 보낸다.
      if (!activeSkill && sessionLookupFailed) {
        // 아이는 그만하자고 말했다. 여기서 자유대화로 흘려보내면 케이가 엉뚱한
        // 대답을 하고, 아이는 "그만" 이 먹혔는지 알 수 없다(리뷰 지적, 2026-08-20).
        // 놀이가 있었는지도 모르는 상태이므로 단정하지 않고 헷갈린다고 말한다.
        return {
          handled: true,
          ended: false,
          sessionLookupFailed: true,
          deterministicText:
            "어? 잠깐만, 내가 지금 좀 헷갈려.\n다시 한 번 말해줄래?",
        };
      }
      // 종료에 실패했으면 아이에게 그렇다고 말한다. handled:false 로 흘려보내면
      // 케이가 엉뚱한 자유대화로 답하고, 아이는 "그만" 이 먹혔는지 알 수 없다
      // (리뷰 지적, 2026-08-20).
      if (activeSkill && !endSucceeded) {
        return {
          handled: true,
          skillId: activeSkill.id,
          ended: false,
          sessionLookupFailed: true,
          deterministicText:
            "어? 놀이를 정리하는 데 문제가 생겼어.\n잠깐만 기다렸다가 다시 그만이라고 말해줄래?",
        };
      }
      // 못 읽은 스킬이 남아 있으면 그 자리에서 확정한다(애매한 조합을 만들지 않는다).
      if (sessionLookupFailed) {
        const settled = await settleRemainingSessions({
          db,
          childId,
          chatSessionId,
          registry,
          reason: "EXPLICIT_STOP",
        });
        if (!settled) {
          // 하던 놀이는 실제로 끝났다(endSucceeded). 확정하지 못한 것은 **다른**
          // 놀이가 남았는지다. 둘을 뭉쳐 "정리하는 데 문제가 생겼어" 라고만 하면,
          // 아이는 그만하기가 안 된 줄 안다(리뷰 지적, 2026-08-20). 나눠서 말한다.
          return {
            handled: true,
            ended: false,
            sessionLookupFailed: true,
            deterministicText: endSucceeded
              ? "하던 놀이는 끝냈어!\n그런데 뭔가 좀 헷갈리네. 잠깐 있다가 다시 말해줄래?"
              : "어? 놀이를 정리하는 데 문제가 생겼어.\n잠깐만 기다렸다가 다시 그만이라고 말해줄래?",
          };
        }
      }
      return { handled: false, ended: endSucceeded };
    }

    // 010 대표님 QA 실측(2026-08-20 00:11~00:12): 아이가 "다른놀이", "다른 놀이 하라고" 를
    // 세 번 말했는데 케이가 계속 끝말잇기를 밀어붙였다. 두 이유가 겹쳐 있었다 —
    //   1) "다른놀이" 가 어떤 신호에도 안 걸렸다(신호는 utteranceSignals 에서 고쳤다)
    //   2) 신호가 잡혀도 활성 세션의 handleTurn 이 먼저 돌아 그 발화를 낱말로 처리했다
    //      ("놀이" 라는 낱말 때문에 화제 전환으로도 안 잡힌다)
    //
    // 지금 하는 놀이를 바꾸자는 요청은 **하던 놀이를 끝내는 신호**다. 명시적 중단과 같은
    // 자리에서 처리한다. 다만 그만두자는 것이 아니라 다른 놀이를 하자는 것이므로
    // 세션만 닫고 제안 경로로 흘려보낸다(아래 5번에서 놀이 목록을 물어본다).
    const wantsDifferentPlay = Boolean(signals?.hasPlayRequestWithoutTarget) && Boolean(activeSkill);
    if (wantsDifferentPlay && activeSkill) {
      let switchEndSucceeded = false;
      try {
        await activeSkill.end({
          db,
          childId,
          chatSessionId,
          reason: "SWITCH_REQUESTED",
        });
        switchEndSucceeded = true;
      } catch (endError) {
        console.error(
          `[skillRouter] Failed to end active skill ${activeSkill.id} on switch request:`,
          endError
        );
      }
      await clearPendingPlayProposal(chatSessionId, db);
      // 어떤 놀이를 할지 아이가 고르게 한다. 케이가 임의로 하나를 시작하지 않는다.
      //
      // 리뷰 지적(2026-08-20 BLOCKER): `ended` 를 빼먹으면 엔진의 hasActivePlaySession 이
      // true 로 남는다. 그러면 (a) 놀이 제안 경로가 "이미 놀이 중" 이라고 막혀 아이가
      // 놀이 목록을 못 받고 일반 대화로 흘러가며, (b) 가짜게임 복구 문구가
      // "하던 놀이 계속하자" 로 나가 방금 닫은 세션을 계속하자고 말한다.
      // 종료에 실패했으면 끝났다고 단정하지 않는다. 세션이 남은 채 UI 만 닫히면
      // 아이는 놀이가 끝난 줄 알지만 다음 턴에 되살아난다.
      //
      // 게다가 handled:false 로 흘려보내면, 활성 세션이 남아 있으니 놀이 제안 경로가
      // "이미 놀이 중" 으로 막힌다. 아이는 다른 놀이를 세 번 말해도 아무 답을 못 받는다
      // (010 실측과 같은 모양). 그래서 실패를 아이에게 말로 알린다.
      if (!switchEndSucceeded) {
        return {
          handled: true,
          skillId: activeSkill.id,
          ended: false,
          sessionLookupFailed: true,
          deterministicText:
            "어? 하던 놀이를 정리하는 데 문제가 생겼어.\n잠깐만 기다렸다가 다시 말해줄래?",
        };
      }
      // 여기도 그 자리에서 확정한다.
      if (sessionLookupFailed) {
        const settled = await settleRemainingSessions({
          db,
          childId,
          chatSessionId,
          registry,
          reason: "SWITCH_REQUESTED",
        });
        if (!settled) {
          return {
            handled: true,
            ended: false,
            sessionLookupFailed: true,
            deterministicText:
              "어? 하던 놀이를 정리하는 데 문제가 생겼어.\n잠깐만 기다렸다가 다시 말해줄래?",
          };
        }
      }
      return { handled: false, ended: true };
    }

    if (hasNegativeEmotion) {
      // 제안은 거둔다 — 기분이 안 좋은 아이에게 새 놀이를 밀어넣지 않는다.
      // 하던 놀이는 그대로 둔다.
      await clearPendingPlayProposal(chatSessionId, db);
      return { handled: false, sessionLookupFailed };
    }

    // 2-9. 상태를 모르는 채로는 **새 세션을 만들지 않는다.**
    //
    // 리뷰를 7차까지 돌리며 배운 것: 이 결함을 호출부마다 막으면 끝이 없었다.
    // 새 세션을 만드는 길이 넷이었고(말로 직접 요청, 놀이 전환, 제안 수락,
    // 모달 선택) 매 라운드 하나씩 발견됐다. 그래서 `start()` 를 부르는 자리를
    // 하나로 모아 그 문에서만 막는다.
    //
    // 넓게 막지는 않는다. 평범한 대화("오늘 학교에서…")까지 가로채면 케이가
    // 아무 이유 없이 "헷갈려" 라고 답한다 — 놀이 상태와 무관한 말인데.
    const startSkillGuarded = async (
      skill: PlaySkillModule
    ): Promise<{ blocked: boolean; result: PlaySkillTurnResult }> => {
      if (sessionLookupFailed) {
        // 남은 세션은 끝내지 않고 상태만 확인한다.
        const recheck = await resolveActiveSkill(db, childId, {
          registry,
          chatSessionId,
        });

        // 재조회에서 **세션이 보이면** 그것도 시작 거부 사유다.
        // 처음엔 lookupFailed 만 봤는데, 그러면 숨어 있던 활성 세션이 재조회에서
        // 드러난 경우에 오히려 새 세션을 만든다 — 중복이다(리뷰 지적, 2026-08-20).
        if (recheck.lookupFailed || recheck.skill) {
          console.error(
            `[skillRouter] 놀이 상태를 확정하지 못해 ${skill.id} 를 시작하지 않는다 (child ${childId}, 발견=${recheck.skill?.id ?? "없음"})`
          );
          return {
            blocked: true,
            result: {
              handled: true,
              ended: false,
              sessionLookupFailed: true,
              deterministicText:
                "어? 잠깐만, 내가 지금 좀 헷갈려.\n조금 뒤에 다시 말해줄래?",
            },
          };
        }
      }
      return { blocked: false, result: await skill.start(input) };
    };

    // 3. 직접 요청 확인 (findDirectlyRequestedSkill 또는 Pending Proposal 선택 매칭)
    let requestedSkill = findDirectlyRequestedSkill(signals, utterance, registry);

    // 만약 Pending Proposal이 있고 단답으로 제안된 스킬명을 말한 경우 (예: "초성", "끝말") 매칭
    if (!requestedSkill && pendingProposal && pendingProposal.offeredSkills?.length) {
      const trimmed = utterance.trim();
      for (const skillId of pendingProposal.offeredSkills) {
        const skill = findSkillById(skillId, registry);
        if (!skill) continue;
        if (
          trimmed.includes(skill.displayName) ||
          trimmed.includes(skill.proposal.label) ||
          (skillId === "CHOSUNG" && (trimmed.includes("초성") || trimmed.includes("ㅊㅅ"))) ||
          (skillId === "WORD_CHAIN" && (trimmed.includes("끝말") || trimmed.includes("말잇기"))) ||
          (skillId === "NONSENSE_QUIZ" && (trimmed.includes("넌센스") || trimmed.includes("수수께끼")))
        ) {
          requestedSkill = skill;
          break;
        }
      }
    }

    if (requestedSkill) {
      // 제안 삭제는 **문지기를 통과한 뒤**에 한다.
      // 여기서 먼저 지우면, 아이가 제안된 놀이 이름을 직접 말해 수락했는데
      // 조회 실패로 차단된 경우 제안까지 사라져 다시 수락할 방법이 없다
      // (리뷰 지적, 2026-08-20). 포괄 수락 경로에만 적용돼 있던 정책을 맞춘다.
      if (activeSkill) {
        if (activeSkill.id === requestedSkill.id) {
          // 요청된 Skill이 현재 활성 Skill과 같으면 기존 판을 끊지 않고 handleTurn
          // (이 경로는 새 세션을 만들지 않으므로 제안을 바로 정리한다)
          await clearPendingPlayProposal(chatSessionId, db);
          const turnResult = await activeSkill.handleTurn(input);
          return {
            ...turnResult,
            skillId: turnResult.skillId ?? activeSkill.id,
            // 다른 스킬을 못 읽었으면 상태는 아직 확정이 아니다.
            ...(sessionLookupFailed && !turnResult.ended
              ? { sessionLookupFailed: true }
              : {}),
          };
        } else {
          // 요청된 Skill이 현재 활성 Skill과 다르면: 기존 활성 Skill.end() -> 요청된 Skill.start()
          try {
            await activeSkill.end({
              db,
              childId,
              chatSessionId,
              reason: `SWITCH_TO_${requestedSkill.id}`,
            });
          } catch (endError) {
            // 예전에는 여기서 기존 놀이의 handleTurn 으로 되돌아갔다. 그러면 아이의
            // "넌센스 하자" 가 끝말잇기 **낱말로 채점**된다 — 010 실측에서 아이가
            // 세 번 겪은 바로 그 모양이다(리뷰 지적, 2026-08-20).
            // 못 바꿨다고 솔직히 말하고, 놀이는 그대로 둔다.
            console.error(
              `[skillRouter] Failed to end active skill during transition to ${requestedSkill.id}:`,
              endError
            );
            return {
              handled: true,
              skillId: activeSkill.id,
              ended: false,
              sessionLookupFailed: true,
              deterministicText:
                "어? 놀이를 바꾸는 데 문제가 생겼어.\n잠깐만 기다렸다가 다시 말해줄래?",
            };
          }
          const guarded = await startSkillGuarded(requestedSkill);
          // 차단됐으면 그 결과를 그대로 돌려준다. instruction 유무로 판정하면
          // 아이용 안내가 버려지고 자유대화로 대체된다(리뷰 지적, 2026-08-20).
          if (guarded.blocked) return guarded.result;
          await clearPendingPlayProposal(chatSessionId, db);
          const startResult = guarded.result;
          if (startResult.handled && startResult.instruction) {
            recordKPlayStarted(input, requestedSkill.id);
            return {
              ...startResult,
              skillId: startResult.skillId ?? requestedSkill.id,
            };
          }
          return { handled: false, sessionLookupFailed };
        }
      } else {
        // 활성 세션이 없으면 새 게임 start.
        //
        // 여기서 `sessionLookupFailed` 를 따로 앞에서 막던 분기가 있었는데 없앴다.
        // 그 분기가 문지기보다 먼저 잡아서, 문지기의 재조회가 아예 돌지 않았다.
        // 문지기는 재조회로 상태를 확정해 보고 정말 모를 때만 막으므로,
        // 일시적 실패가 곧 풀린 경우 아이는 그냥 놀이를 시작할 수 있다.
        const guarded = await startSkillGuarded(requestedSkill);
        if (guarded.blocked) return guarded.result;
        await clearPendingPlayProposal(chatSessionId, db);
        const startResult = guarded.result;
        if (startResult.handled && startResult.instruction) {
          recordKPlayStarted(input, requestedSkill.id);
          return {
            ...startResult,
            skillId: startResult.skillId ?? requestedSkill.id,
          };
        }
        return { handled: false, sessionLookupFailed };
      }
    }

    // 4. 직접 요청이 없으면 활성 세션의 handleTurn 실행 (Invariant 3: stickiness 유지)
    if (activeSkill) {
      await clearPendingPlayProposal(chatSessionId, db);
      const turnResult = await activeSkill.handleTurn(input);
      if (turnResult.handled && turnResult.instruction) {
        return {
          ...turnResult,
          skillId: turnResult.skillId ?? activeSkill.id,
          // 프로브에서 못 읽은 스킬이 있으면 그 사실도 함께 넘긴다.
          ...(sessionLookupFailed && !turnResult.ended
            ? { sessionLookupFailed: true }
            : {}),
        };
      }
      // 스킬이 처리하지 못했더라도 **세션을 닫았을 수 있다**
      // (예: 넌센스 TOPIC_SHIFT 는 세션을 끝내고 handled=false 를 돌려준다).
      // 그 `ended` 를 버리면 엔진이 놀이가 살아 있다고 착각한다 — 같은 계열 누락이다.
      // 같은 이유로 `sessionLookupFailed` 도 버리면 안 된다. 스킬이 세션을 닫으려다
      // 실패한 경우(넌센스 문제 부재·주제 전환, 끝말잇기 주제 전환)를 엔진이 못 본다
      // (리뷰 지적, 2026-08-20).
      return {
        handled: false,
        ended: turnResult.ended,
        sessionLookupFailed:
          turnResult.sessionLookupFailed || sessionLookupFailed || undefined,
      };
    }

    // 5. 활성 세션 없음 & Pending Proposal 존재할 때 아이의 포괄 수락 확인
    if (pendingProposal && pendingProposal.offeredSkills?.length > 0) {
      if (signals?.hasGenericPlayAcceptance) {
        if (pendingProposal.offeredSkills.length === 1) {
          // 단일 제안 수락 -> 해당 스킬 start 시도
          const targetSkillId = pendingProposal.offeredSkills[0];
          const targetSkill = findSkillById(targetSkillId, registry);
          if (targetSkill) {
            const guarded = await startSkillGuarded(targetSkill);
            // 차단됐으면 제안을 지우지 않는다 — 아이가 방금 수락했는데 제안까지
            // 사라지면 다시 수락할 방법이 없다.
            if (guarded.blocked) return guarded.result;
            const startResult = guarded.result;
            await clearPendingPlayProposal(chatSessionId, db);
            if (startResult.handled && startResult.instruction) {
              recordKPlayStarted(input, targetSkill.id);
              return {
                ...startResult,
                skillId: startResult.skillId ?? targetSkill.id,
              };
            }
            return { handled: false, sessionLookupFailed };
          }
        } else {
          // 복수 제안 수락 -> 임의 선택 금지, 되묻기 요청 (selection required)
          const skillNames = pendingProposal.offeredSkills
            .map((id) => findSkillById(id, registry)?.displayName)
            .filter(Boolean);
          const skillListText = skillNames.join("이랑 ");
          const instruction = `[놀이 선택 안내]\n아이가 놀이를 하자고 수락했지만 어떤 놀이를 할지 고르지 않았어. 아이에게 '${skillListText} 중 뭐 할래?'라고 물어서 아이가 직접 하나를 고르도록 해줘. 절대 네가 먼저 특정 놀이를 시작하거나 문제를 내지 마.`;

          await setPendingPlayProposal({
            ...pendingProposal,
            selectionRequired: true,
            proposedAt: Date.now(),
          }, db);

          return {
            handled: true,
            instruction,
          };
        }
      }
    }

    // 6. 활성 세션도 없고 직접 요청/수락/거절도 아닌 무관한 대화인 경우:
    // 제안은 바로 다음 1턴에만 유효하므로 수락 없이 다른 얘기로 넘어가면 즉시 정리
    if (pendingProposal) {
      await clearPendingPlayProposal(chatSessionId, db);
    }

    return { handled: false, sessionLookupFailed };
  } catch (error) {
    console.error("[skillRouter] routePlaySkillTurn unhandled error:", error);
    // 라우터가 통째로 죽었으면 놀이 상태를 알 수 없다. 없다고 단정하지 않는다.
    return { handled: false, sessionLookupFailed: true };
  }
}

/**
 * 아이가 **말로** 게임을 시작한 경로의 계측.
 *
 * 모달 선택(`executeSkillSelection`)만 계측하면 "끝말잇기 하자"처럼 말로 시작한
 * 놀이가 통째로 안 잡힌다. 그쪽이 오히려 더 많다.
 */
function recordKPlayStarted(input: RoutePlaySkillTurnInput, skillId: string): void {
  const recorder = input.recordEvent ?? recordKPlayEvent;
  recorder("k_play_start", {
    db: input.db,
    childId: input.childId,
    chatSessionId: input.chatSessionId,
    skillId,
    route: "utterance",
  });
}
