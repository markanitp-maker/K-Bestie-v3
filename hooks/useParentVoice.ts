import { useState, useEffect, useCallback, useRef } from "react";

interface UseParentVoiceReturn {
  isSttSupported: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  
  isSpeaking: boolean;
  speakText: (text: string) => void;
  stopSpeaking: () => void;
  
  sttError: string | null;
}

export function useParentVoice(): UseParentVoiceReturn {
  const [isSttSupported, setIsSttSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const speechGenerationRef = useRef(0);

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
            "not-allowed": "마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크를 허용해주세요.",
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

  const speakText = useCallback((text: string) => {
    if (!synthesisRef.current) return;

    synthesisRef.current.cancel(); // Stop any ongoing speech
    speechGenerationRef.current += 1;
    const generation = speechGenerationRef.current;

    if (!text) return;

    // 긴 답변은 문장 단위로 나눠 순차 재생한다(§12.3) — 브라우저 TTS 엔진이
    // 한 번에 너무 긴 텍스트를 받으면 중간에 끊기거나 무음이 되는 경우가 있어서.
    const sentences = text.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(Boolean);
    const queue = sentences.length > 0 ? sentences : [text];

    const voices = synthesisRef.current.getVoices();
    const koVoice = voices.find(v => v.lang === "ko-KR") || voices.find(v => v.lang.startsWith("ko"));

    let index = 0;
    const speakNext = () => {
      if (generation !== speechGenerationRef.current) return; // 취소됨 - 이어가지 않음
      if (index >= queue.length) {
        setIsSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(queue[index]);
      utterance.lang = "ko-KR";
      if (koVoice) utterance.voice = koVoice;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onerror = (e) => {
        console.error("Speech synthesis error", e);
        setIsSpeaking(false);
      };
      utterance.onend = () => {
        index += 1;
        speakNext();
      };

      synthesisRef.current!.speak(utterance);
    };

    speakNext();
  }, []);

  const stopSpeaking = useCallback(() => {
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
    sttError
  };
}
