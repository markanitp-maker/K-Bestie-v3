// 질병관리청 「2017 소아청소년 성장도표」 공식 데이터 테이블(xlsx) →
// lib/growth/standards/kdca-2017/lms.generated.ts 변환 스크립트.
//
// 입력  : docs/growth/kdca-2017-source/kdca-2017-growth-chart-data-table.xlsx
//         (질병관리청 국민건강영양조사 홈페이지 > 성장도표 > 성장도표 다운로드 >
//          "소아청소년 성장도표 기본자료"(2017) 의 "성장도표 데이터 테이블.xls")
// 출력  : lib/growth/standards/kdca-2017/lms.generated.ts
//
// 원본 시트 구조(2026-08-18 실측):
//   A열 성별(1=남,2=여) / B열 만나이(세, 연 경계 행에만 채워짐) / C열 만나이(개월)
//   D열 L / E열 M / F열 S / G열 이후 백분위수·표준편차 값
// 우리는 L·M·S 만 사용한다. 백분위수 열은 공식 계산기와 동일한 LMS 산식으로 재현되므로
// 중복 저장하지 않는다(요청서 012 §3-11 "동일 결과를 여러 테이블에 중복 저장하지 않는다").
//
// 재생성: node scripts/growth/build-kdca-2017-lms.mjs
// 외부 의존성 없이 동작한다(zlib 로 xlsx(zip) 를 직접 해제한다).

import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";

const SOURCE_XLSX = "docs/growth/kdca-2017-source/kdca-2017-growth-chart-data-table.xlsx";
const OUTPUT_TS = "lib/growth/standards/kdca-2017/lms.generated.ts";

/** xlsx(zip) 의 엔트리를 이름 → Buffer 로 읽는다. */
function readZipEntries(buf) {
  const entries = new Map();
  // End of central directory 를 뒤에서 찾는다.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: end of central directory 를 찾지 못했다");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("xlsx: central directory 헤더 불일치");
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    // local file header 에서 실제 데이터 시작 위치를 계산한다.
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function columnIndex(cellRef) {
  const letters = /^([A-Z]+)/.exec(cellRef)[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 워크시트 xml 을 [행번호, {열번호: 값}] 목록으로 파싱한다. */
function parseSheet(xml) {
  const rows = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells = {};
    const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2])) !== null) {
      const body = cellMatch[3] ?? "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (value) cells[columnIndex(cellMatch[1])] = value[1];
    }
    rows.push([Number(rowMatch[1]), cells]);
  }
  return rows;
}

const SHEETS = [
  { sheetName: "연령별 신장", key: "heightForAge" },
  { sheetName: "연령별 체중", key: "weightForAge" },
  { sheetName: "연령별 체질량지수", key: "bmiForAge" },
];

const repoRoot = process.cwd();
const zip = readZipEntries(readFileSync(path.join(repoRoot, SOURCE_XLSX)));
const workbookXml = zip.get("xl/workbook.xml").toString("utf8");
const relsXml = zip.get("xl/_rels/workbook.xml.rels").toString("utf8");

const relTargets = new Map();
for (const m of relsXml.matchAll(/Id="rId(\d+)"[^>]*Target="([^"]+)"/g)) {
  relTargets.set(m[1], m[2]);
}
const sheetTargets = new Map();
for (const m of workbookXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="rId(\d+)"/g)) {
  sheetTargets.set(m[1], relTargets.get(m[2]));
}

const tables = {};
for (const { sheetName, key } of SHEETS) {
  const target = sheetTargets.get(sheetName);
  if (!target) throw new Error(`원본 xlsx 에 "${sheetName}" 시트가 없다`);
  const entryName = "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, "");
  const rows = parseSheet(zip.get(entryName).toString("utf8"));

  const bySex = { male: {}, female: {} };
  for (const [rowNumber, cells] of rows) {
    if (rowNumber < 3) continue; // 1~2행은 머리글
    const sex = cells[1];
    const ageMonths = cells[3];
    const L = cells[4];
    const M = cells[5];
    const S = cells[6];
    if ((sex !== "1" && sex !== "2") || ageMonths === undefined || M === undefined) continue;
    const target = sex === "1" ? bySex.male : bySex.female;
    target[Number(ageMonths)] = [Number(L), Number(M), Number(S)];
  }
  for (const sexKey of ["male", "female"]) {
    const months = Object.keys(bySex[sexKey]);
    if (months.length === 0) throw new Error(`${sheetName}/${sexKey}: LMS 행을 하나도 읽지 못했다`);
  }
  tables[key] = bySex;
}

function serializeTable(bySex) {
  const lines = [];
  for (const sexKey of ["male", "female"]) {
    lines.push(`    ${sexKey}: {`);
    for (const month of Object.keys(bySex[sexKey]).map(Number).sort((a, b) => a - b)) {
      const [L, M, S] = bySex[sexKey][month];
      lines.push(`      ${month}: [${L}, ${M}, ${S}],`);
    }
    lines.push("    },");
  }
  return lines.join("\n");
}

const header = `// 자동 생성 파일 — 직접 수정하지 마라.
// 생성: node scripts/growth/build-kdca-2017-lms.mjs
// 원본: 질병관리청 「2017 소아청소년 성장도표」 성장도표 데이터 테이블
//       (docs/growth/kdca-2017-source/kdca-2017-growth-chart-data-table.xlsx)
// 출처·검증 근거: docs/growth/kdca-2017-data-provenance.md
//
// 값은 [L, M, S] 순서이며 키는 만나이(개월)다. 원본 표기값을 반올림 없이 그대로 옮긴다.

import type { LmsTableSet } from "./types";

export const KDCA_2017_LMS: LmsTableSet = {
`;

const body = SHEETS.map(({ key }) => `  ${key}: {\n${serializeTable(tables[key])}\n  },`).join("\n");

writeFileSync(path.join(repoRoot, OUTPUT_TS), `${header}${body}\n};\n`, "utf8");

const summary = SHEETS.map(({ key }) => {
  const months = Object.keys(tables[key].male).map(Number);
  return `${key}: 남 ${Object.keys(tables[key].male).length}행 / 여 ${Object.keys(tables[key].female).length}행 (${Math.min(...months)}~${Math.max(...months)}개월)`;
}).join("\n  ");
console.log(`생성 완료: ${OUTPUT_TS}\n  ${summary}`);
