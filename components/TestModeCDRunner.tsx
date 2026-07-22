"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { VoiceInputModeSwitch } from "@/components/VoiceInputModeSwitch";
import { pickNonRepeatingReaction } from "@/lib/mission/eReactionPool";
import { getModeStrategy } from "@/lib/mission/conversationModeStrategy";
import type { ConversationMode } from "@/lib/plan/conversationMode";

interface Q { id: string; question_text: string; dashboard_area_tag: string }

const uuid = () => crypto.randomUUID();

export function TestModeCDRunner({ selectedMode }: { selectedMode: "C" | "D" }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "denied" | "ready">("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
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

  const strategy = getModeStrategy(selectedMode);
  const showChildBubble = strategy.showChildBubble;

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
  const seqRef = useRef(0);
  const dispSeqRef = useRef(0);
  const completedRef = useRef(false);
  const busyRef = useRef(false);
  const loadEpochRef = useRef(0);
  const voiceRef = useRef<ReturnType<typeof useVoiceChat> | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

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

    const myEpoch = loadEpochRef.current;
    busyRef.current = true; setBusy(true); setNotice(null);
    setAutoPhase("responding");
    if (isAuto) voiceRef.current?.setMicEnabled(false);
    
    const displaySequence = ++dispSeqRef.current;
    const childTurnIdObj = `${sid}:${currentQ.id}:${++seqRef.current}`;
    
    const childTurnId = childTurnIdObj;
    const saved = fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role: "child", content: text, voiceMode: null, displaySequence, turnId: childTurnIdObj }),
    }).then(() => {}).catch(() => {});

    pendingTimingRef.current.child_bubble_rendered = Date.now();

    try {
      const isLowLatency = lowLatencyEnabledRef.current;
      const endpoint = isLowLatency ? "/api/mission/answer-lean" : "/api/mission/answer";
      const usePersonalized = isLowLatency && personalizedReactionEnabledRef.current;

      const answerFetchPromise = fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, questionId: currentQ.id, answerText: text, childTurnId }),
      });

      let reactionResultPromise: Promise<{ text: string }> | null = null;

      if (usePersonalized) {
        const reactionAbortController = new AbortController();
        reactionResultPromise = (async () => {
          const fallbackResult = pickNonRepeatingReaction(lastReactionRef.current);
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeoutMarker = Symbol("timeout");

          try {
            const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
              timeoutId = setTimeout(() => resolve(timeoutMarker), 1200);
            });

            const fetchAndFirstChunk = (async () => {
              const res = await fetch("/api/mission/reaction-lean", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: reactionAbortController.signal,
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
            // 늦게 도착하는 fetch/read가 unhandled rejection을 내지 않게 미리 방어.
            fetchAndFirstChunk.catch(() => {});

            const raceResult = await Promise.race([fetchAndFirstChunk, timeoutPromise]);
            clearTimeout(timeoutId);

            if (raceResult === timeoutMarker) {
              // fetch 자체를 취소해 늦게 도착할 reader/연결이 방치되지 않게 한다.
              reactionAbortController.abort();
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
              }

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (myEpoch !== loadEpochRef.current) {
                  await reader.cancel().catch(() => {});
                  return { text: "" };
                }
                accumulated += decoder.decode(value, { stream: true });
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

      if (myEpoch !== loadEpochRef.current) return;
      if (ansRes.status === 423) {
        completedRef.current = true; setCompleted(true); return;
      }
      if (!ansRes.ok) {
        setNotice("답변 처리에 실패했어요. 다시 말해줄래?"); return;
      }
      
      const ans = await ansRes.json();
      pendingTimingRef.current.server_state_confirmed = Date.now();
      
      if (myEpoch !== loadEpochRef.current) return;
      
      statesRef.current = ans.questionStates ?? statesRef.current;
      setValidCount(ans.validAnswerCount ?? 0);
      setProgress(ans.progressPercent ?? 0);

      if (ans.completed) {
        completedRef.current = true; setCompleted(true);
        const finalMsg = "오늘의 미션을 모두 완료했어! 황금열쇠를 받았어. 내일 또 만나자!";
        await voiceRef.current?.speak(finalMsg, undefined, undefined);
        // speak() 재생 도중 "새 테스트"로 재시작됐으면(loadSession이 stopSession()으로 재생을
        // 강제 중단시켜 await가 여기서 풀림) 옛 턴 결과로 새 세션 상태/DB를 건드리지 않는다.
        if (myEpoch !== loadEpochRef.current) return;
        const kDispSeq = ++dispSeqRef.current;
        fetch("/api/chat/messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, role: "k", content: finalMsg, voiceMode: null, displaySequence: kDispSeq, turnId: uuid() }),
        }).catch(() => {});
        
        pendingTimingRef.current.k_reaction_rendered = Date.now();
        pendingTimingRef.current.next_question_rendered = pendingTimingRef.current.k_reaction_rendered;
        turnTimingsRef.current.push({ ...pendingTimingRef.current });
        pendingTimingRef.current = {};
        console.log("[CD-LOWLATENCY-TIMING]", JSON.stringify(turnTimingsRef.current));
        return;
      }

      const next = pickNextPending(statesRef.current);
      if (next < 0) return;
      
      const nextQ = qs[next];

      if (isLowLatency) {
        const { text: reactionText } = await reactionResultPromise!;
        if (myEpoch !== loadEpochRef.current) return;
        lastReactionRef.current = reactionText;
        const finalKText = `${reactionText} ${nextQ.question_text}`;
        
        await voiceRef.current?.speak(finalKText, undefined, undefined);
        if (myEpoch !== loadEpochRef.current) return;

        const kDispSeq = ++dispSeqRef.current;
        fetch("/api/chat/messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, role: "k", content: finalKText, voiceMode: null, displaySequence: kDispSeq, turnId: uuid() }),
        }).catch(() => {});

        currentIndexRef.current = next;

        pendingTimingRef.current.k_reaction_rendered = Date.now();
        pendingTimingRef.current.next_question_rendered = pendingTimingRef.current.k_reaction_rendered;
        turnTimingsRef.current.push({...pendingTimingRef.current});
        pendingTimingRef.current = {};
      } else {
        await saved;
        const history = (voiceRef.current?.getTranscript() ?? []).map((b) => ({ role: b.role, text: b.text }));
        const respRes = await fetch("/api/mission/respond-lean", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sid,
            history: history,
            nextQuestionText: nextQ.question_text,
            childTurnId,
            conversationMode: selectedMode,
          }),
        });

        if (myEpoch !== loadEpochRef.current) { respRes.body?.cancel().catch(() => {}); return; }

        if (!respRes.ok) {
          if (respRes.status === 409) { setNotice("대화 순서가 맞지 않아요. 잠시 후 다시 시도해 주세요."); return; }
          setNotice("연결이 불안정해요. 다시 말해줄래?"); return;
        }

        let accumulatedReaction = "";
        if (respRes.body) {
          const reader = respRes.body.getReader();
          const decoder = new TextDecoder();
          let cancelledByEpochMismatch = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (myEpoch !== loadEpochRef.current) { cancelledByEpochMismatch = true; break; }
              accumulatedReaction += decoder.decode(value, { stream: true });
            }
          } finally {
            if (cancelledByEpochMismatch) await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
        
        if (myEpoch !== loadEpochRef.current) return;
        let reaction = accumulatedReaction.trim();
        const qCount = (reaction.match(/\?/g) ?? []).length;
        if (!reaction || reaction.length > 15 || qCount > 0) {
          reaction = "그렇구나!";
        }
        const finalKText = `${reaction} ${nextQ.question_text}`;
        
        await voiceRef.current?.speak(finalKText, undefined, undefined);
        if (myEpoch !== loadEpochRef.current) return;

        const kDispSeq = ++dispSeqRef.current;
        if (sid) {
          fetch("/api/chat/messages", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, role: "k", content: finalKText, voiceMode: null, displaySequence: kDispSeq, turnId: uuid() }),
          }).catch(() => {});
        }
        
        currentIndexRef.current = next;
        
        pendingTimingRef.current.k_reaction_rendered = Date.now();
        pendingTimingRef.current.next_question_rendered = pendingTimingRef.current.k_reaction_rendered;
        turnTimingsRef.current.push({...pendingTimingRef.current});
        pendingTimingRef.current = {};
      }
    } catch {
      if (myEpoch === loadEpochRef.current) setNotice("연결이 불안정해요. 다시 말해줄래?");
    } finally {
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
  }, [isAuto, pickNextPending, selectedMode]);

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

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [voice.transcript, busy]);

  const loadSession = useCallback(async (forceNew: boolean) => {
    loadEpochRef.current += 1;
    const myLoadEpoch = loadEpochRef.current;
    setTextInput(""); setListening(false);
    try { voiceRef.current?.stopSession(); } catch { /* noop */ }
    setStatus("loading"); setNotice(null);
    setProgress(0); setValidCount(0); setCompleted(false); setBusy(false);
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
    if (g.selectedMode !== "C" && g.selectedMode !== "D") { 
      setNotice(`이 화면은 C/D안 전용이에요. (현재: ${g.selectedMode})`); 
      setStatus("denied"); 
      return; 
    }

    const startRes = await fetch("/api/child/test-mission/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forceNew }),
    });
    if (!startRes.ok) { setStatus("denied"); return; }
    const s = await startRes.json();
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

    let restored = false;
    const msgRes = await fetch(`/api/chat/messages?sessionId=${s.sessionId}`);
    if (msgRes.ok) {
      const md = await msgRes.json();
      const past = (md.messages ?? []).map((m: any) => ({
        role: m.role, text: m.content, displaySequence: m.display_sequence, id: m.turnId
      }));
      past.sort((a: any, b: any) => a.displaySequence - b.displaySequence);
      if (past.length > 0) {
        voiceRef.current?.seedTranscript(past);
        dispSeqRef.current = past.reduce((mx: number, b: any) => Math.max(mx, b.displaySequence ?? 0), 0);
        restored = true;
      }
    }
    setStatus("ready");

    // 자동모드면 첫 질문을 말하기(speak) 전에 startSession()을 먼저 끝내둔다 — speak()는
    // startSession()이 만드는 AudioContext가 있어야 실제 음성 재생이 되고, 없으면 자막만
    // 표시되는 폴백으로 조용히 빠진다(순서가 뒤바뀌면 첫 질문 음성이 간헐적으로 안 나옴).
    if (isAutoRef.current) {
      voiceRef.current?.setInputMode("auto");
      await voiceRef.current?.startSession();
    }
    if (myLoadEpoch !== loadEpochRef.current) return;

    if (!restored && !s.completed) {
      void voiceRef.current?.speak(qs[idx]?.question_text ?? "");
    }
  }, []);

  useEffect(() => { void loadSession(false); }, [loadSession]);

  const submitText = () => {
    const t = textInput.trim();
    if (!t || busy || completed) return;
    setTextInput("");
    voice.sendTypedText(t);
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

        <div
          ref={chatScrollRef}
          onScroll={onChatScroll}
          data-testid="bubbles"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 8, padding: "14px 12px" }}
        >
          {voice.transcript.map((b, i) => {
            if (b.role === "child" && !showChildBubble) return null;
            return (
              <div
                key={b.id ?? i}
                data-role={b.role}
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
