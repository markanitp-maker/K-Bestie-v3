"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { VoiceInputModeSwitch } from "@/components/VoiceInputModeSwitch";
import { pickNonRepeatingReaction } from "@/lib/mission/eReactionPool";

import { getModeStrategy } from "@/lib/mission/conversationModeStrategy";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";

// E안, F안 실행 러너 (Plan01 §4 E, F안 — 테스트 계정 전용).
// /child/missions 실제 실행 경로에서 테스트 계정 + E/F override일 때 렌더된다(일반 계정은 기존 미션 그대로).
// 아이 음성 입력 → STT(/api/mission/stt) → 아이 텍스트 말풍선 저장/표시 (F안은 숨김)
//   → 공통 오케스트레이터(/api/mission/answer) → 유효답변 판정·진행률·완료·황금열쇠(record_v2_mission_answer RPC)
//   → 케이 답변(/api/mission/respond, LLM) → 케이 텍스트 말풍선 저장/표시.
// TTS API 호출·오디오 재생은 절대 하지 않는다(useVoiceChat.speak()를 호출하지 않음).
// conversation_mode='E' (또는 'F')를 mission/stt·mission/respond 에 실어 usage_events에 태깅(§23).
// 고정 10개 질문(test-mission/start)을 순서대로 진행. 새로고침·재입장 시 chat_messages로 복원.
//
// 레이아웃: 디바이스 프레임 없이 전체 화면(100dvh) = 고정 헤더 + flex:1 채팅 스크롤 + 하단 고정 composer.
// 가로 스크롤/중첩 스크롤 제거, safe-area·모바일 키보드 대응.

interface Bubble { role: "child" | "k"; text: string; displaySequence: number; turnId?: string }
interface Q { id: string; question_text: string; dashboard_area_tag: string }

const uuid = () => crypto.randomUUID();

export function TestModeERunner({ selectedMode }: { selectedMode: "E" | "F" }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "denied" | "ready">("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [progress, setProgress] = useState(0);
  const [validCount, setValidCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isAuto, setIsAuto] = useState(true);
  const isAutoRef = useRef(isAuto);
  isAutoRef.current = isAuto;

  useScreenWakeLock(status === "ready" && !completed);

  type AutoPhase = "idle" | "listening" | "speaking" | "finalizing" | "responding" | "error";
  const [autoPhase, setAutoPhaseState] = useState<AutoPhase>("idle");
  const autoPhaseRef = useRef<AutoPhase>("idle");
  const setAutoPhase = useCallback((phase: AutoPhase) => {
    autoPhaseRef.current = phase;
    setAutoPhaseState(phase);
  }, []);
  const sttFailStreakRef = useRef(0);
  const lowLatencyEnabledRef = useRef(true);
  const personalizedReactionEnabledRef = useRef(true);
  const lastReactionRef = useRef<string | null>(null);
  const turnTimingsRef = useRef<Array<Record<string, number>>>([]);
  const pendingTimingRef = useRef<Record<string, number>>({});

  const timingBeginSpeech = useCallback(() => { pendingTimingRef.current = { speech_begin: Date.now() }; }, []);
  const timingEndSpeech = useCallback(() => { pendingTimingRef.current.speech_end = Date.now(); }, []);

  const sessionIdRef = useRef<string | null>(null);
  const questionsRef = useRef<Q[]>([]);
  const currentIndexRef = useRef(0);
  const statesRef = useRef<Record<string, string>>({});
  const seqRef = useRef(0);            // childTurnId 시퀀스
  const dispSeqRef = useRef(0);        // display_sequence 카운터
  const completedRef = useRef(false);
  const busyRef = useRef(false);
  const bubblesRef = useRef<Bubble[]>([]);
  bubblesRef.current = bubbles;
  // 재시작(새 테스트) 세대 카운터 — 진행 중이던 answer/respond가 새 세션 UI를 갱신하지 못하게 막는다.
  const loadEpochRef = useRef(0);
  const voiceRef = useRef<ReturnType<typeof useVoiceChat> | null>(null);

  // 자동 스크롤: 사용자가 하단 근처를 보고 있을 때만 최신 말풍선으로 이동(과거 열람 중엔 강제 이동 안 함).
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const strategy = getModeStrategy(selectedMode);
  const showChildBubble = strategy.showChildBubble;

  const checkAutoFail = useCallback(() => {
    if (isAuto && sttFailStreakRef.current >= 2) {
      setIsAuto(false);
      voiceRef.current?.setInputMode("manual");
      setAutoPhase("error");
      setNotice("자동 듣기가 잘 안 되고 있어 수동 모드로 바꿨어. 🎤 버튼을 눌러 말해줘.");
    }
  }, [isAuto]);

  const handleModeChange = useCallback(async (newMode: "auto"|"manual") => {
    if (newMode === "manual") {
      if (voiceRef.current?.status === "live" && autoPhaseRef.current !== "responding") {
        voiceRef.current.setInputMode("manual");
        voiceRef.current.setMicEnabled(true);
      }
    } else {
      voiceRef.current?.setInputMode("auto");
      if (voiceRef.current?.status !== "live") {
        await voiceRef.current?.startSession();
      }
      voiceRef.current?.setMicEnabled(!busyRef.current);
    }
    setIsAuto(newMode === "auto");
  }, []);

  const onChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [bubbles, busy]);

  const addBubble = useCallback((role: "child" | "k", text: string) => {
    const displaySequence = ++dispSeqRef.current;
    const turnId = uuid();
    setBubbles((prev) => [...prev, { role, text, displaySequence, turnId }]);
    const sid = sessionIdRef.current;
    // 저장 완료를 기다릴 수 있도록 Promise 반환 — 아이 말풍선은 mission/respond 전에 await 해
    // 메시지 순서 경합(간헐 409)을 방지한다.
    const saved = sid
      ? fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, role, content: text, voiceMode: null, displaySequence, turnId }),
        }).then(() => {}).catch(() => {})
      : Promise.resolve();
    return { displaySequence, turnId, saved };
  }, []);

  const pickNextPending = useCallback((states: Record<string, string>): number => {
    const qs = questionsRef.current;
    const cur = currentIndexRef.current;
    for (let i = cur + 1; i < qs.length; i++) if ((states[qs[i].id] ?? "pending") === "pending") return i;
    for (let i = 0; i < qs.length; i++) if ((states[qs[i].id] ?? "pending") === "skipped") return i;
    return -1;
  }, []);

  const processAnswer = useCallback(async (answerText: string) => {
    const text = answerText.trim();
    if (!text || completedRef.current || busyRef.current) return;
    const sid = sessionIdRef.current;
    const qs = questionsRef.current;
    const currentQ = qs[currentIndexRef.current];
    if (!sid || !currentQ) return;

    const myEpoch = loadEpochRef.current; // 새 테스트로 재시작되면 이 턴의 결과 반영을 중단한다.
    busyRef.current = true; setBusy(true); setNotice(null);
    setAutoPhase("responding");
    if (isAuto) voiceRef.current?.setMicEnabled(false);
    // 자동스크롤은 '이미 하단 근처'일 때만(nearBottomRef) — 사용자가 과거 메시지를 보는 중엔 강제 이동하지 않는다.
    // respond용 history는 '현재 답변 포함'으로 동기 구성(비동기 상태 갱신 경합 방지).
    const priorHistory = bubblesRef.current.map((b) => ({ role: b.role, text: b.text }));
    // 아이 말풍선 저장/표시 (E안: 아이 말풍선 표시)
    const childSaved = addBubble("child", text).saved;
    pendingTimingRef.current.child_bubble_rendered = Date.now();
    const childTurnId = `${sid}:${currentQ.id}:${++seqRef.current}`;

    try {
      const isLowLatency = lowLatencyEnabledRef.current;
      const endpoint = isLowLatency ? "/api/mission/answer-lean" : "/api/mission/answer";
      const usePersonalized = isLowLatency && personalizedReactionEnabledRef.current;

      const answerFetchPromise = fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, questionId: currentQ.id, answerText: text, childTurnId }),
      });

      let reactionAbortController: AbortController | null = null;
      let thinkingTurnId: string | null = null;
      let thinkingDisplaySeq: number | null = null;
      let reactionResultPromise: Promise<{ text: string }> | null = null;

      if (usePersonalized) {
        thinkingDisplaySeq = ++dispSeqRef.current;
        thinkingTurnId = uuid();
        setBubbles((prev) => [...prev, { role: "k", text: "···", displaySequence: thinkingDisplaySeq!, turnId: thinkingTurnId! }]);

        reactionAbortController = new AbortController();

        reactionResultPromise = (async () => {
          const fallbackResult = pickNonRepeatingReaction(lastReactionRef.current);
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeoutMarker = Symbol("timeout");

          try {
            // 1200ms 안에 "첫 청크"가 도착하지 않으면 즉시 폴백 — fetch(네트워크 왕복 포함)부터
            // 첫 read()까지 전체를 재야 한다. fetch 응답(헤더) 도착 이후만 재면, fetch 자체가
            // 이미 1초 넘게 걸리는 경우를 못 잡는다(실측으로 확인된 문제).
            const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
              timeoutId = setTimeout(() => resolve(timeoutMarker), 1200);
            });

            const fetchAndFirstChunk = (async () => {
              const res = await fetch("/api/mission/reaction-lean", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: reactionAbortController!.signal,
                body: JSON.stringify({
                  questionText: currentQ.question_text,
                  answerText: text,
                  sessionId: sid,
                  childTurnId
                })
              });
              if (!res.ok || !res.body) throw new Error("Reaction fetch failed");
              const reader = res.body.getReader();
              const decoder = new TextDecoder();
              const first = await reader.read();
              return { reader, decoder, first };
            })();

            const raceResult = await Promise.race([fetchAndFirstChunk, timeoutPromise]);
            clearTimeout(timeoutId);

            if (raceResult === timeoutMarker) {
              reactionAbortController?.abort();
              // fetchAndFirstChunk가 나중에 resolve/reject되어도 아무도 기다리지 않으므로
              // unhandled rejection이 나지 않게 안전하게 소비해둔다.
              fetchAndFirstChunk.catch(() => {});
              pendingTimingRef.current.reaction_complete = Date.now();
              return { text: fallbackResult };
            }

            const { reader, decoder, first } = raceResult;

            try {
              if (myEpoch !== loadEpochRef.current) {
                await reader.cancel().catch(() => {});
                return { text: "" };
              }

              let accumulated = "";
              const { done: firstDone, value: firstValue } = first;
              if (!firstDone && firstValue) {
                pendingTimingRef.current.llm_first_token = Date.now();
                accumulated += decoder.decode(firstValue, { stream: true });
                const currentReaction = accumulated;
                setBubbles((prev) =>
                  prev.map((b) => (b.turnId === thinkingTurnId ? { ...b, text: currentReaction } : b))
                );
              }

              // 첫 청크 이후로는 추가 타임아웃 없이 스트림 끝까지 읽는다(첫 토큰만 1200ms 가드).
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (myEpoch !== loadEpochRef.current) {
                  await reader.cancel().catch(() => {});
                  return { text: "" };
                }
                const chunk = decoder.decode(value, { stream: true });
                accumulated += chunk;
                const currentReaction = accumulated;
                setBubbles((prev) =>
                  prev.map((b) => (b.turnId === thinkingTurnId ? { ...b, text: currentReaction } : b))
                );
              }

              pendingTimingRef.current.reaction_complete = Date.now();
              const trimmed = accumulated.trim();
              return { text: trimmed || fallbackResult };
            } finally {
              reader.releaseLock();
            }
          } catch {
            pendingTimingRef.current.reaction_complete = Date.now();
            return { text: fallbackResult };
          }
        })();
      } else if (isLowLatency) {
        reactionResultPromise = Promise.resolve({ text: pickNonRepeatingReaction(lastReactionRef.current) });
      }

      const ansRes = await answerFetchPromise;

      if (myEpoch !== loadEpochRef.current) {
        reactionAbortController?.abort();
        if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
        return; // 재시작됨 → 무효
      }
      if (ansRes.status === 423) {
        reactionAbortController?.abort();
        if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
        completedRef.current = true; setCompleted(true); return;
      }
      if (!ansRes.ok) {
        reactionAbortController?.abort();
        if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
        setNotice("답변 처리에 실패했어요. 다시 말해줄래?"); return;
      }
      
      const ans = await ansRes.json();
      pendingTimingRef.current.server_state_confirmed = Date.now();
      
      if (myEpoch !== loadEpochRef.current) {
        reactionAbortController?.abort();
        if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
        return;
      }
      statesRef.current = ans.questionStates ?? statesRef.current;
      setValidCount(ans.validAnswerCount ?? 0);
      setProgress(ans.progressPercent ?? 0);

      if (ans.completed) {
        reactionAbortController?.abort();
        if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
        completedRef.current = true; setCompleted(true);
        addBubble("k", "오늘의 미션을 모두 완료했어! 🔑 황금열쇠를 받았어. 내일 또 만나자!");
        pendingTimingRef.current.k_reaction_rendered = Date.now();
        pendingTimingRef.current.next_question_rendered = pendingTimingRef.current.k_reaction_rendered;
        turnTimingsRef.current.push({ ...pendingTimingRef.current });
        pendingTimingRef.current = {};
        console.log("[E-LOWLATENCY-TIMING]", JSON.stringify(turnTimingsRef.current));
        return;
      }

      const next = pickNextPending(statesRef.current);
      if (next < 0) {
        reactionAbortController?.abort();
        if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
        return;
      }
      const nextQ = qs[next];

      if (isLowLatency) {
        const { text: reactionText } = await reactionResultPromise!;
        // reaction 스트리밍 도중 새 테스트로 재시작됐으면(에포크 불일치) 이 결과는 폐기하고
        // placeholder 말풍선도 제거한다 — 옛 턴의 다음 질문을 새 세션에 잘못 반영하지 않기 위함.
        if (myEpoch !== loadEpochRef.current) {
          if (thinkingTurnId) setBubbles((prev) => prev.filter((b) => b.turnId !== thinkingTurnId));
          return;
        }
        lastReactionRef.current = reactionText;
        const finalKText = `${reactionText} ${nextQ.question_text}`;

        if (usePersonalized) {
          setBubbles((prev) =>
            prev.map((b) => (b.turnId === thinkingTurnId ? { ...b, text: finalKText } : b))
          );
          if (sid && thinkingDisplaySeq && thinkingTurnId) {
            fetch("/api/chat/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sid,
                role: "k",
                content: finalKText,
                voiceMode: null,
                displaySequence: thinkingDisplaySeq,
                turnId: thinkingTurnId,
              }),
            }).catch(() => {});
          }
        } else {
          addBubble("k", finalKText);
        }
        
        currentIndexRef.current = next;

        pendingTimingRef.current.k_reaction_rendered = Date.now();
        pendingTimingRef.current.next_question_rendered = pendingTimingRef.current.k_reaction_rendered;
        turnTimingsRef.current.push({...pendingTimingRef.current});
        pendingTimingRef.current = {};
      } else {
      // 아이 말풍선 저장 완료를 기다린 뒤 respond-lean 호출(메시지 순서 경합/409 방지).
      await childSaved;
      // 케이 답변(LLM 스트리밍) — 반응 + 다음 확정 질문. conversation_mode='E' 태깅(§23 usage_events).
      const respRes = await fetch("/api/mission/respond-lean", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          history: [...priorHistory, { role: "child", text }],
          nextQuestionText: nextQ.question_text,
          childTurnId,
          conversationMode: selectedMode,
        }),
      });

      if (myEpoch !== loadEpochRef.current) { respRes.body?.cancel().catch(() => {}); return; }

      if (!respRes.ok) {
        if (respRes.status === 409) {
          setNotice("대화 순서가 맞지 않아요. 잠시 후 다시 시도해 주세요.");
          return;
        }
        setNotice("연결이 불안정해요. 다시 말해줄래?");
        return;
      }

      // 스트리밍으로 리액션 읽기 및 케이 말풍선 실시간 업데이트
      const displaySequence = ++dispSeqRef.current;
      const turnId = uuid();
      setBubbles((prev) => [...prev, { role: "k", text: "", displaySequence, turnId }]);

      let accumulatedReaction = "";
      if (respRes.body) {
        const reader = respRes.body.getReader();
        const decoder = new TextDecoder();
        let cancelledByEpochMismatch = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (myEpoch !== loadEpochRef.current) {
              cancelledByEpochMismatch = true;
              break;
            }
            const chunk = decoder.decode(value, { stream: true });
            accumulatedReaction += chunk;
            const currentReaction = accumulatedReaction;
            setBubbles((prev) =>
              prev.map((b) => (b.turnId === turnId ? { ...b, text: currentReaction } : b))
            );
          }
        } finally {
          if (cancelledByEpochMismatch) {
            reader.cancel().catch(() => {});
          }
          reader.releaseLock();
        }
      }

      if (myEpoch !== loadEpochRef.current) return; // 재시작됨 → 새 세션에 옛 케이 답변을 넣지 않는다

      let reaction = accumulatedReaction.trim();
      const qCount = (reaction.match(/\?/g) ?? []).length;
      if (!reaction || reaction.length > 15 || qCount > 0) {
        reaction = "그렇구나!";
      }
      const finalKText = `${reaction} ${nextQ.question_text}`;

      currentIndexRef.current = next;
      setBubbles((prev) =>
        prev.map((b) => (b.turnId === turnId ? { ...b, text: finalKText } : b))
      );

      // chat_messages 테이블 저장 (addBubble 대신 스트림 종료 시 finalKText 저장)
      if (sid) {
        fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sid,
            role: "k",
            content: finalKText,
            voiceMode: null,
            displaySequence,
            turnId,
          }),
        }).catch(() => {});
      }
      
      pendingTimingRef.current.k_reaction_rendered = Date.now();
      pendingTimingRef.current.next_question_rendered = pendingTimingRef.current.k_reaction_rendered;
      turnTimingsRef.current.push({...pendingTimingRef.current});
      pendingTimingRef.current = {};
      }
    } catch {
      if (myEpoch === loadEpochRef.current) setNotice("연결이 불안정해요. 다시 말해줄래?");
    } finally {
      // 재시작(새 테스트)됐으면 새 세션 상태를 건드리지 않는다(stale 갱신 방지).
      if (myEpoch === loadEpochRef.current) { 
        busyRef.current = false; setBusy(false); 
        if (isAuto && !completedRef.current) {
          setAutoPhase("listening");
          voiceRef.current?.setMicEnabled(true);
        } else {
          setAutoPhase("idle");
        }
      }
    }
  }, [addBubble, pickNextPending, isAuto]);

  // STT(음성 입력) — E안: 케이 음성 없음이라 speak()를 절대 호출하지 않는다.
  const voice = useVoiceChat({
    getSessionId: () => sessionIdRef.current,
    conversationMode: selectedMode,
    onSpeechBegin: () => { setAutoPhase("speaking"); timingBeginSpeech(); },
    onSpeechEnd: () => { setAutoPhase("finalizing"); timingEndSpeech(); },
    onTurnComplete: (turn) => { 
      if (turn.role === "child") {
        pendingTimingRef.current.stt_final = Date.now();
        sttFailStreakRef.current = 0;
        if (turn.text.trim()) void processAnswer(turn.text); 
      }
    },
    onSttFailed: () => {
      sttFailStreakRef.current++;
      checkAutoFail();
      setNotice("잘 못 들었어요. 다시 말해줄래?");
    },
    onEmptyAudio: () => {
      sttFailStreakRef.current++;
      checkAutoFail();
      setNotice("소리가 안 들렸어요. 다시 말해줄래?");
    },
  });
  
  useEffect(() => {
    if (voice.status === "error" && isAuto) {
      setAutoPhase("error");
      setIsAuto(false);
      setNotice("마이크를 사용할 수 없어 수동 모드로 전환했어요. 텍스트로 답해줘도 괜찮아.");
    }
  }, [voice.status, isAuto]);
  voiceRef.current = voice;

  // 세션 로드/시작. forceNew=true면 '새 테스트 시작'(과거 세션 종료·이력 보존, 새 mission_session_id).
  // transcript·현재 질문·진행률·활성 turn을 새 세션 기준으로 초기화한다(과거 세션/사용량/검증 기록은 삭제하지 않음).
  const loadSession = useCallback(async (forceNew: boolean) => {
    loadEpochRef.current += 1; // 진행 중이던 answer/respond 턴 무효화
    // 입력/음성 세션 종료 후 초기화(진행 중 음성이 새 세션으로 넘어오지 않게).
    setTextInput(""); setListening(false);
    try { voiceRef.current?.stopSession(); } catch { /* noop */ }
    setStatus("loading"); setNotice(null);
    setBubbles([]); setProgress(0); setValidCount(0); setCompleted(false); setBusy(false);
    completedRef.current = false; busyRef.current = false;
    currentIndexRef.current = 0; dispSeqRef.current = 0; seqRef.current = 0; statesRef.current = {};
    nearBottomRef.current = true;

    const lowLatRes = await fetch("/api/child/test-mode/e-low-latency").catch(()=>null);
    if (lowLatRes?.ok) {
      const lowLatData = await lowLatRes.json();
      lowLatencyEnabledRef.current = lowLatData.enabled !== false;
      personalizedReactionEnabledRef.current = lowLatData?.personalizedReaction !== false;
    } else {
      lowLatencyEnabledRef.current = true;
      personalizedReactionEnabledRef.current = true;
    }

    const gate = await fetch("/api/child/test-mode");
    if (gate.status !== 200) { setStatus("denied"); return; }
    const g = await gate.json();
    if (g.selectedMode !== "E" && g.selectedMode !== "F") { setNotice(`이 화면은 E/F안 전용이에요. 대화 방식에서 E/F안을 선택해 주세요. (현재: ${g.selectedMode})`); setStatus("denied"); return; }

    const startRes = await fetch("/api/child/test-mission/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forceNew }),
    });
    if (!startRes.ok) { setStatus("denied"); return; }
    const s = await startRes.json();
    void sessionId;
    setSessionId(s.sessionId); sessionIdRef.current = s.sessionId;
    const qs: Q[] = s.questions ?? [];
    setQuestions(qs); questionsRef.current = qs;
    statesRef.current = s.questionStates ?? {};
    setValidCount(s.validAnswerCount ?? 0);
    setProgress(s.progressPercent ?? 0);
    completedRef.current = !!s.completed; setCompleted(!!s.completed);

    let idx = 0;
    for (let i = 0; i < qs.length; i++) { if ((statesRef.current[qs[i].id] ?? "pending") === "pending") { idx = i; break; } }
    currentIndexRef.current = idx;

    // 과거 말풍선 복원(forceNew 새 세션이면 없음). 없고 미완료면 첫 질문을 케이 말풍선으로 제시.
    let restored = false;
    const msgRes = await fetch(`/api/chat/messages?sessionId=${s.sessionId}`);
    if (msgRes.ok) {
      const md = await msgRes.json();
      const past: Bubble[] = (md.messages ?? []).map((m: { role: "child" | "k"; content: string; display_sequence: number }) => ({
        role: m.role, text: m.content, displaySequence: m.display_sequence,
      }));
      past.sort((a, b) => a.displaySequence - b.displaySequence);
      if (past.length > 0) {
        setBubbles(past);
        dispSeqRef.current = past.reduce((mx, b) => Math.max(mx, b.displaySequence ?? 0), 0);
        restored = true;
      }
    }
    setStatus("ready");
    if (!restored && !s.completed) setTimeout(() => addBubble("k", qs[idx]?.question_text ?? ""), 0);
    
    if (isAutoRef.current) {
      voiceRef.current?.setInputMode("auto");
      void voiceRef.current?.startSession();
    }
  }, [addBubble]);

  useEffect(() => { void loadSession(false); }, [loadSession]);

  const submitText = () => {
    const t = textInput.trim();
    if (!t || busy || completed) return;
    setTextInput("");
    void processAnswer(t);
  };

  const toggleVoice = async () => {
    if (completed || busy) return;
    if (!listening) {
      voice.setInputMode("manual");
      await voice.startSession();
      setListening(true);
    } else {
      voice.manualFinalize();
      setListening(false);
    }
  };

  const currentStep = Math.min(validCount + 1, 10);

  if (status === "loading") {
    return (
      <div style={fullCenter}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #1a6b5a", borderTopColor: "transparent", animation: "hbspin 0.8s linear infinite" }} />
        <style>{`@keyframes hbspin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (status === "denied") {
    return (
      <div style={{ ...fullCenter, flexDirection: "column", padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 40, margin: 0 }}>🔒</p>
        <p style={{ fontWeight: 700, color: "#1e1e2d", marginTop: 8 }}>{notice ?? "접근 권한이 없어요"}</p>
        <button onClick={() => router.replace("/child/test-modes")} style={{ ...btnBase, background: "#1a6b5a", marginTop: 16, padding: "12px 20px" }}>대화 방식으로</button>
      </div>
    );
  }

  return (
    <div style={{ height: "100dvh", width: "100%", overflow: "hidden", display: "flex", justifyContent: "center", background: "#fafaf8" }}>
      <div style={{ width: "100%", maxWidth: 560, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── 고정 헤더: 방식 · 현재 단계 · 진행률 ── */}
        <div style={{ flexShrink: 0, padding: "calc(10px + env(safe-area-inset-top)) 14px 10px", borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#1a6b5a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>대화 방식 테스트 · {selectedMode}안</span>
            <button
              data-testid="new-test"
              onClick={() => { void loadSession(true); }}
              style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 999, border: "1px solid #1a6b5a", background: "#fff", color: "#1a6b5a", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer", minHeight: 30 }}
            >
              🔄 새 테스트
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <VoiceInputModeSwitch isAuto={isAuto} onChange={handleModeChange} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span data-testid="progress" style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
              {completed ? "완료" : `질문 ${currentStep}/10`} · {progress}%
            </span>
            <div style={{ flex: 1, height: 7, background: "#eef2f1", borderRadius: 999, overflow: "hidden" }}>
              <div data-testid="progress-bar" style={{ width: `${progress}%`, height: "100%", background: "#1a6b5a", transition: "width .3s" }} />
            </div>
          </div>
        </div>

        {/* ── flex:1 채팅 스크롤 영역(유일한 스크롤) ── */}
        <div
          ref={chatScrollRef}
          onScroll={onChatScroll}
          data-testid="bubbles"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 8, padding: "14px 12px" }}
        >
          {bubbles.map((b, i) => {
            if (b.role === "child" && !showChildBubble) return null;
            return (
              <div
                key={b.turnId ?? i}
                data-role={b.role}
                data-seq={b.displaySequence}
                style={{
                  alignSelf: b.role === "child" ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius: 16,
                  background: b.role === "child" ? "#1a6b5a" : "#fff",
                  color: b.role === "child" ? "#fff" : "#1e1e2d",
                  border: b.role === "k" ? "1px solid #e5e7eb" : "none",
                  fontSize: 14,
                  lineHeight: 1.45,
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                {b.text}
              </div>
            );
          })}
        </div>

        {notice && <div style={{ flexShrink: 0, fontSize: 12, color: "#dc2626", padding: "0 14px 6px" }}>{notice}</div>}

        {/* ── 하단 고정 composer(키보드·safe-area 대응) ── */}
        <div style={{ flexShrink: 0, borderTop: "1px solid #e5e7eb", background: "#fff", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))" }}>
          {completed ? (
            <div data-testid="completed" style={{ textAlign: "center", padding: "10px 8px", background: "#f0fdf4", borderRadius: 12, color: "#166534", fontWeight: 700, fontSize: 14 }}>
              🎉 미션 완료 · 황금열쇠 지급됨
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button data-testid="retry" onClick={() => { void loadSession(true); }} style={{ ...btnBase, background: "#1a6b5a", flex: 1, minHeight: 44 }}>🔄 다시 테스트</button>
                <button onClick={() => router.replace("/child/test-modes")} style={{ ...btnBase, background: "#374151", flex: 1, minHeight: 44 }}>대화 방식으로</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              {isAuto ? (
                <button
                  disabled={true}
                  style={{ ...btnBase, background: autoPhase === "error" ? "#dc2626" : "#1a6b5a", minWidth: 92, minHeight: 44, whiteSpace: "nowrap", flexShrink: 0, opacity: 0.7 }}
                >
                  {autoPhase === "listening" ? "🎧 듣고 있어요" : 
                   autoPhase === "speaking" ? "🗣️ 말하는 중" :
                   autoPhase === "finalizing" || autoPhase === "responding" ? "⏳ 생각 중..." :
                   autoPhase === "error" ? "❌ 오류" : "🎧 듣는 중"}
                </button>
              ) : (
                <button
                  data-testid="mic"
                  onClick={toggleVoice}
                  disabled={busy}
                  style={{ ...btnBase, background: listening ? "#dc2626" : "#1a6b5a", minWidth: 92, minHeight: 44, whiteSpace: "nowrap", flexShrink: 0, opacity: busy ? 0.5 : 1 }}
                >
                  {listening ? "⏹ 완료" : "🎤 말하기"}
                </button>
              )}
              <input
                data-testid="text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitText(); }}
                placeholder="또는 텍스트로 답하기"
                disabled={busy}
                style={{ flex: 1, minWidth: 0, height: 44, padding: "0 12px", borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }}
              />
              <button
                data-testid="send"
                onClick={submitText}
                disabled={busy || !textInput.trim()}
                style={{ ...btnBase, background: "#374151", minWidth: 56, minHeight: 44, whiteSpace: "nowrap", flexShrink: 0, opacity: busy || !textInput.trim() ? 0.5 : 1 }}
              >
                전송
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const fullCenter: React.CSSProperties = { height: "100dvh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafaf8" };
const btnBase: React.CSSProperties = { padding: "0 14px", borderRadius: 12, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 };
