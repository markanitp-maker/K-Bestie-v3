"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 모바일(특히 Android)에서 미션/프리챗 음성 대화 도중 화면이 자동으로 꺼지는 문제 방지용
// 공용 훅 — Screen Wake Lock API만 사용한다(무음 루프 video 재생, 합성 터치 이벤트 등의
// 우회책은 쓰지 않는다). 호출부가 넘기는 `active`가 "지금 미션/프리챗 대화가 진짜로
// 활성 상태인지"의 유일한 진실 소스이며, 이 훅은 그 값을 그대로 따라갈 뿐 스스로 세션
// 상태를 판단하지 않는다 — active가 false가 되는 모든 경로(대화 종료, 미션 완료, 홈 이동,
// 언마운트, 로그아웃으로 인한 페이지 이탈 등)에서 반드시 반납된다.
//
// 절대 하드 디펜던시가 아니다 — 미지원 브라우저·거부(NotAllowedError)·저전력 모드 등 어떤
// 이유로 실패해도 대화 자체는 wake lock 없이 완전히 정상 동작해야 한다(그래서 실패를 밖으로
// throw하지 않고 항상 조용히 삼킨다).
export function useScreenWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  // acquire()가 진행 중(await request() 대기)인 동안 또 다른 acquire() 호출(예: active 변경
  // 이펙트와 visibilitychange가 거의 동시에 발생)이 겹쳐 요청이 중복되는 것을 막는다.
  const requestInFlightRef = useRef(false);
  
  const failCountRef = useRef(0);
  const [warning, setWarning] = useState(false);
  const warningShownRef = useRef(false);

  const showWarningOnce = useCallback(() => {
    if (warningShownRef.current) return;
    warningShownRef.current = true;
    setWarning(true);
    // 아이에게 방해되지 않도록 5초 후 자연스럽게 숨김
    setTimeout(() => setWarning(false), 5000);
  }, []);

  const release = useCallback(() => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (!sentinel) return;
    console.error("[WAKE-LOCK-DEBUG] release", { hadSentinel: true });
    sentinel.release().catch(() => {});
  }, []);

  const acquire = useCallback(async () => {
    if (sentinelRef.current) return; // 이미 보유 중 — 중복 요청 방지
    if (requestInFlightRef.current) return; // 동시 요청 방지
    
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      console.error("[WAKE-LOCK-DEBUG] acquire:unsupported", { 
        isHttps,
        userAgent: typeof window !== "undefined" && window.navigator ? window.navigator.userAgent : "unknown" 
      });
      showWarningOnce();
      return;
    }
    
    requestInFlightRef.current = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      requestInFlightRef.current = false;
      failCountRef.current = 0; // 성공 시 실패 카운트 초기화
      
      // request()가 진행되는 사이 세션이 이미 비활성화됐으면(경합) 즉시 반납하고 참조를
      // 남기지 않는다.
      if (!activeRef.current) {
        console.error("[WAKE-LOCK-DEBUG] acquire:resolved-but-inactive-now-releasing", {});
        sentinel.release().catch(() => {});
        return;
      }
      sentinelRef.current = sentinel;
      console.error("[WAKE-LOCK-DEBUG] acquire:success", {});
      sentinel.addEventListener("release", () => {
        // OS/브라우저가 스스로 반납한 경우(백그라운드 전환 등) — 우리 쪽 참조도 비워서
        // visibilitychange 핸들러가 복귀 시 다시 요청할 수 있게 한다.
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
          console.error("[WAKE-LOCK-DEBUG] sentinel:release-event", {});
        }
      });
    } catch (err) {
      requestInFlightRef.current = false;
      const error = err as Error;
      
      console.error("[WAKE-LOCK-DEBUG] acquire:failed", { 
        name: error?.name,
        message: error?.message,
        isHttps 
      });
      
      failCountRef.current += 1;
      // NotAllowedError(정책 차단/권한 부족 등)이거나 연속 2회 이상 실패 시 경고
      if (failCountRef.current >= 2 || error?.name === 'NotAllowedError') {
        showWarningOnce();
      }
      
      // 여기서 재시도 루프를 돌리지 않는다 — 다음 정상 트리거(active 변화 또는
      // visibilitychange로 인한 재진입)에서만 다시 시도한다.
    }
  }, [showWarningOnce]);

  // active 값이 바뀔 때만 반응 — true가 되면 획득 시도, false가 되면 즉시 반납.
  useEffect(() => {
    if (active) {
      void acquire();
    } else {
      release();
    }
  }, [active, acquire, release]);

  // 화면 잠금 해제/포그라운드 복귀 시 재획득 시도. hidden 전환 자체는 OS가 sentinel을
  // 스스로 release하고 위 addEventListener("release")가 참조를 정리해주므로 여기서 따로
  // release()를 부를 필요는 없다(중복 반납 호출 방지).
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && activeRef.current) {
        console.error("[WAKE-LOCK-DEBUG] visibility:visible-reacquire-attempt", {});
        void acquire();
      }
    }
    
    function handleFocus() {
      if (activeRef.current) {
        console.error("[WAKE-LOCK-DEBUG] focus:reacquire-attempt", {});
        void acquire();
      }
    }
    
    function handlePageShow(e: PageTransitionEvent) {
      if (activeRef.current) {
        console.error("[WAKE-LOCK-DEBUG] pageshow:reacquire-attempt", { persisted: e.persisted });
        void acquire();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [acquire]);

  // 언마운트 시 반드시 반납 — 라우팅으로 컴포넌트가 사라지는 모든 경우(홈 이동, 로그아웃으로
  // 인한 페이지 전환 포함)를 여기서 한 번에 커버한다.
  useEffect(() => {
    return () => {
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  return warning;
}
