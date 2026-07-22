"use client";

// 하위호환 라우트 — 실제 E안 실행은 /child/missions(테스트 계정 + E override 감지 시)에서 이뤄진다.
// 이 경로는 동일 러너 컴포넌트를 그대로 렌더한다.
import { TestModeERunner } from "@/components/TestModeERunner";

export default function TestModeRunRoute() {
  return <TestModeERunner />;
}
