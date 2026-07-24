"use client";
import { useCallback, useRef, useState, useEffect } from "react";

export type PipelineStage = "stt" | "llm" | "tts" | "play";

export function usePipelineConnectionQuality() {
  const [quality, setQuality] = useState(5); // 0~5, 5=최고

  const consecutiveFailuresRef = useRef(0);
  const lastNormalTurnRef = useRef<number>(Date.now());
  const recentLatenciesRef = useRef<number[]>([]);

  const calculateQuality = useCallback(() => {
    let newQuality = 5;
    
    // 1. 연속 실패 판단
    const failures = consecutiveFailuresRef.current;
    if (failures >= 3) {
      newQuality = Math.min(newQuality, 0); // 3회 이상 연속 실패 -> 0 (빨강)
    } else if (failures === 2) {
      newQuality = Math.min(newQuality, 1); // 2회 연속 실패 -> 1 (빨강)
    } else if (failures === 1) {
      newQuality = Math.min(newQuality, 3); // 1회 단일 실패 -> 3 (주황)
    }

    // 2. 지연 판단 (최근 5회 성공 건의 평균 latency)
    const latencies = recentLatenciesRef.current;
    if (latencies.length > 0) {
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      if (avgLatency > 3000) {
        newQuality = Math.min(newQuality, 2); // 3초 이상 상당히 지연 -> 2 (주황)
      } else if (avgLatency > 1500) {
        newQuality = Math.min(newQuality, 3); // 1.5초 이상 일시적 지연 -> 3 (주황)
      }
    }

    // 3. 마지막 정상 턴 이후 경과 시간 판단 (주기적으로 품질을 낮추는 용도)
    const timeSinceLastNormal = Date.now() - lastNormalTurnRef.current;
    if (timeSinceLastNormal > 90000) { 
      newQuality = Math.min(newQuality, 0); // 90초 이상 경과 -> 0 (빨강)
    } else if (timeSinceLastNormal > 60000) { 
      newQuality = Math.min(newQuality, 1); // 60초 이상 경과 -> 1 (빨강)
    } else if (timeSinceLastNormal > 30000) { 
      newQuality = Math.min(newQuality, 3); // 30초 이상 경과 -> 3 (주황)
    }

    setQuality(newQuality);
  }, []);

  const recordStageResult = useCallback((stage: PipelineStage, success: boolean, latencyMs: number) => {
    if (success) {
      consecutiveFailuresRef.current = 0; // 성공 시 연속 실패 초기화
      
      if (stage !== "play") {
        recentLatenciesRef.current.push(latencyMs);
        if (recentLatenciesRef.current.length > 5) {
          recentLatenciesRef.current.shift(); // 최근 5건 유지
        }
      }
    } else {
      consecutiveFailuresRef.current += 1;
    }
    
    calculateQuality();
  }, [calculateQuality]);

  const recordNormalTurn = useCallback(() => {
    lastNormalTurnRef.current = Date.now();
    consecutiveFailuresRef.current = 0;
    calculateQuality();
  }, [calculateQuality]);

  // 마지막 정상 턴 이후 경과 시간에 따라 주기적으로 품질 갱신
  useEffect(() => {
    const interval = setInterval(() => {
      calculateQuality();
    }, 5000); // 5초마다 확인하여 자동 강등 처리
    
    return () => clearInterval(interval);
  }, [calculateQuality]);

  return { quality, recordStageResult, recordNormalTurn };
}
