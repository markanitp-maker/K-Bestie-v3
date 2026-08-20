import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkPublishGate,
  isAspectAllowed,
  parseFilename,
  storagePathFor,
  validateUpload,
  type UploadedFile,
} from "./uploadValidation";

function file(filename: string, over: Partial<UploadedFile> = {}): UploadedFile {
  return { filename, byteSize: 1_000_000, width: 1080, height: 1920, ...over };
}

/** 표지 + 본문 n장. */
function set(bodyPages: number): UploadedFile[] {
  const out = [file("00.jpg")];
  for (let i = 1; i <= bodyPages; i += 1) out.push(file(`${String(i).padStart(2, "0")}.jpg`));
  return out;
}

test("파일명 파싱 — 확장자 대소문자를 허용한다 (SPEC §12)", () => {
  assert.deepEqual(parseFilename("00.jpg"), { pageNumber: 0, extension: "jpg" });
  assert.deepEqual(parseFilename("07.JPEG"), { pageNumber: 7, extension: "jpeg" });
  assert.deepEqual(parseFilename("123.webp"), { pageNumber: 123, extension: "webp" });
  assert.equal(parseFilename("cover.jpg"), null);
  assert.equal(parseFilename("1.jpg"), null, "두 자리 이상이어야 한다");
  assert.equal(parseFilename("01.jpg.bak"), null);
});

test("U-04 비율 경계 (0.5625 ±1% = 0.556875 ~ 0.568125)", () => {
  assert.equal(isAspectAllowed(1080, 1920), true, "0.562500 — 정확히 9:16");

  // 경계 바로 안쪽 / 바로 바깥쪽을 한 픽셀 차이로 고정한다.
  assert.equal(isAspectAllowed(1080, 1939), true, "0.556988 — 하한 안쪽");
  assert.equal(isAspectAllowed(1080, 1940), false, "0.556701 — 하한 바깥");

  assert.equal(isAspectAllowed(1080, 1901), true, "0.568122 — 상한 안쪽");
  assert.equal(isAspectAllowed(1080, 1900), false, "0.568421 — 상한 바깥");

  assert.equal(isAspectAllowed(1080, 1944), false, "0.555556 — 명백히 밖");
  assert.equal(isAspectAllowed(1080, 1895), false, "0.569921 — 명백히 밖");
  assert.equal(isAspectAllowed(0, 1920), false);
  assert.equal(isAspectAllowed(1080, 0), false);
});

test("정상 묶음은 통과한다", () => {
  const r = validateUpload(set(30));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.pages.length, 31);
  assert.equal(r.pages[0].pageNumber, 0);
});

test("U-06 PNG 는 거부한다", () => {
  const r = validateUpload([...set(2), file("03.png")]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "unsupported_format"));
});

test("U-05 5MB 초과는 거부한다", () => {
  const r = validateUpload([...set(2), file("03.jpg", { byteSize: 5 * 1024 * 1024 + 1 })]);
  assert.ok(r.issues.some((i) => i.code === "file_too_large"));

  const ok = validateUpload([...set(2), file("03.jpg", { byteSize: 5 * 1024 * 1024 })]);
  assert.equal(ok.ok, true, "정확히 5MB 는 허용");
});

test("U-07 가로 1080px 미만은 거부한다", () => {
  const r = validateUpload([...set(2), file("03.jpg", { width: 1079, height: 1918 })]);
  assert.ok(r.issues.some((i) => i.code === "width_too_small"));
});

test("U-08 본문 장수 경계 (1~60)", () => {
  assert.equal(validateUpload(set(1)).ok, true);
  assert.equal(validateUpload(set(60)).ok, true);

  const over = validateUpload(set(61));
  assert.equal(over.ok, false);
  assert.ok(over.issues.some((i) => i.code === "too_many_pages"));

  const noBody = validateUpload([file("00.jpg")]);
  assert.ok(noBody.issues.some((i) => i.code === "missing_body"));
});

test("U-03 표지 누락 / 번호 중복 / 번호 누락을 잡는다 (SPEC §13)", () => {
  const noCover = validateUpload([file("01.jpg"), file("02.jpg")]);
  assert.ok(noCover.issues.some((i) => i.code === "missing_cover"));

  const dup = validateUpload([file("00.jpg"), file("01.jpg"), file("01.jpeg")]);
  assert.ok(dup.issues.some((i) => i.code === "duplicate_page"));

  // 03 이 빠진 채 04 가 있는 경우 — SPEC §13 이 명시한 예시
  const gap = validateUpload([file("00.jpg"), file("01.jpg"), file("02.jpg"), file("04.jpg")]);
  assert.equal(gap.ok, false);
  assert.ok(gap.issues.some((i) => i.code === "page_gap"));
});

test("문제를 한 건만 보고 멈추지 않는다 — 관리자가 한 번에 고칠 수 있어야 한다", () => {
  const r = validateUpload([
    file("00.jpg", { byteSize: 6 * 1024 * 1024 }),
    file("01.png"),
    file("bad.jpg"),
  ]);
  const codes = new Set(r.issues.map((i) => i.code));
  assert.ok(codes.has("file_too_large"));
  assert.ok(codes.has("unsupported_format"));
  assert.ok(codes.has("invalid_filename"));
});

test("C-05 Publish Gate — 하나라도 실패하면 공개하지 않는다 (SPEC §36)", () => {
  const files = set(10);
  assert.equal(
    checkPublishGate({ title: "책", synopsis: "줄거리", files, allAssetsUploaded: true }).ok,
    true,
  );

  assert.equal(
    checkPublishGate({ title: "  ", synopsis: "줄거리", files, allAssetsUploaded: true }).ok,
    false,
    "제목 없음",
  );
  assert.equal(
    checkPublishGate({ title: "책", synopsis: "", files, allAssetsUploaded: true }).ok,
    false,
    "줄거리 없음",
  );
  assert.equal(
    checkPublishGate({ title: "책", synopsis: "줄거리", files, allAssetsUploaded: false }).ok,
    false,
    "업로드 미완료",
  );
});

test("자산 경로에 version 이 들어간다 — 같은 경로를 덮어쓰지 않는다 (계약 §9)", () => {
  const { pages } = validateUpload(set(3));
  assert.equal(storagePathFor("book-1", 2, pages[0]), "comic/book-1/2/00.jpg");
  assert.equal(storagePathFor("book-1", 2, pages[3]), "comic/book-1/2/03.jpg");
  assert.notEqual(storagePathFor("book-1", 3, pages[0]), storagePathFor("book-1", 2, pages[0]));
});
