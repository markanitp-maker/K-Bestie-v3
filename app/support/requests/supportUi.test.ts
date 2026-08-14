import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const list = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");
const widget = readFileSync(new URL("../../../components/KChatbotWidget.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../../admin/customer-requests/page.tsx", import.meta.url), "utf8");

test("챗봇과 알림 deep link가 내 접수 목록·상세로 연결된다", () => {
  assert.match(widget, /href="\/support\/requests"/);
  assert.match(widget, /if \(!closeModal\(\)\) event\.preventDefault\(\)/);
  assert.match(widget, /isSubmitting \|\| attachments\.some\(\(attachment\) => attachment\.status === "processing" \|\| attachment\.status === "uploading"\)/);
  assert.match(widget, /closeModalRef\.current\(\)/);
  assert.match(list, /href=\{`\/support\/requests\/\$\{item\.id\}`\}/);
  assert.match(detail, /fetch\(`\/api\/support\/\$\{encodeURIComponent\(params\.id\)\}`/);
});

test("사용자 상세는 역할별 답변 제목과 내부 메모 없는 공개 화면이다", () => {
  assert.match(detail, /케이팀에서 답장이 왔어/);
  assert.match(detail, /관리자 답변/);
  assert.doesNotMatch(detail, /admin_note|contact_email|device_info/);
});

test("관리자 drawer는 내부 메모와 사용자 공개 답변을 분리한다", () => {
  assert.match(admin, /관리자 내부 메모/);
  assert.match(admin, /사용자에게 보내는 답변/);
  assert.match(admin, /user_response: trimmedResponse \|\| null/);
  assert.match(admin, /등록된 사용자 답변은 빈 값으로 삭제할 수 없습니다/);
  assert.match(admin, /requestId/);
  assert.match(admin, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(admin, /event\.key === "Escape"/);
  assert.match(admin, /event\.key !== "Tab"/);
});
