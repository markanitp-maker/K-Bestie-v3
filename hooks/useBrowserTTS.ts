import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { splitTtsSentences } from "@/lib/speech/speechNormalization";

export function useBrowserTTS() {
  const pathname = usePathname();
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const generationRef = useRef(0);
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const stop = useCallback(() => {
    generationRef.current += 1;
    synthesisRef.current?.cancel();
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    const synthesis = window.speechSynthesis;
    synthesisRef.current = synthesis;
    setIsSupported(true);
    const loadVoices = () => { voicesRef.current = synthesis.getVoices(); };
    loadVoices();
    synthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      generationRef.current += 1;
      synthesis.cancel();
      synthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  useEffect(() => stop(), [pathname, stop]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [stop]);

  const speak = useCallback((content: readonly string[]) => {
    const synthesis = synthesisRef.current;
    if (!synthesis) return;
    const queue = splitTtsSentences(content.join(". "));
    stop();
    if (queue.length === 0) return;
    const generation = generationRef.current;
    const voices = voicesRef.current.length > 0 ? voicesRef.current : synthesis.getVoices();
    const voice = voices.find((candidate) => candidate.lang.toLowerCase() === "ko-kr")
      ?? voices.find((candidate) => candidate.lang.toLowerCase().startsWith("ko"))
      ?? voices.find((candidate) => /korean/i.test(candidate.name));
    let index = 0;
    const speakNext = () => {
      if (generation !== generationRef.current) return;
      if (index >= queue.length) { setIsSpeaking(false); return; }
      const utterance = new SpeechSynthesisUtterance(queue[index]);
      utterance.lang = "ko-KR";
      if (voice) utterance.voice = voice;
      // 정지 직후 다시 재생하면 이전 utterance 의 지연된 콜백이 늦게 도착한다.
      // generation 검사를 안 하면 그 콜백이 새 재생의 isSpeaking 을 덮어써
      // 버튼 표시와 실제 음성이 어긋난다(리뷰 지적, 2026-08-20).
      utterance.onstart = () => {
        if (generation !== generationRef.current) return;
        setIsSpeaking(true);
      };
      utterance.onend = () => {
        if (generation !== generationRef.current) return;
        index += 1;
        speakNext();
      };
      utterance.onerror = (event) => {
        if (event.error !== "canceled" && event.error !== "interrupted") console.error("Report speech synthesis error", event.error);
        if (generation !== generationRef.current) return;
        setIsSpeaking(false);
      };
      synthesis.speak(utterance);
    };
    speakNext();
  }, [stop]);

  return { isSupported, isSpeaking, speak, stop };
}
