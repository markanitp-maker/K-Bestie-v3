import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("자유대화 하단 입력 wrapper는 mode === 'text'일 때 미션과 동일한 clamp(18px,2.5dvh,24px) padding을 적용한다", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "app/chat/page.tsx"), "utf8");
  const missionSource = readFileSync(resolve(process.cwd(), "components/MissionConversationLayout.tsx"), "utf8");

  assert.match(
    pageSource,
    /paddingBottom:\s*mode === "text"\s*\?\s*\(\s*isKeyboardOpen\s*\?\s*"clamp\(18px, 2\.5dvh, 24px\)"/,
    "자유대화 하단 입력 wrapper는 mode === 'text' 및 isKeyboardOpen 조건에 따라 세이프 에어리어를 보정해야 한다"
  );

  assert.match(
    missionSource,
    /pb-\[calc\(clamp\(18px,2\.5dvh,24px\)\+env\(safe-area-inset-bottom\)\)\]/,
    "미션 정상 화면 하단 입력 wrapper는 clamp(18px,2.5dvh,24px) padding을 적용한다"
  );
});
