"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useVoiceChat } from "@/hooks/useVoiceChat";

function MissionsDemoContent() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "manual" ? "manual" : "auto";
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [closingUrl, setClosingUrl] = useState("");
  const [completed, setCompleted] = useState(false);
  const [kText, setKText] = useState("");
  const [childText, setChildText] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);

  const sttTts = useVoiceChat({
    onTurnComplete: (turn) => {
      if (turn.role === "child") {
        setChildText(turn.text);
        handleAnswer(turn.text);
      }
    }
  });

  useEffect(() => {
    const init = async () => {
      const meRes = await fetch("/api/child/me");
      if (!meRes.ok) return;
      const me = await meRes.json();
      const childId = me.id;
      if (childId) {
        const res = await fetch("/api/mission-demo/start", {
          method: "POST",
          body: JSON.stringify({ childId })
        });
        const json = await res.json();
        setSessionId(json.sessionId);
        setQuestions(json.questions);
        setClosingUrl(json.closingAudioUrl);
        setCurrentStep(json.currentStep || 1);
        setIsReady(true);
      }
    };
    init();
  }, []);

  const handleAnswer = async (text: string) => {
    if (!sessionId) return;
    const res = await fetch("/api/mission-demo/answer", {
      method: "POST",
      body: JSON.stringify({ sessionId, step: currentStep, answerText: text })
    });
    const json = await res.json();
    if (json.valid) {
      if (json.completed) {
        setCompleted(true);
        setKText("오늘 미션 끝났어. 이야기해 줘서 고마워. 잘 자!");
        await sttTts.playDemoAudio(closingUrl, "오늘 미션 끝났어. 이야기해 줘서 고마워. 잘 자!");
      } else {
        setCurrentStep(json.nextStep);
      }
    } else {
      // 무효일 경우 다시 시도
      setKText("잘 못 들었어. 다시 말해줄래?");
      setTimeout(() => {
        if (mode === "auto") {
          sttTts.setInputMode("auto");
          sttTts.setMicEnabled(true);
        }
      }, 1000);
    }
  };

  const playCurrentQuestion = async (step: number) => {
    if (completed || !questions.length) return;
    const q = questions[step - 1];
    if (q) {
      setKText(q.question_text);
      setChildText("");
      setAudioFailed(false);
      sttTts.setMicEnabled(false);
      
      let played = await sttTts.playDemoAudio(q.audioUrl, q.question_text);
      if (!played) {
        await new Promise(r => setTimeout(r, 1000));
        played = await sttTts.playDemoAudio(q.audioUrl, q.question_text);
      }
      
      if (!played) {
        setKText("케이 목소리를 불러오지 못했어요");
        setAudioFailed(true);
        sttTts.setMicEnabled(false);
        return;
      }
      
      if (mode === "auto") {
        sttTts.setInputMode("auto");
        sttTts.setMicEnabled(true);
      } else {
        sttTts.setInputMode("manual");
        sttTts.setMicEnabled(false);
      }
    }
  };

  useEffect(() => {
    if (isReady && !completed && sttTts.status === "live") {
      playCurrentQuestion(currentStep);
    }
  }, [isReady, currentStep, completed, sttTts.status]);

  const startDemo = async () => {
    await sttTts.startSession();
  };

  if (!isReady) return <div className="p-8">준비 중...</div>;

  return (
    <div className="flex flex-col items-center p-8 space-y-4">
      <h1 className="text-xl font-bold">미션 데모 모드 (Step: {Math.min(currentStep, 10)}/10)</h1>
      
      {sttTts.status !== "live" && (
        <button onClick={startDemo} className="px-4 py-2 bg-blue-500 text-white rounded">
          데모 시작
        </button>
      )}

      {sttTts.status === "live" && !completed && mode === "manual" && (
        <div className="flex gap-2">
          <button 
            onClick={() => sttTts.setMicEnabled(true)} 
            disabled={audioFailed}
            className={`px-4 py-2 ${audioFailed ? "bg-gray-400 cursor-not-allowed" : "bg-green-500"} text-white rounded`}
          >
            마이크 켜기 (녹음 시작)
          </button>
          <button 
            onClick={() => sttTts.manualFinalize()} 
            disabled={audioFailed}
            className={`px-4 py-2 ${audioFailed ? "bg-gray-400 cursor-not-allowed" : "bg-red-500"} text-white rounded`}
          >
            마이크 끄기 (전송)
          </button>
        </div>
      )}

      <div className="w-full max-w-md p-4 bg-gray-100 rounded">
        <p className="font-bold text-blue-600">케이: {kText}</p>
        <p className="mt-2 text-gray-800">나: {sttTts.interimChildText || childText}</p>
      </div>

      {completed && <div className="text-2xl font-bold text-green-500">🎉 미션 완료! 🎉</div>}
    </div>
  );
}

export default function MissionDemoPage() {
  return (
    <Suspense fallback={<div>로딩중...</div>}>
      <MissionsDemoContent />
    </Suspense>
  );
}
