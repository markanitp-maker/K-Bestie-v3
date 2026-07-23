"use client";

// 실측 연결 품질 표시 — 가짜 신호 막대가 아니라 useGeminiLive가 실제로 계측한 값(0~5)을
// 그대로 그린다: WebSocket 상태, 최근 재연결 횟수, 최근 watchdog(10초 무응답) 발동 횟수,
// 최근 응답 지연시간 평균. 품질이 낮을 때만 짧은 보조 문구를 함께 보여준다.
export function ConnectionQualityIndicator({
  quality,
  live,
}: {
  quality: number;
  live: boolean;
}) {
  if (!live) return null;

  const level = Math.max(0, Math.min(5, Math.round(quality)));
  const color = level >= 4 ? "#16a34a" : level >= 2 ? "#d97706" : "#dc2626";
  const label = level >= 4 ? "연결 원활" : level >= 2 ? "연결 다소 불안정" : "연결 불안정";

  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 14px 6px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 12 }} aria-label={label} title={label}>
        {[1, 2, 3, 4, 5].map((bar) => (
          <div
            key={bar}
            style={{
              width: 3,
              height: 3 + bar * 2,
              borderRadius: 1,
              background: bar <= level ? color : "#e5e7eb",
            }}
          />
        ))}
      </div>
      {level <= 2 && (
        <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
      )}
    </div>
  );
}
