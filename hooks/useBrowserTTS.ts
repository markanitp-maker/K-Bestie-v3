import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { buildTtsChunks, type TtsChunk } from "@/lib/speech/speechNormalization";

export function useBrowserTTS() {
  const pathname = usePathname();
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const generationRef = useRef(0);
  const pauseTimerRef = useRef<number | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const stop = useCallback(() => {
    generationRef.current += 1;
    // 쉼 타이머도 함께 끊는다. 안 그러면 정지 후에도 다음 문장이 튀어나온다.
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
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
    // 항목을 join 으로 붙이면 항목 경계가 사라진다. 경계를 살린 채 쪼개고
    // 문장 사이보다 항목 사이를 더 길게 쉰다(2026-08-20 대표님 QA).
    const queue: TtsChunk[] = buildTtsChunks(content);
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
      const chunk = queue[index];
      const utterance = new SpeechSynthesisUtterance(chunk.text);
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
        // 쉼 없이 바로 다음 문장을 시작하면 쭉 이어 들린다. 부호를 지워
        // 끝 억양이 약해진 만큼 쉼이 더 중요해졌다.
        if (chunk.pauseAfterMs > 0) {
          pauseTimerRef.current = window.setTimeout(() => {
            if (generation !== generationRef.current) return;
            speakNext();
          }, chunk.pauseAfterMs);
          return;
        }
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
