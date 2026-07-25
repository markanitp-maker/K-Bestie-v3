import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// 훅 밖의 안정된 컴포넌트로 분리 — 훅 안에 정의하면 부모가 리렌더링될 때마다(말풍선/진행률
// 갱신 등, 대화 중엔 매우 빈번함) 새 함수 참조가 되어 시트가 열려 있어도 매번 언마운트·
// 재마운트되며 슬라이드업 애니메이션이 반복 재생/깜빡이는 문제가 있었다(codex 지적).
function ExitConfirmSheet({
  isOpen,
  onGoToModes,
  onGoToHome,
  onContinue,
}: {
  isOpen: boolean;
  onGoToModes: () => void;
  onGoToHome: () => void;
  onContinue: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end",
      justifyContent: "center", zIndex: 9999, padding: "0 16px 16px"
    }}>
      <div style={{
        background: "#fff", width: "100%", maxWidth: 560, borderRadius: 24,
        padding: 24, display: "flex", flexDirection: "column", gap: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        animation: "slideUp 0.3s ease-out forwards"
      }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 18, fontWeight: 700, color: "var(--color-k-text-primary)", textAlign: "center" }}>
          테스트를 종료할까요?
        </h3>
        <p style={{ margin: "0 0 16px 0", fontSize: 14, color: "#6b7280", textAlign: "center" }}>
          진행 상황은 그대로 저장됩니다.
        </p>
        <button
          onClick={onGoToModes}
          style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#f3f4f6", color: "var(--color-k-text-primary)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          대화 방식 선택으로
        </button>
        <button
          onClick={onGoToHome}
          style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "#f3f4f6", color: "var(--color-k-text-primary)", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          아이 홈으로
        </button>
        <button
          onClick={onContinue}
          style={{ width: "100%", padding: 16, borderRadius: 16, border: "none", background: "var(--color-k-navy)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 8 }}
        >
          계속 테스트하기
        </button>
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function useTestSessionExit(onCleanup: () => void) {
  const router = useRouter();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const cleanupCalledRef = useRef(false);

  const safeCleanup = useCallback(() => {
    if (!cleanupCalledRef.current) {
      cleanupCalledRef.current = true;
      try {
        onCleanup();
      } catch (e) {
        console.error("Cleanup error:", e);
      }
    }
  }, [onCleanup]);

  // 뒤로가기(popstate)는 이미 발생한 히스토리 이동을 취소할 수 없다 — 대신 시트가 열리는
  // "순간"에 곧바로 더미 state를 다시 쌓아서, 시트가 떠 있는 동안 뒤로가기를 한 번 더 눌러도
  // 실제 페이지 이탈 없이 popstate가 다시 발생해 시트가 유지되게 한다(codex 지적 — 이전엔
  // "계속 테스트하기"를 눌러야만 방어가 복원되어, 시트가 열린 채로 뒤로가기를 두 번째 누르면
  // cleanup 없이 실제로 페이지를 이탈할 수 있었다).
  const requestExit = useCallback(() => {
    setIsSheetOpen(true);
    window.history.pushState(null, "", window.location.href);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      requestExit();
    };

    // 마운트 시 더미 state를 하나 쌓아 최초 뒤로가기를 가로챈다.
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [requestExit]);

  const handleContinue = useCallback(() => {
    setIsSheetOpen(false);
  }, []);

  const handleGoToModes = useCallback(() => {
    safeCleanup();
    router.replace("/child/test-modes");
  }, [safeCleanup, router]);

  const handleGoToHome = useCallback(() => {
    safeCleanup();
    router.replace("/child/home");
  }, [safeCleanup, router]);

  const ExitSheet = useCallback(
    () => (
      <ExitConfirmSheet
        isOpen={isSheetOpen}
        onGoToModes={handleGoToModes}
        onGoToHome={handleGoToHome}
        onContinue={handleContinue}
      />
    ),
    [isSheetOpen, handleGoToModes, handleGoToHome, handleContinue]
  );

  return { requestExit, ExitSheet, safeCleanup };
}
