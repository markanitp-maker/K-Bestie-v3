/**
 * 만화책 업로드 Validation (SPEC §12~§14, §36 / PRD §5)
 *
 * 확정값:
 *   aspect_ratio   0.5625 ± 1%   (0.5569 ~ 0.5681)
 *   max_file_size  5 MB / page
 *   max_pages      60 (본문) + 00.jpg 표지
 *   min_pages      1  (본문 01.jpg 필수)
 *   formats        .jpg .jpeg .webp   (PNG 거부)
 *   min_width      1080 px
 *
 * 서버가 강제한다. 관리자 화면이 먼저 걸러도 여기서 다시 본다 —
 * Publish Gate 는 화면이 아니라 서버 계약이다(SPEC §36).
 */

export const ASPECT_RATIO = 9 / 16; // 0.5625
export const ASPECT_TOLERANCE = 0.01; // ±1%
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_BODY_PAGES = 60;
export const MIN_BODY_PAGES = 1;
export const MIN_WIDTH = 1080;
export const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "webp"] as const;

export interface UploadedFile {
  filename: string;
  byteSize: number;
  width: number;
  height: number;
}

export type ValidationCode =
  | "invalid_filename"
  | "duplicate_page"
  | "missing_cover"
  | "missing_body"
  | "page_gap"
  | "too_many_pages"
  | "file_too_large"
  | "unsupported_format"
  | "width_too_small"
  | "aspect_ratio";

export interface ValidationIssue {
  code: ValidationCode;
  filename?: string;
  detail: string;
}

export interface ParsedPage {
  pageNumber: number;
  extension: string;
  file: UploadedFile;
}

/**
 * 파일명이 Source of Truth 다(SPEC §12, §35).
 * `00.jpg` = 표지, `01.jpg`~ = 본문. 확장자 대소문자는 허용한다.
 */
export function parseFilename(filename: string): { pageNumber: number; extension: string } | null {
  const match = /^(\d{2,3})\.([A-Za-z]+)$/.exec(filename);
  if (!match) return null;

  const pageNumber = Number(match[1]);
  if (!Number.isInteger(pageNumber) || pageNumber < 0) return null;

  return { pageNumber, extension: match[2].toLowerCase() };
}

function isAllowedExtension(ext: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

/** 비율이 허용 범위 안인가. 임의 Crop 은 하지 않는다(SPEC §14). */
export function isAspectAllowed(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const ratio = width / height;
  const min = ASPECT_RATIO * (1 - ASPECT_TOLERANCE);
  const max = ASPECT_RATIO * (1 + ASPECT_TOLERANCE);
  return ratio >= min && ratio <= max;
}

/**
 * 업로드 묶음 전체를 검증한다.
 *
 * 개별 파일 문제와 묶음 문제(누락·중복)를 함께 본다. 한 건만 보고 멈추지 않고
 * 전부 모아 돌려준다 — 관리자가 한 번에 고칠 수 있어야 하기 때문이다.
 */
export function validateUpload(files: readonly UploadedFile[]): {
  ok: boolean;
  issues: ValidationIssue[];
  pages: ParsedPage[];
} {
  const issues: ValidationIssue[] = [];
  const pages: ParsedPage[] = [];
  const seen = new Map<number, string>();

  for (const file of files) {
    const parsed = parseFilename(file.filename);
    if (!parsed) {
      issues.push({
        code: "invalid_filename",
        filename: file.filename,
        detail: "00.jpg / 01.jpg 형식이 아니다",
      });
      continue;
    }

    if (!isAllowedExtension(parsed.extension)) {
      issues.push({
        code: "unsupported_format",
        filename: file.filename,
        detail: `허용 확장자는 ${ALLOWED_EXTENSIONS.join(", ")} 다`,
      });
      continue;
    }

    const previous = seen.get(parsed.pageNumber);
    if (previous) {
      issues.push({
        code: "duplicate_page",
        filename: file.filename,
        detail: `${previous} 와 같은 번호다`,
      });
      continue;
    }
    seen.set(parsed.pageNumber, file.filename);

    if (file.byteSize > MAX_FILE_BYTES) {
      issues.push({ code: "file_too_large", filename: file.filename, detail: "5MB 를 넘는다" });
    }
    if (file.width < MIN_WIDTH) {
      issues.push({
        code: "width_too_small",
        filename: file.filename,
        detail: `가로가 ${MIN_WIDTH}px 미만이다`,
      });
    }
    if (!isAspectAllowed(file.width, file.height)) {
      issues.push({
        code: "aspect_ratio",
        filename: file.filename,
        detail: "9:16 ±1% 를 벗어난다. 임의로 잘라내지 않는다",
      });
    }

    pages.push({ pageNumber: parsed.pageNumber, extension: parsed.extension, file });
  }

  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  const numbers = pages.map((p) => p.pageNumber);
  if (!numbers.includes(0)) {
    issues.push({ code: "missing_cover", detail: "표지 00 파일이 없다" });
  }

  const body = numbers.filter((n) => n >= 1);
  if (body.length < MIN_BODY_PAGES) {
    issues.push({ code: "missing_body", detail: "본문 01 파일이 최소 1장 필요하다" });
  }
  if (body.length > MAX_BODY_PAGES) {
    issues.push({
      code: "too_many_pages",
      detail: `본문은 최대 ${MAX_BODY_PAGES}장이다 (현재 ${body.length}장)`,
    });
  }

  // 연속성 — 03 이 빠진 채 04 가 있으면 Publish 하지 않는다(SPEC §13).
  for (let i = 1; i <= body.length; i += 1) {
    if (!body.includes(i)) {
      issues.push({
        code: "page_gap",
        detail: `${String(i).padStart(2, "0")} 번이 없다`,
      });
      break;
    }
  }

  return { ok: issues.length === 0, issues, pages };
}

export interface PublishGateInput {
  title: string;
  synopsis: string;
  files: readonly UploadedFile[];
  /** 모든 asset 이 실제로 버킷에 올라갔는가. */
  allAssetsUploaded: boolean;
}

/**
 * Publish Gate (SPEC §36) — 아래가 모두 PASS 해야 공개할 수 있다.
 * 하나라도 실패하면 비공개를 유지한다.
 */
export function checkPublishGate(input: PublishGateInput): {
  ok: boolean;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  if (input.title.trim().length === 0) {
    issues.push({ code: "invalid_filename", detail: "제목이 비어 있다" });
  }
  if (input.synopsis.trim().length === 0) {
    issues.push({ code: "invalid_filename", detail: "줄거리가 비어 있다" });
  }

  const upload = validateUpload(input.files);
  issues.push(...upload.issues);

  if (!input.allAssetsUploaded) {
    issues.push({ code: "invalid_filename", detail: "업로드되지 않은 asset 이 있다" });
  }

  return { ok: issues.length === 0, issues };
}

/** 자산 경로. 같은 경로를 덮어쓰지 않으므로 version 이 반드시 들어간다(계약 §9). */
export function storagePathFor(bookId: string, version: number, page: ParsedPage): string {
  return `comic/${bookId}/${version}/${String(page.pageNumber).padStart(2, "0")}.${page.extension}`;
}
