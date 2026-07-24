"use client";

import { useEffect, useState } from "react";
import {
  MbtiReadyPayload,
  MbtiInitPayload,
  MbtiErrorPayload,
  PlayBugReportPayload,
  MbtiCompletedPayload,
  MbtiCloseRequestPayload,
  isMbtiInitCandidate,
} from "@/lib/play/protocol";

export default function MockMbtiPage() {
  const [initData, setInitData] = useState<MbtiInitPayload | null>(null);
  
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Allow from same origin for testing
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      
      const data = event.data;
      if (data && data.eventType === "MBTI_INIT" && isMbtiInitCandidate(data)) {
        setInitData(data);
        
        // send MBTI_INIT_ACK (optional but good practice)
        window.parent.postMessage({
          playType: "mbti",
          eventType: "MBTI_INIT_ACK",
          occurredAt: new Date().toISOString(),
          playSessionId: data.playSessionId
        }, window.location.origin);
      }
    };
    
    window.addEventListener("message", handleMessage);
    
    // Send MBTI_READY
    const readyPayload: MbtiReadyPayload = {
      playType: "mbti",
      eventType: "MBTI_READY",
      occurredAt: new Date().toISOString()
    };
    window.parent.postMessage(readyPayload, window.location.origin);
    
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const sendError = (stage: "init" | "in_progress") => {
    if (!initData) return;
    const errorPayload: MbtiErrorPayload = {
      playType: "mbti",
      eventType: "MBTI_ERROR",
      occurredAt: new Date().toISOString(),
      playSessionId: initData.playSessionId,
      childId: initData.childId,
      stage,
      errorCode: stage === "init" ? "INIT_FAIL" : "RUNTIME_ERR",
      errorMessage: stage === "init" ? "초기화에 실패했습니다." : "진행 중 오류가 발생했습니다.",
      networkStatus: "online",
      dbStatus: "ok",
      browserOS: "Chrome/Mock"
    };
    window.parent.postMessage(errorPayload, window.location.origin);
  };
  
  const sendBugReport = () => {
    if (!initData) return;
    const bugPayload: PlayBugReportPayload = {
      playType: "mbti",
      eventType: "PLAY_BUG_REPORT",
      occurredAt: new Date().toISOString(),
      sessionId: initData.playSessionId, // Note: sessionId
      childId: initData.childId,
      stage: "in_progress",
      questionNumber: 3,
      errorMessage: "사용자가 버그를 신고했습니다.",
      networkStatus: "online",
      dbStatus: "ok",
      browserOS: "Chrome/Mock"
    };
    window.parent.postMessage(bugPayload, window.location.origin);
  };

  const sendCompleted = () => {
    if (!initData) return;
    const completedPayload: MbtiCompletedPayload = {
      playType: "mbti",
      eventType: "MBTI_COMPLETED",
      occurredAt: new Date().toISOString(),
      playSessionId: initData.playSessionId,
      resultType: "INFP"
    };
    window.parent.postMessage(completedPayload, window.location.origin);
  };

  const sendClose = () => {
    if (!initData) return;
    const closePayload: MbtiCloseRequestPayload = {
      playType: "mbti",
      eventType: "MBTI_CLOSE_REQUEST",
      occurredAt: new Date().toISOString(),
      playSessionId: initData.playSessionId
    };
    window.parent.postMessage(closePayload, window.location.origin);
  };

  return (
    <div className="min-h-screen bg-green-50 p-8 flex flex-col items-center">
      <h1 className="text-2xl font-bold text-green-800 mb-6">Mock MBTI App</h1>
      
      {!initData ? (
        <div className="bg-white p-6 rounded-xl shadow text-gray-500 animate-pulse">
          Waiting for MBTI_INIT from parent...
        </div>
      ) : (
        <div className="w-full max-w-md flex flex-col gap-4">
          <div className="bg-white p-4 rounded-xl shadow mb-4 text-sm break-all text-gray-700">
            <strong>Init Payload Received:</strong>
            <pre className="mt-2 text-xs bg-gray-50 p-2 rounded">{JSON.stringify(initData, null, 2)}</pre>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => sendError("init")}
              className="bg-red-100 text-red-700 p-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              init 실패(환불)
            </button>
            <button 
              onClick={() => sendError("in_progress")}
              className="bg-orange-100 text-orange-700 p-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              진행중 오류
            </button>
            <button 
              onClick={sendBugReport}
              className="bg-purple-100 text-purple-700 p-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              버그신고
            </button>
            <button 
              onClick={sendCompleted}
              className="bg-blue-100 text-blue-700 p-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              완료
            </button>
            <button 
              onClick={sendClose}
              className="col-span-2 bg-gray-200 text-gray-700 p-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
