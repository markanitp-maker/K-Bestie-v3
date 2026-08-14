import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingSupportInquiryModal from "./LandingSupportInquiryModal";

test("LandingSupportInquiryModal이 닫혀있을 때 아무것도 렌더링하지 않는다", () => {
  const html = renderToStaticMarkup(
    <LandingSupportInquiryModal isOpen={false} onClose={() => {}} />
  );
  assert.equal(html, "");
});

test("LandingSupportInquiryModal이 열려있을 때 027 한국어 정규 문구 및 필수 속성을 렌더링한다", () => {
  const html = renderToStaticMarkup(
    <LandingSupportInquiryModal isOpen={true} onClose={() => {}} />
  );

  // 접근성 및 제목 확인
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="landing-support-modal-title"/);
  assert.match(html, /문의하기/);

  // 안내 문구 (정규 2줄) 확인
  assert.match(html, /내친구 케이 이용에 궁금한 점이 있으시면 남겨주세요\./);
  assert.match(html, /확인 후 입력하신 이메일로 안내드리겠습니다\./);

  // 이메일 필드 (라벨 및 플레이스홀더)
  assert.match(html, /id="landing-inquiry-email"/);
  assert.match(html, /type="email"/);
  assert.match(html, />이메일\s*<span/);
  assert.match(html, /placeholder="답변받을 이메일을 입력해 주세요\."/);

  // 문의 내용 필드 (라벨 및 플레이스홀더)
  assert.match(html, /id="landing-inquiry-content"/);
  assert.match(html, /문의 내용/);
  assert.match(html, /placeholder="궁금한 내용을 입력해 주세요\."/);

  // 글자 수 카운터 및 버튼 문구 (정규 '제출하기')
  assert.match(html, /0 \/ 2000자/);
  assert.match(html, />제출하기</);
  assert.match(html, />취소</);
  assert.match(html, /aria-label="닫기"/);
});

test("모달 닫기 시 성공 여부와 무관하게 모든 폼 상태(email, content, error, success)와 멱등키가 초기화되도록 계약을 검증한다", async () => {
  const source = await readFile(
    new URL("./LandingSupportInquiryModal.tsx", import.meta.url),
    "utf8"
  );

  // resetAllFormState 함수가 모든 상태(email, content, errorMessage, successRequestNumber) 및 멱등키를 초기화하는지 검증
  assert.ok(source.includes('const resetAllFormState = useCallback(() => {'), "resetAllFormState 함수 정의가 존재해야 함");
  assert.ok(source.includes('setEmail("");'), "이메일 초기화 코드가 있어야 함");
  assert.ok(source.includes('setContent("");'), "내용 초기화 코드가 있어야 함");
  assert.ok(source.includes('setErrorMessage(null);'), "오류 메시지 초기화 코드가 있어야 함");
  assert.ok(source.includes('setSuccessRequestNumber(null);'), "접수번호 초기화 코드가 있어야 함");
  assert.ok(source.includes('idempotencyKeyRef.current = generateUUID();'), "멱등키 재발급 코드가 있어야 함");

  // handleClose가 successRequestNumber 여부와 무관하게(조건문 없이) resetAllFormState를 즉시 호출하는지 검증
  assert.ok(
    source.includes(
      'const handleClose = useCallback(() => {\n    if (isSubmitting) return;\n    resetAllFormState();\n    onClose();\n  }, [isSubmitting, resetAllFormState, onClose]);'
    ),
    "handleClose는 isSubmitting 가드 후 성공 여부와 무관하게 resetAllFormState()를 호출해야 함"
  );

  // 외부에서 isOpen이 false로 전환되거나 닫힌 상태에서 새로 열릴 때 초기화 및 신규 멱등키 발급 보장
  assert.ok(
    source.includes('else if (!isOpen && prevIsOpenRef.current) {\n      resetAllFormState();\n    }'),
    "외부 prop에 의해 isOpen이 false로 변경될 때도 resetAllFormState()가 호출되어야 함"
  );
  assert.ok(
    source.includes('if (isOpen && !prevIsOpenRef.current) {\n      previousActiveElementRef.current = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;\n      idempotencyKeyRef.current = generateUUID();\n      setEmail("");\n      setContent("");\n      setErrorMessage(null);\n      setSuccessRequestNumber(null);'),
    "새로 열릴 때 fresh idempotency key 및 빈 폼 상태가 보장되어야 함"
  );
});

test("제출 중 닫기 차단 및 제출 실패 시 입력값과 멱등키가 보존되어 재시도 가능함을 검증한다", async () => {
  const source = await readFile(
    new URL("./LandingSupportInquiryModal.tsx", import.meta.url),
    "utf8"
  );

  // 1. 제출 중 모든 닫기 경로(handleClose, Escape, 배경 클릭, X 버튼, 취소 버튼) 차단 검증
  assert.ok(source.includes("if (isSubmitting) return;"), "handleClose는 isSubmitting 상태에서 조기 리턴해야 함");
  assert.ok(source.includes("if (!isSubmitting) {\n          handleClose();\n        }"), "Escape 키는 isSubmitting이 아닐 때만 닫아야 함");
  assert.ok(source.includes("if (e.target === e.currentTarget && !isSubmitting) {\n          handleClose();\n        }"), "배경 클릭은 isSubmitting이 아닐 때만 닫아야 함");
  assert.ok(source.includes('disabled={isSubmitting}\n            aria-label="닫기"'), "X 닫기 버튼은 isSubmitting일 때 disabled여야 함");
  assert.ok(source.includes('disabled={isSubmitting}\n                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200'), "취소 버튼은 isSubmitting일 때 disabled여야 함");

  // 2. 제출 중에는 입력창과 제출 버튼도 비활성화되어 리셋되지 않음 검증
  assert.ok(source.includes("disabled={isSubmitting}\n                  onChange={(e) => {\n                    setEmail(e.target.value);"), "이메일 입력창은 제출 중 disabled여야 함");
  assert.ok(source.includes("disabled={isSubmitting}\n                  onChange={(e) => {\n                    setContent(e.target.value);"), "문의 내용 입력창은 제출 중 disabled여야 함");

  // 3. 제출 실패(catch 또는 non-ok 응답) 시 027 정규 오류 문구 노출 및 입력값/멱등키 보존 검증
  assert.ok(
    source.includes('setErrorMessage("문의를 접수하지 못했습니다.\\n작성한 내용은 유지되니 잠시 후 다시 시도해 주세요.");'),
    "제출 실패 시 027 정규 오류 문구가 설정되어야 함"
  );

  const catchIndex = source.indexOf("} catch {");
  const finallyIndex = source.indexOf("} finally {");
  assert.ok(catchIndex !== -1 && finallyIndex !== -1, "catch 및 finally 블록이 존재해야 함");
  const catchBlock = source.slice(catchIndex, finallyIndex);

  // catch 블록 내에서 폼 리셋 함수나 키 재생성이 호출되지 않음을 확인 (동일 키로 재시도 보장)
  assert.ok(!catchBlock.includes("resetAllFormState"), "catch 블록에서 resetAllFormState가 호출되지 않아야 함");
  assert.ok(!catchBlock.includes("generateUUID"), "catch 블록에서 generateUUID가 호출되지 않아 이전 멱등키가 유지되어야 함");
  assert.ok(!catchBlock.includes("setEmail"), "catch 블록에서 setEmail이 호출되지 않아 입력값이 유지되어야 함");
  assert.ok(!catchBlock.includes("setContent"), "catch 블록에서 setContent가 호출되지 않아 입력값이 유지되어야 함");
});
