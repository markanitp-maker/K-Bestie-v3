"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import KChatbotWidget from "@/components/KChatbotWidget";
import { useParentVoice } from "@/hooks/useParentVoice";
import { useStore } from "@/hooks/useStore";
import { Mic, MicOff, Send, Volume2, Square } from "lucide-react";
import { AskChildDraftModal } from "@/components/parent/AskChildDraftModal";
import { RedCoachingModal } from "@/components/parent/RedCoachingModal";
import { MultiQuestionSelectModal, type MultiQuestionCandidate } from "@/components/parent/MultiQuestionSelectModal";

type Message = {
  id: string;
  role: "user" | "k";
  text: string;
  askChildProposal?: string | null;
  originalQuestion?: string;
  askChildStatus?: "success" | "error";
  askChildErrorText?: string;
  askChildIsLoading?: boolean;
  askChildRetryable?: boolean;
  askChildQuestionText?: string;
  askChildWeeklyUsedCount?: number;
  askChildWeeklyLimit?: number;
  requestedTopic?: string;
  requestedArea?: string;
  parentIntent?: string;
};

// requests/request-parent-question-draft-modal-fix.md §6 — 초안 질문 모달 상태.
interface DraftModalState {
  isOpen: boolean;
  messageId: string;
  childId: string;
  originalQuestion: string;
  draftQuestion: string;
  weeklyUsedCount: number;
  weeklyLimit: number;
  isSubmitting: boolean;
  submitError: string | null;
  idempotencyKey: string;
  // requests/request-parent-question-safe-rewrite-modal-fix.md §5 — 자동 재작성 안내를
  // "재작성이 실제로 일어난 경우"에만 보여주기 위한 분류값.
  rewriteApplied: boolean;
  // requests/request-parent-query-router-grade4-v1.md — 4학년 라우터의 GREEN 확정 문구는
  // 읽기 전용(고정 화이트리스트), source/ruleId는 확정 등록 시 서버로 그대로 되돌려 보낸다.
  source?: "PARENT_QUERY_ROUTER";
  ruleId?: string;
  editable: boolean;
  dailyUsedToday?: boolean;
  childQuestionText?: string;
  requestedTopic?: string;
  requestedArea?: string;
}

// requests/request-parent-query-router-grade4-v1.md §9.2/§9.3/§10 — Red/Crisis 코칭과
// 다중 질문 선택은 초안 모달과 별개의 상태로 관리한다(동시에 하나만 열림).
interface RedCoachingState {
  messageId: string;
  originalQuestion: string;
  variant: "RED" | "CRISIS";
  coachingText: string;
  safeAlternative: { ruleId: string; area: string; parentDraftText: string; childQuestionText: string } | null;
  weeklyUsedCount: number;
  weeklyLimit: number;
  dailyUsedToday: boolean;
}

interface MultiSelectState {
  messageId: string;
  originalQuestion: string;
  questionCount: number;
  candidates: Array<{ ruleId: string; area: string; parentDraftText: string; childQuestionText: string }>;
  weeklyUsedCount: number;
  weeklyLimit: number;
  dailyUsedToday: boolean;
}

export default function ParentGuidePage() {
  // ParentHeader의 setStore() 호출이 같은 탭에서도 STORE_EVENT로 즉시 전파되므로,
  // localStorage 폴링 대신 이 값을 구독해야 자녀 전환이 실시간으로 반영된다
  // (codex 025p2 정적리뷰: localStorage만 봐서는 같은 탭 전환이 감지되지 않아
  //  이전 자녀의 대화·응답이 전환 후에도 화면에 남는 문제가 있었음).
  const { activeChildId } = useStore();
  const [childName, setChildName] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [draftModal, setDraftModal] = useState<DraftModalState | null>(null);
  const [redCoaching, setRedCoaching] = useState<RedCoachingState | null>(null);
  const [multiSelect, setMultiSelect] = useState<MultiSelectState | null>(null);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // requests/request-parent-k-conversation-context-and-draft-edit-fix.md §6/§9 — 아직
  // 확정·취소되지 않은 "아이에게 물어보기" 제안 원문. child_id별 sessionStorage에도
  // 저장해 새로고침으로 완전히 유실되지 않게 한다(§6). 자녀 전환 시 반드시 분리한다(§9).
  const [pendingAskChildProposal, setPendingAskChildProposalState] = useState<string | null>(null);
  const setPendingAskChildProposal = useCallback((value: string | null, forChildId: string | null) => {
    setPendingAskChildProposalState(value);
    if (typeof window === "undefined" || !forChildId) return;
    const key = `k_chat_pending_draft_${forChildId}`;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
  const askChildInFlightRef = useRef(new Set<string>());
  const lastVoiceTranscriptRef = useRef("");

  const {
    isSttSupported,
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    isSpeaking,
    speakText,
    stopSpeaking,
    sttError,
  } = useParentVoice();

  const childId = activeChildId ?? (typeof window !== "undefined" ? localStorage.getItem("k_child_id") : null);
  // 응답이 도착한 시점에 이미 다른 자녀로 전환됐다면(claude-review 재지적: 최초 수정은
  // 자녀 정보 로드 fetch만 취소했고, 실제 대화 응답 fetch는 취소 대상이 아니었음) 그
  // 응답을 현재 화면에 반영하지 않기 위해 최신 childId를 ref로도 들고 있는다.
  const childIdRef = useRef<string | null>(childId);
  childIdRef.current = childId;

  // 자녀 전환 시: 진행 중인 요청 취소 + 대화 완전 분리 + 새 자녀 정보 로드
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setChildName("");
    setInputText("");
    // claude-review 재지적: handleSendMessage/handleAskChild의 finally는 stale 응답이면
    // isLoading을 건드리지 않고 return하므로, 전환 시점에 여기서 직접 풀어줘야 한다
    // (안 그러면 이전 자녀의 응답이 도착할 때까지 "생각 중" 상태와 입력 비활성이 남는다).
    setIsLoading(false);
    // claude-review 재지적(draft-modal-fix): 모달이 열린 채 자녀를 전환하면 확정 시
    // 옛 자녀 문맥의 질문이 새 자녀 child_id/quota로 등록될 위험이 있다. 아직 DB에
    // 반영되지 않은 초안이므로 그냥 버리는 것이 안전하다(§6.3과 동일한 "취소" 취급).
    setDraftModal(null);
    setRedCoaching(null);
    setMultiSelect(null);
    // 다른 자녀의 pending draft가 섞여 들어가지 않도록 먼저 비우고, 이 자녀 몫만 복원한다(§9).
    setPendingAskChildProposalState(null);
    if (childId && typeof window !== "undefined") {
      const restored = sessionStorage.getItem(`k_chat_pending_draft_${childId}`);
      if (restored) setPendingAskChildProposalState(restored);
    }

    if (!childId) return;

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/api/child/${encodeURIComponent(childId)}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (controller.signal.aborted) return;
        if (d?.name) {
          setChildName(d.name);
          setMessages([
            {
              id: "welcome",
              role: "k",
              text: `${d.name}에 대해 궁금한 점을 물어보세요. 케이가 알고 있는 기록 안에서만 알려드릴게요.`
            }
          ]);
        }
      })
      .catch((e) => {
        if (e?.name !== "AbortError") console.error("child info load error:", e);
      });

    return () => controller.abort();
  }, [childId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 과거 메시지를 읽으려고 위로 스크롤한 사용자의 스크롤 위치를 강탈하지 않도록,
  // 이미 하단 근처에 있을 때만 자동 스크롤한다.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (nearBottom) scrollToBottom();
  }, [messages, isLoading, interimTranscript]);

  const sendMessage = useCallback(async (rawText: string) => {
    const textToSend = rawText.trim();
    if (!textToSend || !childId || sendInFlightRef.current) return;
    const requestChildId = childId;

    sendInFlightRef.current = true;
    stopListening();
    setInputText("");

    const userMsgId = Date.now().toString();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", text: textToSend }]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/parent/k-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          child_id: requestChildId,
          question: textToSend,
          priorAskChildProposal: pendingAskChildProposal,
        }),
      });

      const data = await res.json();
      // 응답 도착 시점에 이미 다른 자녀로 전환됐다면 이 응답을 현재 화면에 반영하지 않는다.
      if (childIdRef.current !== requestChildId) return;

      const nextProposal = data.answerable === false ? (data.askChildProposal ?? null) : null;
      if (data.pendingDraftCancelled) {
        setPendingAskChildProposal(null, requestChildId);
      } else if (nextProposal) {
        setPendingAskChildProposal(nextProposal, requestChildId);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "k",
          text: data.answer || "응답을 가져올 수 없어요.",
          askChildProposal: nextProposal,
          originalQuestion: textToSend, // 원래 질문을 항상 보존하여 topics가 유실되지 않도록 한다.
          requestedTopic: data.requestedTopic,
          requestedArea: data.requestedArea,
          parentIntent: data.intent,
        }
      ]);
    } catch (err) {
      console.error("Chat error:", err);
      if (childIdRef.current !== requestChildId) return;
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "k", text: "지금은 케이가 답변을 준비하지 못했어요. 잠시 후 다시 시도해 주세요." }
      ]);
    } finally {
      sendInFlightRef.current = false;
      if (childIdRef.current === requestChildId) setIsLoading(false);
    }
  }, [childId, stopListening]);

  // requests/request-parent-k-stt-input-focus-fix-dev-prod.md — 최종 음성 인식 결과는
  // document.activeElement/입력창 focus 여부와 무관하게 채팅 입력 state(inputText)에
  // 직접 반영한다. 이전에는 마이크 중지 즉시 채팅으로 자동 전송했는데(§4 요구사항 5 위반
  // — "마이크 중지 시 sendMessage()를 자동 호출하지 않는다"), 사용자가 결과를 확인·수정할
  // 기회 없이 바로 전송돼버렸고 전송 버튼을 눌러야만 전송되는 정책과도 맞지 않았다.
  // 이제는 입력창에 채워 넣기만 하고, 전송은 사용자가 전송 버튼을 눌렀을 때만 일어난다.
  // 동일한 final 이벤트가 브라우저에서 반복 전달되어도 한 번만 반영한다.
  useEffect(() => {
    const finalText = transcript.replace(/\s+/g, " ").trim();
    if (!finalText) {
      lastVoiceTranscriptRef.current = "";
      return;
    }
    // 모바일 브라우저는 한 번의 발화를 여러 final 조각으로 나눠 전달할 수 있다.
    // 인식이 완전히 끝난 뒤 누적된 문장 전체를 한 번만 입력창에 반영한다.
    if (isListening) return;
    if (finalText === lastVoiceTranscriptRef.current) return;

    lastVoiceTranscriptRef.current = finalText;
    setInputText((previous) => {
      const current = previous.trimEnd();
      return current ? `${current} ${finalText}` : finalText;
    });
  }, [transcript, isListening]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    void sendMessage(inputText);
  };

  // requests/request-parent-question-draft-modal-fix.md §3/§6.1 — "아이에게 물어보기"
  // 클릭은 곧바로 등록하지 않고, 1단계(초안 생성, 등록/차감 없음)만 수행한 뒤 모달을 연다.
  const handleAskChild = async (originalQuestion: string, msgId: string) => {
    if (!childId) return;
    if (askChildInFlightRef.current.has(msgId)) return;
    askChildInFlightRef.current.add(msgId);
    const requestChildId = childId;

    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, askChildIsLoading: true, askChildErrorText: undefined } : m));

    const msg = messages.find((m) => m.id === msgId);

    try {
      const res = await fetch("/api/parent/k-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: "draft_child_question", 
          child_id: requestChildId, 
          question: originalQuestion,
          requested_topic: msg?.requestedTopic,
          requested_area: msg?.requestedArea,
          parent_intent: msg?.parentIntent,
          conversation_id: `k-chat-${requestChildId}`,
          last_user_message_id: msgId,
          policy_version: "v2",
          source_grade: 4 // This is a placeholder, server resolves realGrade
        }),
      });
      const data = await res.json();
      if (childIdRef.current !== requestChildId) return;

      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, askChildIsLoading: false } : m));

      // requests/request-parent-query-router-grade4-v1.md — 4학년 라우터 응답(GREEN/RED/
      // CRISIS/MULTI_QUESTION_SELECT)을 우선 분기한다. 그 외(SAFE_AS_IS/SAFE_AFTER_REWRITE/
      // 없음)는 기존 일반 재작성 플로우다.
      if (res.ok && data.classification === "GREEN" && data.source === "PARENT_QUERY_ROUTER") {
        setDraftModal({
          isOpen: true,
          messageId: msgId,
          childId: requestChildId,
          originalQuestion: originalQuestion,
          draftQuestion: data.draftQuestion,
          childQuestionText: data.childQuestionText,
          weeklyUsedCount: data.weeklyUsedCount ?? 0,
          weeklyLimit: data.weeklyLimit ?? 3,
          dailyUsedToday: !!data.dailyUsedToday,
          isSubmitting: false,
          submitError: null,
          rewriteApplied: false,
          source: "PARENT_QUERY_ROUTER",
          ruleId: data.ruleId,
          editable: false,
          idempotencyKey: `ask-child-${msgId}`,
          requestedTopic: msg?.requestedTopic,
          requestedArea: msg?.requestedArea,
        });
        return;
      }

      if (res.ok && data.classification === "MULTI_QUESTION_SELECT") {
        setMultiSelect({
          messageId: msgId,
          originalQuestion,
          questionCount: data.questionCount ?? 1,
          candidates: Array.isArray(data.candidates) ? data.candidates : [],
          weeklyUsedCount: data.weeklyUsedCount ?? 0,
          weeklyLimit: data.weeklyLimit ?? 3,
          dailyUsedToday: !!data.dailyUsedToday,
        });
        return;
      }

      if (!res.ok && data.classification === "RED") {
        setRedCoaching({
          messageId: msgId,
          originalQuestion,
          variant: "RED",
          coachingText: data.error || "이 질문은 케이가 아이에게 대신 묻지 않아요.",
          safeAlternative: data.safeAlternative ?? null,
          weeklyUsedCount: data.weeklyUsedCount ?? 0,
          weeklyLimit: data.weeklyLimit ?? 3,
          dailyUsedToday: !!data.dailyUsedToday,
        });
        return;
      }

      if (!res.ok && data.classification === "CRISIS") {
        setRedCoaching({
          messageId: msgId,
          originalQuestion,
          variant: "CRISIS",
          coachingText: data.error || "이 질문은 케이가 대신 전달할 수 없어요.",
          safeAlternative: null,
          weeklyUsedCount: 0,
          weeklyLimit: 3,
          dailyUsedToday: false,
        });
        return;
      }

      if (res.ok && typeof data.draftQuestion === "string" && data.draftQuestion.trim()) {
        // §6.2 초안 생성 성공 후에만 모달을 연다.
        setDraftModal({
          isOpen: true,
          messageId: msgId,
          childId: requestChildId,
          originalQuestion: data.originalQuestion ?? originalQuestion,
          draftQuestion: data.draftQuestion,
          weeklyUsedCount: data.weeklyUsedCount ?? 0,
          weeklyLimit: data.weeklyLimit ?? 3,
          isSubmitting: false,
          submitError: null,
          rewriteApplied: data.classification === "SAFE_AFTER_REWRITE",
          editable: true,
          // claude-review 재지적: 매번 새 랜덤 키를 발급하면, 서버가 실제로는 처리(차감+insert)
          // 했지만 응답만 유실된 경우 모달 취소 후 재시도 시 새 키로 중복 등록된다. 같은
          // 메시지(msgId)에 대한 재시도는 항상 같은 키를 써서 서버의 idempotency 조회가
          // 이전 시도를 그대로 찾아 반환하게 한다.
          idempotencyKey: `ask-child-${msgId}`,
          requestedTopic: msg?.requestedTopic,
          requestedArea: msg?.requestedArea,
        });
        return;
      }

      // §6.2 "초안 생성 API가 실패해도 아무 반응 없이 끝내지 않는다"
      let errorMessage = "질문 초안을 만드는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.";
      let retryable = true;
      if (res.status === 401) { errorMessage = "로그인이 만료됐어요. 다시 로그인해 주세요."; retryable = false; }
      if (res.status === 403) { errorMessage = "이 아이에게 질문을 등록할 권한이 없어요."; retryable = false; }
      // requests/request-parent-question-safe-rewrite-modal-fix.md §10 — 추측·유도·복수질문
      // 등은 이제 서버가 재작성해서 모달을 열어주므로, 여기 422로 도달하는 경우는 실제
      // BLOCKED(재작성해도 안전하지 않음)뿐이다. data.error에 그 사유가 담겨 온다.
      if (res.status === 422) { errorMessage = data.error || "이 질문은 아이에게 부담을 줄 수 있어 그대로 전달할 수 없어요."; retryable = false; }
      if (res.status === 429) { errorMessage = "잠시 요청이 몰렸어요. 잠시 후 다시 시도해 주세요."; retryable = true; }

      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        askChildStatus: "error",
        askChildErrorText: errorMessage,
        askChildRetryable: retryable,
      } : m));
    } catch (err) {
      console.error("Ask child draft error:", err);
      if (childIdRef.current !== requestChildId) return;
      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        askChildStatus: "error",
        askChildErrorText: "질문 초안을 만드는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
        askChildRetryable: true,
        askChildIsLoading: false,
      } : m));
    } finally {
      askChildInFlightRef.current.delete(msgId);
    }
  };

  // §6.3 모달 취소 — DB 등록 없음, 횟수 차감 없음, 상태 초기화만.
  const handleCancelDraftModal = () => {
    if (draftModal?.isSubmitting) return;
    setDraftModal(null);
  };

  // §9.2/§9.3 Red·Crisis 코칭 모달 닫기 — 네트워크 호출 없음, 등록/차감 없음.
  const handleCloseRedCoaching = () => setRedCoaching(null);

  // §7.3 "안전한 질문으로 바꾸기" — 이미 검증된 고정 규칙이므로 서버 왕복 없이 곧장
  // 초안(읽기 전용) 모달로 전환한다. 자동 등록은 아니며 부모가 다시 "질문 등록하기"를
  // 눌러야 한다.
  const handleUseSafeAlternative = () => {
    if (!redCoaching?.safeAlternative || !childId) return;
    const alt = redCoaching.safeAlternative;
    setDraftModal({
      isOpen: true,
      messageId: redCoaching.messageId,
      childId,
      originalQuestion: redCoaching.originalQuestion,
      draftQuestion: alt.parentDraftText,
      childQuestionText: alt.childQuestionText,
      weeklyUsedCount: redCoaching.weeklyUsedCount,
      weeklyLimit: redCoaching.weeklyLimit,
      dailyUsedToday: redCoaching.dailyUsedToday,
      isSubmitting: false,
      submitError: null,
      rewriteApplied: false,
      source: "PARENT_QUERY_ROUTER",
      ruleId: alt.ruleId,
      editable: false,
      idempotencyKey: `ask-child-${redCoaching.messageId}`,
      requestedTopic: redCoaching.safeAlternative?.area,
      requestedArea: redCoaching.safeAlternative?.area,
    });
    setRedCoaching(null);
  };

  // §10 다중 질문 취소 — 등록 없음.
  const handleCancelMultiSelect = () => setMultiSelect(null);

  const handleSelectMultiQuestionCandidate = (ruleId: string) => {
    if (!multiSelect || !childId) return;
    const candidate = multiSelect.candidates.find((c) => c.ruleId === ruleId);
    if (!candidate) return;
    setDraftModal({
      isOpen: true,
      messageId: multiSelect.messageId,
      childId,
      originalQuestion: multiSelect.originalQuestion,
      draftQuestion: candidate.parentDraftText,
      childQuestionText: candidate.childQuestionText,
      weeklyUsedCount: multiSelect.weeklyUsedCount,
      weeklyLimit: multiSelect.weeklyLimit,
      dailyUsedToday: multiSelect.dailyUsedToday,
      isSubmitting: false,
      submitError: null,
      rewriteApplied: false,
      source: "PARENT_QUERY_ROUTER",
      ruleId: candidate.ruleId,
      editable: false,
      idempotencyKey: `ask-child-${multiSelect.messageId}`,
      requestedTopic: candidate.area,
      requestedArea: candidate.area,
    });
    setMultiSelect(null);
  };

  // §6.4 "질문 등록하기" 클릭 시에만 서버 요청을 실행한다.
  const handleConfirmAskChild = async (finalQuestionText: string) => {
    // claude-review 재지적: draftModal.childId가 현재 활성 자녀와 다르면(모달이 열린 채
    // 자녀를 전환하려 했던 흔적) 확정하지 않는다. 위 자녀 전환 useEffect가 모달을 즉시
    // 닫으므로 정상 흐름에선 도달하지 않지만, 방어적으로 한 번 더 막는다.
    if (!draftModal || !childId || draftModal.childId !== childId) return;
    const msgId = draftModal.messageId;
    const requestChildId = draftModal.childId;
    setDraftModal((prev) => (prev ? { ...prev, isSubmitting: true, submitError: null } : prev));

    try {
      // requests/request-parent-query-router-grade4-v1.md — 라우터 GREEN 확정은 항상
      // 고정된 childQuestionText를 보낸다(모달이 읽기 전용이라 finalQuestionText와
      // 사실상 같은 값이지만, 서버가 화이트리스트 원문과의 정확한 일치를 재검증하므로
      // 명시적으로 고정값을 사용한다).
      const isRouterSourced = draftModal.source === "PARENT_QUERY_ROUTER";
      const res = await fetch("/api/parent/k-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ask_child",
          child_id: requestChildId,
          question: isRouterSourced ? draftModal.childQuestionText : finalQuestionText,
          originalQuestion: draftModal.originalQuestion,
          idempotencyKey: draftModal.idempotencyKey,
          ...(isRouterSourced ? { source: "PARENT_QUERY_ROUTER", routerRuleId: draftModal.ruleId } : {}),
        }),
      });
      const data = await res.json();
      // 응답 도착 시점에 이미 다른 자녀로 전환되어 있으면(모달은 닫혔더라도 이 fetch는
      // 계속 진행 중이었을 수 있다) 현재 화면 상태를 건드리지 않는다.
      if (childIdRef.current !== requestChildId) return;

      if (res.ok && typeof data.convertedQuestion === "string" && data.convertedQuestion.trim()) {
        setMessages(prev => prev.map(m => m.id === msgId ? {
          ...m,
          askChildStatus: "success",
          askChildErrorText: undefined,
          askChildQuestionText: data.convertedQuestion,
          askChildWeeklyUsedCount: data.weeklyUsedCount,
          askChildWeeklyLimit: data.weeklyLimit,
        } : m));
        setDraftModal(null);
        // 등록이 끝났으니 더 이상 "이어서 수정할 pending 제안"이 아니다(§9).
        setPendingAskChildProposal(null, requestChildId);
        return;
      }

      // requests/request-parent-question-safe-rewrite-modal-fix.md §9 — 부모가 모달에서
      // 수정한 문구가 다시 위험해지면, 서버가 한 번 더 안전 초안으로 정리해 돌려준다
      // (등록/차감 없음). 이 경우 오류로 끝내지 않고 모달의 초안을 새 문구로 갱신한다.
      if (res.status === 422 && data.redrafted && typeof data.draftQuestion === "string" && data.draftQuestion.trim()) {
        setDraftModal((prev) => (prev
          ? {
              ...prev,
              isSubmitting: false,
              submitError: typeof data.error === "string" ? data.error : "질문을 다시 한 번 안전하게 다듬었어요. 확인 후 다시 등록해 주세요.",
              draftQuestion: data.draftQuestion,
              rewriteApplied: true,
              weeklyUsedCount: typeof data.weeklyUsedCount === "number" ? data.weeklyUsedCount : prev.weeklyUsedCount,
              weeklyLimit: typeof data.weeklyLimit === "number" ? data.weeklyLimit : prev.weeklyLimit,
            }
          : prev));
        return;
      }

      let errorMessage = "지금은 질문을 저장할 수 없어요. 잠시 후 다시 시도해 주세요.";
      if (res.status === 400) errorMessage = "질문 내용을 확인해 주세요.";
      if (res.status === 401) errorMessage = "로그인이 만료됐어요. 다시 로그인해 주세요.";
      if (res.status === 403) errorMessage = "이 아이에게 질문을 등록할 권한이 없어요.";
      if (res.status === 409) errorMessage = "이미 아이에게 물어볼 질문으로 등록되어 있어요.";
      if (res.status === 422) errorMessage = data.error || "이 질문은 아이에게 부담을 줄 수 있어 그대로 전달할 수 없어요.";
      if (res.status === 429) errorMessage = data.error || `이번 주 질문 ${data.weeklyLimit ?? 3}회를 모두 사용했어요. 다음 주 월요일에 다시 이용할 수 있어요.`;

      // §6.4 등록 실패 시 모달을 유지하고 오류만 보여준다(닫지 않음).
      setDraftModal((prev) => (prev ? { ...prev, isSubmitting: false, submitError: errorMessage } : prev));
    } catch (err) {
      console.error("Ask child confirm error:", err);
      setDraftModal((prev) => (prev ? { ...prev, isSubmitting: false, submitError: "지금은 질문을 저장할 수 없어요. 잠시 후 다시 시도해 주세요." } : prev));
    }
  };

  const handleSkip = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "k",
        text: "알겠어요. 지금은 넘어갈게요.",
      }
    ]);
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
        <ParentHeader />
        
        <div className="bg-white px-4 py-3 border-b shadow-sm z-10 relative">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="font-bold text-gray-900">케이와 대화</h1>
              <p className="text-xs text-gray-500">
                {childName ? `${childName}의 보호자님` : "자녀를 선택해주세요"}
              </p>
            </div>
            <p className="text-[10px] text-gray-400 max-w-[140px] text-right leading-tight">
              아이와 대화를 시작하기 위한 참고 정보예요.
            </p>
          </div>
          {/* requests/request-parent-question-feature.md §8 — [대화] [Q&A] 탭 */}
          <div className="flex gap-1 mt-2.5">
            <div className="flex-1 text-center text-xs font-bold py-1.5 rounded-full bg-[var(--color-k-navy)] text-white">
              대화
            </div>
            <a
              href="/parent/questions"
              className="flex-1 text-center text-xs font-bold py-1.5 rounded-full bg-gray-100 text-gray-600"
            >
              Q&amp;A
            </a>
          </div>
        </div>

        {/* 채팅 메시지 영역 */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!childId && (
            <div className="text-center text-sm text-gray-500 mt-10">
              우측 상단 메뉴에서 자녀를 먼저 선택해주세요.
            </div>
          )}
          
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className="flex items-end gap-2 max-w-[85%]">
                {msg.role === "k" && (
                  <div className="w-8 h-8 rounded-full bg-[var(--color-k-navy)] flex items-center justify-center shrink-0 shadow-sm">
                    <span className="text-white text-xs font-bold">K</span>
                  </div>
                )}
                <div 
                  className={`p-3 rounded-2xl text-sm leading-relaxed shadow-sm relative group
                    ${msg.role === "user" 
                      ? "bg-blue-500 text-white rounded-br-sm" 
                      : "bg-white text-gray-800 rounded-bl-sm border border-gray-100"
                    }`}
                >
                  {msg.text}
                  
                  {/* TTS 버튼 (케이 메시지일 경우만) */}
                  {msg.role === "k" && (
                    <button
                      onClick={() => isSpeaking ? stopSpeaking() : speakText(msg.text)}
                      className="absolute -right-8 bottom-1 p-1.5 rounded-full bg-white shadow-sm border border-gray-100 text-gray-500 hover:text-gray-700"
                    >
                      {isSpeaking ? <Square size={14} className="fill-current" /> : <Volume2 size={14} />}
                    </button>
                  )}
                </div>
              </div>
              
              {/* 근거 없음 처리용 버튼 영역 */}
              {msg.askChildProposal && msg.role === "k" && (
                <div className="mt-2 ml-10 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAskChild(msg.originalQuestion || "", msg.id)}
                      disabled={msg.askChildIsLoading || msg.askChildStatus === "success"}
                      className="px-3 py-1.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-600 border border-blue-200 disabled:opacity-50"
                    >
                      {msg.askChildIsLoading ? "질문 만드는 중..." : "아이에게 물어보기"}
                    </button>
                    {!msg.askChildStatus && (
                      <button
                        onClick={handleSkip}
                        className="px-3 py-1.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                      >
                        지금은 넘어가기
                      </button>
                    )}
                  </div>
                  {msg.askChildStatus === "success" && (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-green-600 leading-relaxed">
                        질문을 등록했어요. 케이가 아이와 자연스럽게 대화할 수 있는 순간에 물어보고, 답변을 다시 확인한 뒤 알려드릴게요.
                        {typeof msg.askChildWeeklyUsedCount === "number" && (
                          <> (이번 주 질문 {msg.askChildWeeklyUsedCount}/{msg.askChildWeeklyLimit ?? 3})</>
                        )}
                      </p>
                      <a href="/parent/questions" className="text-xs font-semibold text-blue-600 underline w-fit">
                        Q&amp;A에서 진행 상황 보기
                      </a>
                    </div>
                  )}
                  {msg.askChildStatus === "error" && msg.askChildErrorText && (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-red-500">{msg.askChildErrorText}</p>
                      {msg.askChildRetryable && (
                        <button
                          onClick={() => handleAskChild(msg.originalQuestion || "", msg.id)}
                          className="text-xs text-blue-500 underline text-left w-fit"
                        >
                          다시 시도
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          
          {/* 생각 중 인디케이터 */}
          {isLoading && (
            <div className="flex items-start gap-2 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-[var(--color-k-navy)] flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-white text-xs font-bold">K</span>
              </div>
              <div className="p-3 rounded-2xl bg-white text-gray-500 rounded-bl-sm border border-gray-100 shadow-sm flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* 입력 영역 */}
        <div className="bg-white border-t p-3 pb-safe z-20">
          {!isSttSupported && (
            <p className="text-[10px] text-gray-400 mb-2 text-center">
              이 기기에서는 앱 내 음성 인식이 지원되지 않아요. 텍스트 입력이나 키보드의 받아쓰기 기능을 이용해 주세요.
            </p>
          )}
          {isSttSupported && sttError && (
            <p className="text-[10px] text-red-500 mb-2 text-center">{sttError}</p>
          )}
          <form onSubmit={handleSendMessage} className="flex gap-2 items-end">
            <div className="flex-1 bg-gray-100 rounded-2xl border border-transparent focus-within:border-[var(--color-k-navy)] transition-colors relative flex items-center px-3 py-1">
              <input
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isListening ? "듣는 중..." : "케이가 아는 선에서 알려드려요"}
                className="w-full bg-transparent outline-none text-sm py-2 pr-8"
                disabled={isLoading}
              />
              {/* STT 중간 결과 표시 (선택적) */}
              {isListening && interimTranscript && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none truncate max-w-[70%]">
                  {interimTranscript}
                </span>
              )}
            </div>
            
            {/* requests/request-parent-k-stt-input-focus-fix-dev-prod.md §7 — 기존 입력값이
                있어도 음성 버튼이 사라지면 "기존 텍스트 뒤에 이어붙이기" 시나리오 자체가
                UI에서 불가능해진다(실측: 텍스트가 있으면 전송 버튼만 보이던 기존 구조).
                음성 지원 기기에서는 항상 마이크 버튼을 보여주고, 입력값이 있을 때만
                전송 버튼을 옆에 추가로 보여준다. */}
            <div className="flex gap-2 shrink-0">
              {isSttSupported && (
                <button
                  type="button"
                  onClick={isListening ? stopListening : startListening}
                  disabled={isLoading || !childId}
                  aria-label={isListening ? "음성 입력 중지" : "음성으로 질문하기"}
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-white shadow-sm transition-colors disabled:opacity-50
                    ${isListening ? "bg-red-500" : "bg-[var(--color-k-navy)]"}`}
                >
                  {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
              )}
              {inputText.trim() && (
                <button
                  type="submit"
                  disabled={isLoading || !childId}
                  className="w-11 h-11 rounded-full bg-[var(--color-k-navy)] flex items-center justify-center text-white shadow-sm disabled:opacity-50"
                >
                  <Send size={18} className="ml-1" />
                </button>
              )}
            </div>
          </form>
        </div>
        
        <RealParentNav active="케이와 대화" />
      </div>
      <KChatbotWidget appSurface="parent" />
      {draftModal?.isOpen && (
        <AskChildDraftModal
          childName={childName || "아이"}
          draftQuestion={draftModal.draftQuestion}
          requestedTopic={draftModal.requestedTopic}
          requestedArea={draftModal.requestedArea}
          rewriteApplied={draftModal.rewriteApplied}
          weeklyUsedCount={draftModal.weeklyUsedCount}
          weeklyLimit={draftModal.weeklyLimit}
          isSubmitting={draftModal.isSubmitting}
          submitError={draftModal.submitError}
          onCancel={handleCancelDraftModal}
          onSubmit={handleConfirmAskChild}
          editable={draftModal.editable}
          dailyUsedToday={draftModal.source === "PARENT_QUERY_ROUTER" ? draftModal.dailyUsedToday : undefined}
        />
      )}
      {redCoaching && (
        <RedCoachingModal
          variant={redCoaching.variant}
          coachingText={redCoaching.coachingText}
          safeAlternativeText={redCoaching.safeAlternative?.parentDraftText ?? null}
          onClose={handleCloseRedCoaching}
          onUseSafeAlternative={redCoaching.safeAlternative ? handleUseSafeAlternative : null}
        />
      )}
      {multiSelect && (
        <MultiQuestionSelectModal
          questionCount={multiSelect.questionCount}
          candidates={multiSelect.candidates as MultiQuestionCandidate[]}
          onCancel={handleCancelMultiSelect}
          onSelect={handleSelectMultiQuestionCandidate}
        />
      )}
    </DemoFrame>
  );
}
