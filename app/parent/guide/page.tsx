"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import KChatbotWidget from "@/components/KChatbotWidget";
import { useParentVoice } from "@/hooks/useParentVoice";
import { useStore } from "@/hooks/useStore";
import { Mic, MicOff, Send, Volume2, Square } from "lucide-react";

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
};

export default function ParentGuidePage() {
  // ParentHeader의 setStore() 호출이 같은 탭에서도 STORE_EVENT로 즉시 전파되므로,
  // localStorage 폴링 대신 이 값을 구독해야 자녀 전환이 실시간으로 반영된다
  // (codex 025p2 정적리뷰: localStorage만 봐서는 같은 탭 전환이 감지되지 않아
  //  이전 자녀의 대화·응답이 전환 후에도 화면에 남는 문제가 있었음).
  const { activeChildId } = useStore();
  const [childName, setChildName] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
        body: JSON.stringify({ action: "chat", child_id: requestChildId, question: textToSend }),
      });

      const data = await res.json();
      // 응답 도착 시점에 이미 다른 자녀로 전환됐다면 이 응답을 현재 화면에 반영하지 않는다.
      if (childIdRef.current !== requestChildId) return;

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "k",
          text: data.answer || "응답을 가져올 수 없어요.",
          askChildProposal: data.answerable === false ? data.askChildProposal : null,
          originalQuestion: textToSend, // 아이에게 물어보기를 위해 원본 저장
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

  // 최종 음성 인식 결과는 입력창에 머물게 하지 않고 즉시 채팅으로 전송한다.
  // 동일한 final 이벤트가 브라우저에서 반복 전달되어도 한 번만 전송한다.
  useEffect(() => {
    const finalText = transcript.replace(/\s+/g, " ").trim();
    if (!finalText) {
      lastVoiceTranscriptRef.current = "";
      return;
    }
    // 모바일 브라우저는 한 번의 발화를 여러 final 조각으로 나눠 전달할 수 있다.
    // 인식이 완전히 끝난 뒤 누적된 문장 전체를 한 번만 전송한다.
    if (isListening) return;
    if (finalText === lastVoiceTranscriptRef.current) return;

    lastVoiceTranscriptRef.current = finalText;
    setInputText("");
    void sendMessage(finalText);
  }, [transcript, isListening, sendMessage]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    void sendMessage(inputText);
  };

  const handleAskChild = async (originalQuestion: string, msgId: string) => {
    if (!childId) return;
    if (askChildInFlightRef.current.has(msgId)) return;
    askChildInFlightRef.current.add(msgId);
    const requestChildId = childId;
    
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, askChildIsLoading: true, askChildErrorText: undefined } : m));

    try {
      const res = await fetch("/api/parent/k-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask_child", child_id: requestChildId, question: originalQuestion }),
      });
      const data = await res.json();
      if (childIdRef.current !== requestChildId) return;

      if (res.ok && typeof data.convertedQuestion === "string" && data.convertedQuestion.trim()) {
        setMessages(prev => prev.map(m => m.id === msgId ? { 
          ...m, 
          askChildStatus: "success", 
          askChildErrorText: undefined,
          askChildIsLoading: false,
          askChildQuestionText: data.convertedQuestion,
        } : m));
      } else {
        // 명세 §7.2: 재시도 버튼은 500(서버·DB·외부 LLM 장애)일 때만 제공한다.
        let errorMessage = "지금은 질문을 저장할 수 없어요. 잠시 후 다시 시도해 주세요.";
        let retryable = true;
        if (res.status === 400) { errorMessage = "질문 내용을 확인해 주세요."; retryable = false; }
        if (res.status === 401) { errorMessage = "로그인이 만료됐어요. 다시 로그인해 주세요."; retryable = false; }
        if (res.status === 403) { errorMessage = "이 아이에게 질문을 등록할 권한이 없어요."; retryable = false; }
        if (res.status === 409) { errorMessage = "이미 아이에게 물어볼 질문으로 등록되어 있어요."; retryable = false; }
        if (res.status === 422) { errorMessage = "이 질문은 아이에게 그대로 묻기 어려워요. 아이를 추궁하지 않는 다른 질문으로 물어봐 주세요."; retryable = false; }
        if (res.status === 429) { errorMessage = "질문 등록이 너무 빠르게 반복됐어요. 잠시 후 다시 시도해 주세요."; retryable = false; }

        setMessages(prev => prev.map(m => m.id === msgId ? {
          ...m,
          askChildStatus: "error",
          askChildErrorText: errorMessage,
          askChildRetryable: retryable,
          askChildIsLoading: false
        } : m));
      }
    } catch (err) {
      console.error("Ask child error:", err);
      if (childIdRef.current !== requestChildId) return;
      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        askChildStatus: "error",
        askChildErrorText: "지금은 질문을 저장할 수 없어요. 잠시 후 다시 시도해 주세요.",
        askChildRetryable: true,
        askChildIsLoading: false
      } : m));
    } finally {
      askChildInFlightRef.current.delete(msgId);
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
        
        <div className="bg-white px-4 py-3 border-b flex justify-between items-center shadow-sm z-10 relative">
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
                      {msg.askChildIsLoading ? "저장 중..." : "아이에게 물어보기"}
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
                    <p className="text-xs text-green-600 leading-relaxed">
                      아이에게 물어볼 질문으로 등록했어요. “{msg.askChildQuestionText}” 다음 적절한 대화에서 케이가 자연스럽게 물어볼게요.
                    </p>
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
            
            {/* 음성/전송 버튼 */}
            {inputText.trim() ? (
              <button
                type="submit"
                disabled={isLoading || !childId}
                className="w-11 h-11 rounded-full bg-[var(--color-k-navy)] flex items-center justify-center text-white shrink-0 shadow-sm disabled:opacity-50"
              >
                <Send size={18} className="ml-1" />
              </button>
            ) : (
              <button
                type="button"
                onClick={isListening ? stopListening : startListening}
                disabled={!isSttSupported || isLoading || !childId}
                aria-label={isListening ? "음성 입력 중지" : "음성으로 질문하기"}
                className={`w-11 h-11 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm transition-colors
                  ${!isSttSupported ? "bg-gray-300" : isListening ? "bg-red-500" : "bg-[var(--color-k-navy)]"}`}
              >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            )}
          </form>
        </div>
        
        <RealParentNav active="케이와 대화" />
      </div>
      <KChatbotWidget appSurface="parent" />
    </DemoFrame>
  );
}
