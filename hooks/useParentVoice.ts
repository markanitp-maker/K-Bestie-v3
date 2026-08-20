import { useState, useEffect, useCallback, useRef } from "react";
import { cleanTtsText, splitTtsSentences, SENTENCE_PAUSE_MS } from "@/lib/speech/speechNormalization";

interface UseParentVoiceReturn {
  isSttSupported: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  
  isSpeaking: boolean;
  speakText: (text: string, onComplete?: () => void) => void;
  stopSpeaking: () => void;
  
  sttError: string | null;

  /**
   * 렌더 밖(콜백·타이머)에서 최신 상태를 읽기 위한 ref.
   *
   * 화면 쪽에서 `ref.current = state` 를 **렌더 중에** 대입하던 코드가 있었는데,
   * concurrent 렌더가 중단되면 커밋되지 않은 값이 노출된다(리뷰 지적, 2026-08-20).
   * 상태를 바꾸는 지점이 이 훅 안에 다 있으므로 여기서 함께 갱신해 내보낸다.
   */
  isListeningRef: React.MutableRefObject<boolean>;
  isSpeakingRef: React.MutableRefObject<boolean>;
}

export function useParentVoice(): UseParentVoiceReturn {
  const [isSttSupported, setIsSttSupported] = useState(true);
  const [isListening, setIsListeningState] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);
  
  const [isSpeaking, setIsSpeakingState] = useState(false);
  
  // 상태와 ref 를 한 지점에서 함께 바꾼다. 따로 두면 어느 한쪽을 빠뜨린다.
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const setIsListening = useCallback((value: boolean) => {
    isListeningRef.current = value;
    setIsListeningState(value);
  }, []);
  const setIsSpeaking = useCallback((value: boolean) => {
    isSpeakingRef.current = value;
    setIsSpeakingState(value);
  }, []);

  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const speechGenerationRef = useRef(0);
  const speechPauseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Check TTS
    if (typeof window !== "undefined" && window.speechSynthesis) {
      synthesisRef.current = window.speechSynthesis;
    }
    
    // Check STT
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = "ko-KR";
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;
        
        recognition.onstart = () => {
          setIsListening(true);
          setSttError(null);
        };
        
        recognition.onresult = (event: any) => {
          let interim = "";
          let final = "";
          
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          
          setInterimTranscript(interim);
          if (final) {
            setTranscript((prev) => (prev + " " + final).trim());
          }
        };
        
        recognition.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
          const messages: Record<string, string> = {
            "not-allowed": "마이크 권한을 허용해주세요.\n텍스트로도 대화할 수 있어요.",
            "no-speech": "음성이 감지되지 않았어요. 다시 말씀해주세요.",
            "audio-capture": "마이크를 찾을 수 없어요. 기기의 마이크 연결을 확인해주세요.",
            "network": "네트워크 연결을 확인해주세요.",
            "aborted": "음성 인식이 중단됐어요.",
          };
          setSttError(messages[event.error] || "음성 인식 중 문제가 생겼어요. 텍스트로 입력해주세요.");
          setIsListening(false);
        };
        
        recognition.onend = () => {
          setIsListening(false);
          setInterimTranscript("");
        };
        
        recognitionRef.current = recognition;
      } else {
        setIsSttSupported(false);
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (synthesisRef.current) {
        synthesisRef.current.cancel();
      }
    };
  }, []);

  // 앱이 백그라운드로 전환되면 진행 중인 STT/TTS를 정리한다(포그라운드 복귀 후
  // 낡은 인식 세션·음성 재생이 이어지지 않도록).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        recognitionRef.current?.abort();
        speechGenerationRef.current += 1;
        synthesisRef.current?.cancel();
        setIsListening(false);
        setIsSpeaking(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    
    // Stop speaking if listening starts
    stopSpeaking();
    
    setTranscript("");
    setInterimTranscript("");
    setSttError(null);
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.error("Failed to start listening", e);
      setSttError("음성 인식을 시작할 수 없어요. 텍스트로 입력해주세요.");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (e) {
      console.error("Failed to stop listening", e);
    }
  }, []);

  const speakText = useCallback((text: string, onComplete?: () => void) => {
    if (!synthesisRef.current) {
      onComplete?.();
      return;
    }

    synthesisRef.current.cancel(); // Stop any ongoing speech
    speechGenerationRef.current += 1;
    const generation = speechGenerationRef.current;

    const cleanText = cleanTtsText(text);
    if (!cleanText) {
      onComplete?.();
      return;
    }

    // 긴 답변은 문장 단위로 나눠 순차 재생한다(§12.3) — 브라우저 TTS 엔진이
    // 한 번에 너무 긴 텍스트를 받으면 중간에 끊기거나 무음이 되는 경우가 있어서.
    const queue = splitTtsSentences(cleanText);

    const voices = synthesisRef.current.getVoices();
    const koVoice = voices.find(v => v.lang === "ko-KR") || voices.find(v => v.lang.startsWith("ko"));

    let index = 0;
    const speakNext = () => {
      if (generation !== speechGenerationRef.current) return; // 취소됨 - 이어가지 않음
      if (index >= queue.length) {
        setIsSpeaking(false);
        onComplete?.();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(queue[index]);
      utterance.lang = "ko-KR";
      if (koVoice) utterance.voice = koVoice;

      // 정지 직후 다시 재생하면 이전 utterance 의 지연된 콜백이 늦게 도착한다.
      // generation 검사를 안 하면 그 콜백이 새 재생의 isSpeaking 을 덮어써
      // 버튼 표시와 실제 음성이 어긋난다(리뷰 지적, 2026-08-20).
      utterance.onstart = () => {
        if (generation !== speechGenerationRef.current) return;
        setIsSpeaking(true);
      };
      utterance.onerror = (e) => {
        console.error("Speech synthesis error", e);
        if (generation !== speechGenerationRef.current) return;
        setIsSpeaking(false);
        onComplete?.();
      };
      utterance.onend = () => {
        if (generation !== speechGenerationRef.current) return;
        index += 1;
        // 쉼 없이 바로 다음 문장을 시작하면 쭉 이어 들린다(2026-08-20 대표님 QA).
        // 부호를 지워 끝 억양이 약해진 만큼 쉼이 더 중요해졌다.
        speechPauseTimerRef.current = window.setTimeout(() => {
          if (generation !== speechGenerationRef.current) return;
          speakNext();
        }, SENTENCE_PAUSE_MS);
      };

      synthesisRef.current!.speak(utterance);
    };

    speakNext();
  }, []);

  const stopSpeaking = useCallback(() => {
    if (speechPauseTimerRef.current !== null) {
      // 쉼 타이머도 끊는다. 안 그러면 정지 후에도 다음 문장이 튀어나온다.
      window.clearTimeout(speechPauseTimerRef.current);
      speechPauseTimerRef.current = null;
    }
    if (synthesisRef.current) {
      speechGenerationRef.current += 1;
      synthesisRef.current.cancel();
      setIsSpeaking(false);
    }
  }, []);

  // Handle voices loaded late
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const handleVoicesChanged = () => {
        // Just forces getVoices to populate
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
      return () => {
        window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      };
    }
  }, []);

  return {
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
    isListeningRef,
    isSpeakingRef,
  };
}
