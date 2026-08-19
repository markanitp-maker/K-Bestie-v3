import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminDataTable, getNextSortDirection, resolveInitialSort } from "./AdminDataTable";
import { AdminResponsiveTable } from "./AdminResponsiveTable";

const columns = [{ key: "name", header: "이름", render: (row: { name: string }) => row.name }];

test("AdminDataTable은 런타임에서 data가 누락돼도 client exception 없이 빈 상태를 표시한다", () => {
  const html = renderToStaticMarkup(
    <AdminDataTable columns={columns} data={undefined as never} keyExtractor={(row) => row.name} emptyMessage="비어 있음" />,
  );
  assert.match(html, /비어 있음/);
});

test("AdminResponsiveTable 모바일 카드도 누락 배열을 안전하게 처리한다", () => {
  const html = renderToStaticMarkup(
    <AdminResponsiveTable mobileStrategy="card" columns={columns} data={undefined as never} keyExtractor={(row) => row.name} emptyMessage="비어 있음" />,
  );
  assert.match(html, /비어 있음/);
});

test("AdminResponsiveTable 모바일 경로는 API 오류를 빈 목록으로 숨기지 않는다", () => {
  const html = renderToStaticMarkup(
    <AdminResponsiveTable mobileStrategy="card" columns={columns} data={[]} error="조회 실패" onRetry={() => undefined} keyExtractor={(row) => row.name} />,
  );
  assert.match(html, /조회 실패/);
  assert.match(html, /다시 시도/);
});

// --- AdminDataTable 정렬 기능 테스트 ---

function extractFirstColumnValues(html: string): string[] {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];
  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  return rows.map((row) => {
    const tdMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    return tdMatch ? tdMatch[1].replace(/<[^>]+>/g, "").trim() : "";
  });
}

test("1. 텍스트 컬럼 첫 클릭 -> 오름차순 (한글 가나다순 정렬 및 헤더 표시)", () => {
  const textCols = [
    { key: "name", header: "이름", render: (r: { name: string }) => r.name, sortable: true, sortType: "text" as const, sortValue: (r: { name: string }) => r.name },
  ];
  const data = [{ name: "다람쥐" }, { name: "가나다" }, { name: "나비" }];

  // 첫 클릭 기본 방향: asc
  const initialSort = getNextSortDirection(null, "name", "text");
  assert.deepEqual(initialSort, { key: "name", direction: "asc" });

  const html = renderToStaticMarkup(
    <AdminDataTable columns={textCols} data={data} keyExtractor={(r) => r.name} sort={initialSort} />,
  );

  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["가나다", "나비", "다람쥐"]);
  assert.match(html, /aria-sort="ascending"/);
  assert.match(html, /data-sort-direction="asc"/);
  assert.match(html, /▲/);
});

test("2. 숫자 컬럼 첫 클릭 -> 내림차순 (큰 값 우선)", () => {
  const numCols = [
    { key: "score", header: "점수", render: (r: { id: number; score: number }) => String(r.score), sortable: true, sortType: "number" as const, sortValue: (r: { id: number; score: number }) => r.score },
  ];
  const data = [{ id: 1, score: 50 }, { id: 2, score: 100 }, { id: 3, score: 10 }];

  // 숫자 컬럼 첫 클릭 기본 방향: desc
  const initialSort = getNextSortDirection(null, "score", "number");
  assert.deepEqual(initialSort, { key: "score", direction: "desc" });

  const html = renderToStaticMarkup(
    <AdminDataTable columns={numCols} data={data} keyExtractor={(r) => String(r.id)} sort={initialSort} />,
  );

  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["100", "50", "10"]);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /data-sort-direction="desc"/);
  assert.match(html, /▼/);
});

test("3. 날짜 컬럼 첫 클릭 -> 최신 우선 (내림차순)", () => {
  const dateCols = [
    { key: "date", header: "날짜", render: (r: { id: string; date: string }) => r.date, sortable: true, sortType: "date" as const, sortValue: (r: { id: string; date: string }) => r.date },
  ];
  const data = [{ id: "a", date: "2026-01-01" }, { id: "b", date: "2026-08-19" }, { id: "c", date: "2026-05-10" }];

  // 날짜 컬럼 첫 클릭 기본 방향: desc (최신 우선)
  const initialSort = getNextSortDirection(null, "date", "date");
  assert.deepEqual(initialSort, { key: "date", direction: "desc" });

  const html = renderToStaticMarkup(
    <AdminDataTable columns={dateCols} data={data} keyExtractor={(r) => r.id} sort={initialSort} />,
  );

  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["2026-08-19", "2026-05-10", "2026-01-01"]);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /▼/);
});

test("4. 같은 컬럼 재클릭 -> asc <-> desc 방향 토글", () => {
  const cols = [
    { key: "name", header: "이름", render: (r: { name: string }) => r.name, sortable: true, sortType: "text" as const, sortValue: (r: { name: string }) => r.name },
  ];
  const data = [{ name: "다람쥐" }, { name: "가나다" }, { name: "나비" }];

  // 1) asc -> desc 토글 계산 및 렌더
  const toggledToDesc = getNextSortDirection({ key: "name", direction: "asc" }, "name", "text");
  assert.deepEqual(toggledToDesc, { key: "name", direction: "desc" });

  const htmlDesc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => r.name} sort={toggledToDesc} />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlDesc), ["다람쥐", "나비", "가나다"]);
  assert.match(htmlDesc, /aria-sort="descending"/);
  assert.match(htmlDesc, /▼/);

  // 2) desc -> asc 토글 계산 및 렌더
  const toggledToAsc = getNextSortDirection({ key: "name", direction: "desc" }, "name", "text");
  assert.deepEqual(toggledToAsc, { key: "name", direction: "asc" });

  const htmlAsc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => r.name} sort={toggledToAsc} />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlAsc), ["가나다", "나비", "다람쥐"]);
  assert.match(htmlAsc, /aria-sort="ascending"/);
  assert.match(htmlAsc, /▲/);
});

test("5. 다른 컬럼 클릭 -> 해당 컬럼의 기본 방향으로 시작", () => {
  // 1) text desc 상태에서 number 클릭 -> number 기본인 desc로 전환
  const nextFromNumber = getNextSortDirection({ key: "name", direction: "desc" }, "score", "number");
  assert.deepEqual(nextFromNumber, { key: "score", direction: "desc" });

  // 2) score desc 상태에서 text 클릭 -> text 기본인 asc로 전환
  const nextFromText = getNextSortDirection({ key: "score", direction: "desc" }, "name", "text");
  assert.deepEqual(nextFromText, { key: "name", direction: "asc" });

  // 3) name asc 상태에서 date 클릭 -> date 기본인 desc로 전환
  const nextFromDate = getNextSortDirection({ key: "name", direction: "asc" }, "date", "date");
  assert.deepEqual(nextFromDate, { key: "date", direction: "desc" });
});

test("6. null, undefined, 빈 값은 asc/desc 양쪽에서 모두 맨 뒤", () => {
  const cols = [
    { key: "val", header: "값", render: (r: { id: number; val: string | null | undefined }) => r.val ?? "EMPTY", sortable: true, sortType: "text" as const, sortValue: (r: { id: number; val: string | null | undefined }) => r.val },
  ];
  const data = [
    { id: 1, val: "나" },
    { id: 2, val: null },
    { id: 3, val: "가" },
    { id: 4, val: "" },
    { id: 5, val: undefined },
    { id: 6, val: "다" },
  ];

  // asc: 유효한 값(가, 나, 다) 정렬 후 빈 값들이 뒤로
  const htmlAsc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "val", direction: "asc" }} />,
  );
  const valuesAsc = extractFirstColumnValues(htmlAsc);
  assert.deepEqual(valuesAsc.slice(0, 3), ["가", "나", "다"]);
  assert.equal(valuesAsc.length, 6);

  // desc: 유효한 값(다, 나, 가) 정렬 후 빈 값들이 뒤로
  const htmlDesc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "val", direction: "desc" }} />,
  );
  const valuesDesc = extractFirstColumnValues(htmlDesc);
  assert.deepEqual(valuesDesc.slice(0, 3), ["다", "나", "가"]);
  assert.equal(valuesDesc.length, 6);

  // 숫자 컬럼 null 테스트
  const numCols = [
    { key: "score", header: "점수", render: (r: { id: number; score: number | null | undefined }) => String(r.score ?? "-"), sortable: true, sortType: "number" as const, sortValue: (r: { id: number; score: number | null | undefined }) => r.score },
  ];
  const numData = [
    { id: 1, score: 50 },
    { id: 2, score: null },
    { id: 3, score: 100 },
    { id: 4, score: undefined },
  ];
  const numAsc = renderToStaticMarkup(
    <AdminDataTable columns={numCols} data={numData} keyExtractor={(r) => String(r.id)} sort={{ key: "score", direction: "asc" }} />,
  );
  assert.deepEqual(extractFirstColumnValues(numAsc).slice(0, 2), ["50", "100"]);

  const numDesc = renderToStaticMarkup(
    <AdminDataTable columns={numCols} data={numData} keyExtractor={(r) => String(r.id)} sort={{ key: "score", direction: "desc" }} />,
  );
  assert.deepEqual(extractFirstColumnValues(numDesc).slice(0, 2), ["100", "50"]);
});

test("7. 같은 값이면 원래 순서 유지 (stable sort)", () => {
  const cols = [
    { key: "group", header: "그룹", render: (r: { id: number; group: string; label: string }) => r.label, sortable: true, sortType: "text" as const, sortValue: (r: { id: number; group: string; label: string }) => r.group },
  ];
  const data = [
    { id: 1, group: "B", label: "B-1" },
    { id: 2, group: "A", label: "A-1" },
    { id: 3, group: "A", label: "A-2" },
    { id: 4, group: "A", label: "A-3" },
    { id: 5, group: "B", label: "B-2" },
  ];

  const html = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "group", direction: "asc" }} />,
  );
  const values = extractFirstColumnValues(html);
  // A 그룹 내에서 A-1, A-2, A-3 순서 보존, B 그룹 내에서 B-1, B-2 순서 보존
  assert.deepEqual(values, ["A-1", "A-2", "A-3", "B-1", "B-2"]);
});

test("8. sortable이 아닌 컬럼 헤더 클릭 -> 순서 및 상태 불변", () => {
  const cols = [
    { key: "name", header: "이름", render: (r: { name: string }) => r.name, sortable: false },
  ];
  const data = [{ name: "다람쥐" }, { name: "가나다" }];

  const html = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => r.name} />,
  );
  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["다람쥐", "가나다"], "순서가 변하지 않아야 함");
  assert.doesNotMatch(html, /data-sortable="true"/);
  assert.doesNotMatch(html, /<button/);
});

test("9. sortable을 아무 컬럼에도 주지 않으면 렌더 결과가 기존과 동일", () => {
  const plainCols = [
    { key: "name", header: "이름", render: (r: { name: string; age: number }) => r.name },
    { key: "age", header: "나이", render: (r: { name: string; age: number }) => String(r.age) },
  ];
  const data = [{ name: "홍길동", age: 30 }, { name: "이순신", age: 40 }];

  const html = renderToStaticMarkup(
    <AdminDataTable columns={plainCols} data={data} keyExtractor={(r) => r.name} />,
  );

  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["홍길동", "이순신"]);
  assert.doesNotMatch(html, /data-sortable/);
  assert.doesNotMatch(html, /aria-sort/);
  assert.doesNotMatch(html, /▲|▼/);
});

test("10. controlled 모드: onSortChange가 주어지면 내부 정렬하지 않고 콜백만 위임", () => {
  const cols = [
    { key: "name", header: "이름", render: (r: { name: string }) => r.name, sortable: true, sortType: "text" as const, sortValue: (r: { name: string }) => r.name },
  ];
  const data = [{ name: "다람쥐" }, { name: "가나다" }]; // 정렬되지 않은 원본 데이터

  const onSortChange = () => undefined;

  // onSortChange가 주어지면 내부 정렬을 하지 않으므로 HTML은 원본 순서 ["다람쥐", "가나다"] 유지
  const htmlControlled = renderToStaticMarkup(
    <AdminDataTable
      columns={cols}
      data={data}
      keyExtractor={(r) => r.name}
      sort={{ key: "name", direction: "asc" }}
      onSortChange={onSortChange}
    />,
  );
  const values = extractFirstColumnValues(htmlControlled);
  assert.deepEqual(values, ["다람쥐", "가나다"], "controlled 모드에서는 내부 정렬하지 않음");
  assert.match(htmlControlled, /aria-sort="ascending"/, "헤더 표시는 sort prop 반영");
  assert.match(htmlControlled, /▲/);

  // 다음 정렬 방향 계산 검증
  const nextSort = getNextSortDirection({ key: "name", direction: "asc" }, "name", "text");
  assert.deepEqual(nextSort, { key: "name", direction: "desc" });
});

test("11. 원본 data 배열이 정렬로 변형되지 않는다 (제자리 정렬 방지 확인)", () => {
  const cols = [
    { key: "num", header: "숫자", render: (r: { num: number }) => String(r.num), sortable: true, sortType: "number" as const, sortValue: (r: { num: number }) => r.num },
  ];
  const original = [{ num: 3 }, { num: 1 }, { num: 2 }];
  const frozen = Object.freeze([...original]);

  const html = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={frozen as any} keyExtractor={(r) => String(r.num)} sort={{ key: "num", direction: "desc" }} />,
  );

  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["3", "2", "1"]);
  // 원본 객체 참조 및 순서 불변 확인
  assert.equal(frozen[0].num, 3);
  assert.equal(frozen[1].num, 1);
  assert.equal(frozen[2].num, 2);
});

// --- 확장 정렬 기능 테스트 (sortType 확장, defaultSortDirection, defaultSortKey, controlled 확장, AdminResponsiveTable 연동) ---

test("12. status 정렬: statusOrder 순서대로 정렬된다 (asc 기본)", () => {
  const statusOrder = { pending: 1, in_progress: 2, completed: 3, rejected: 4 };
  const cols = [
    {
      key: "status",
      header: "상태",
      render: (r: { id: number; status: string }) => r.status,
      sortable: true,
      sortType: "status" as const,
      statusOrder,
      sortValue: (r: { id: number; status: string }) => r.status,
    },
  ];
  const data = [
    { id: 1, status: "completed" },
    { id: 2, status: "pending" },
    { id: 3, status: "rejected" },
    { id: 4, status: "in_progress" },
  ];

  // asc: pending(1) -> in_progress(2) -> completed(3) -> rejected(4)
  const initialSort = getNextSortDirection(null, "status", "status");
  assert.deepEqual(initialSort, { key: "status", direction: "asc" });

  const htmlAsc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={initialSort} />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlAsc), ["pending", "in_progress", "completed", "rejected"]);

  // desc: rejected(4) -> completed(3) -> in_progress(2) -> pending(1)
  const htmlDesc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "status", direction: "desc" }} />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlDesc), ["rejected", "completed", "in_progress", "pending"]);
});

test("13. status 정렬: statusOrder에 없는 값은 맨 끝 등급으로 취급(단, 빈 값보다는 앞)", () => {
  const statusOrder = { active: 1, paused: 2 };
  const cols = [
    {
      key: "status",
      header: "상태",
      render: (r: { id: number; status: string | null | undefined }) => (r.status ? r.status : "EMPTY"),
      sortable: true,
      sortType: "status" as const,
      statusOrder,
      sortValue: (r: { id: number; status: string | null | undefined }) => r.status,
    },
  ];
  const data = [
    { id: 1, status: null },            // 빈 값 (항상 맨 뒤)
    { id: 2, status: "unknown_status" }, // statusOrder에 없는 값 (맨 끝 등급)
    { id: 3, status: "paused" },         // rank 2
    { id: 4, status: "active" },         // rank 1
    { id: 5, status: "" },               // 빈 값 (항상 맨 뒤)
  ];

  // asc 정렬 시: active(1) -> paused(2) -> unknown_status(미등록) -> null/빈값들(맨 뒤)
  const htmlAsc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "status", direction: "asc" }} />,
  );
  const valuesAsc = extractFirstColumnValues(htmlAsc);
  assert.equal(valuesAsc[0], "active");
  assert.equal(valuesAsc[1], "paused");
  assert.equal(valuesAsc[2], "unknown_status");
  assert.equal(valuesAsc[3], "EMPTY");
  assert.equal(valuesAsc[4], "EMPTY");

  // desc 정렬 시: unknown_status(미등록) -> paused(2) -> active(1) -> null/빈값들(항상 맨 뒤)
  const htmlDesc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "status", direction: "desc" }} />,
  );
  const valuesDesc = extractFirstColumnValues(htmlDesc);
  assert.equal(valuesDesc[0], "unknown_status");
  assert.equal(valuesDesc[1], "paused");
  assert.equal(valuesDesc[2], "active");
  assert.equal(valuesDesc[3], "EMPTY");
  assert.equal(valuesDesc[4], "EMPTY");
});

test("14. boolean 정렬: 첫 클릭에 true가 앞(기본 desc) 및 boolean/문자열 처리", () => {
  const cols = [
    {
      key: "isActive",
      header: "활성",
      render: (r: { id: number; isActive: boolean | string }) => String(r.isActive),
      sortable: true,
      sortType: "boolean" as const,
      sortValue: (r: { id: number; isActive: boolean | string }) => r.isActive,
    },
  ];
  const data = [
    { id: 1, isActive: false },
    { id: 2, isActive: true },
    { id: 3, isActive: "false" },
    { id: 4, isActive: "true" },
  ];

  // boolean 첫 클릭 기본 방향은 "desc" (true가 앞)
  const nextSort = getNextSortDirection(null, "isActive", "boolean");
  assert.deepEqual(nextSort, { key: "isActive", direction: "desc" });

  const htmlDesc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={nextSort} />,
  );
  const valuesDesc = extractFirstColumnValues(htmlDesc);
  assert.deepEqual(valuesDesc, ["true", "true", "false", "false"]);

  // asc로 토글 시 false가 앞
  const htmlAsc = renderToStaticMarkup(
    <AdminDataTable columns={cols} data={data} keyExtractor={(r) => String(r.id)} sort={{ key: "isActive", direction: "asc" }} />,
  );
  const valuesAsc = extractFirstColumnValues(htmlAsc);
  assert.deepEqual(valuesAsc, ["false", "false", "true", "true"]);
});

test("15. defaultSortDirection을 준 컬럼은 첫 클릭이 지정된 방향", () => {
  const cols = [
    {
      key: "name",
      header: "이름",
      render: (r: { name: string }) => r.name,
      sortable: true,
      sortType: "text" as const,
      defaultSortDirection: "desc" as const,
      sortValue: (r: { name: string }) => r.name,
    },
    {
      key: "score",
      header: "점수",
      render: (r: { score: number }) => String(r.score),
      sortable: true,
      sortType: "number" as const,
      defaultSortDirection: "asc" as const,
      sortValue: (r: { score: number }) => r.score,
    },
  ];

  const sortName = getNextSortDirection(null, "name", cols[0].sortType, cols[0].defaultSortDirection);
  assert.deepEqual(sortName, { key: "name", direction: "desc" });

  const sortScore = getNextSortDirection(null, "score", cols[1].sortType, cols[1].defaultSortDirection);
  assert.deepEqual(sortScore, { key: "score", direction: "asc" });
});

test("16. defaultSortKey로 첫 렌더부터 정렬되어 렌더된다 (uncontrolled)", () => {
  const cols = [
    {
      key: "score",
      header: "점수",
      render: (r: { id: number; score: number }) => String(r.score),
      sortable: true,
      sortType: "number" as const,
      sortValue: (r: { id: number; score: number }) => r.score,
    },
  ];
  const data = [{ id: 1, score: 30 }, { id: 2, score: 100 }, { id: 3, score: 70 }];

  // defaultSortKey="score" -> number 컬럼이므로 기본 desc 정렬 (100, 70, 30)
  const html = renderToStaticMarkup(
    <AdminDataTable
      columns={cols}
      data={data}
      keyExtractor={(r) => String(r.id)}
      defaultSortKey="score"
    />,
  );
  const values = extractFirstColumnValues(html);
  assert.deepEqual(values, ["100", "70", "30"]);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /▼/);
});

test("17. defaultSortKey가 존재하지 않는 key이거나 sortable이 아니면 무시하고 정렬 없이 렌더", () => {
  const cols = [
    {
      key: "name",
      header: "이름",
      render: (r: { name: string }) => r.name,
      sortable: false,
    },
  ];
  const data = [{ name: "다" }, { name: "가" }, { name: "나" }];

  // 1) 존재하지 않는 key
  const htmlNonExistent = renderToStaticMarkup(
    <AdminDataTable
      columns={cols}
      data={data}
      keyExtractor={(r) => r.name}
      defaultSortKey="non_existent_key"
    />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlNonExistent), ["다", "가", "나"]);
  assert.doesNotMatch(htmlNonExistent, /aria-sort/);

  // 2) sortable이 아닌 컬럼 key
  const htmlNonSortable = renderToStaticMarkup(
    <AdminDataTable
      columns={cols}
      data={data}
      keyExtractor={(r) => r.name}
      defaultSortKey="name"
    />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlNonSortable), ["다", "가", "나"]);
  assert.doesNotMatch(htmlNonSortable, /aria-sort/);
});

test("18. 사용자 클릭 시 defaultSortKey 기반 초기 상태가 다음 정렬 방향으로 갱신된다", () => {
  type Person = { name: string; age: number };
  const cols = [
    {
      key: "name",
      header: "이름",
      render: (r: Person) => r.name,
      sortable: true,
      sortType: "text" as const,
      sortValue: (r: Person) => r.name,
    },
    {
      key: "age",
      header: "나이",
      render: (r: Person) => String(r.age),
      sortable: true,
      sortType: "number" as const,
      sortValue: (r: Person) => r.age,
    },
  ];

  const initial = resolveInitialSort(cols, "name");
  assert.deepEqual(initial, { key: "name", direction: "asc" });

  const toggled = getNextSortDirection(initial, "name", "text");
  assert.deepEqual(toggled, { key: "name", direction: "desc" });

  const switched = getNextSortDirection(initial, "age", "number");
  assert.deepEqual(switched, { key: "age", direction: "desc" });
});

test("19. 새 controlled 형태(sortKey/sortDirection/onSortChange)에서 내부 정렬하지 않고 (key, direction) 콜백 호출", () => {
  const cols = [
    {
      key: "name",
      header: "이름",
      render: (r: { name: string }) => r.name,
      sortable: true,
      sortType: "text" as const,
      sortValue: (r: { name: string }) => r.name,
    },
  ];
  const data = [{ name: "다람쥐" }, { name: "가나다" }];

  let callbackArgs: [string, "asc" | "desc"] | null = null;
  const onSortChange = (key: string, direction: "asc" | "desc") => {
    callbackArgs = [key, direction];
  };

  const html = renderToStaticMarkup(
    <AdminDataTable
      columns={cols}
      data={data}
      keyExtractor={(r) => r.name}
      sortKey="name"
      sortDirection="asc"
      onSortChange={onSortChange}
    />,
  );

  assert.deepEqual(extractFirstColumnValues(html), ["다람쥐", "가나다"]);
  assert.match(html, /aria-sort="ascending"/);
  assert.match(html, /▲/);

  const next = getNextSortDirection({ key: "name", direction: "asc" }, "name", "text");
  onSortChange(next.key, next.direction);
  assert.deepEqual(callbackArgs, ["name", "desc"]);
});

test("20. 기존 controlled 형태(sort/객체 콜백)도 하위 호환으로 정상 동작", () => {
  const cols = [
    {
      key: "score",
      header: "점수",
      render: (r: { score: number }) => String(r.score),
      sortable: true,
      sortType: "number" as const,
      sortValue: (r: { score: number }) => r.score,
    },
  ];
  const data = [{ score: 10 }, { score: 100 }];

  let legacyCallbackArg: { key: string; direction: "asc" | "desc" } | null = null;
  const onSortChange = (next: { key: string; direction: "asc" | "desc" }) => {
    legacyCallbackArg = next;
  };

  const html = renderToStaticMarkup(
    <AdminDataTable
      columns={cols}
      data={data}
      keyExtractor={(r) => String(r.score)}
      sort={{ key: "score", direction: "desc" }}
      onSortChange={onSortChange}
    />,
  );

  assert.deepEqual(extractFirstColumnValues(html), ["10", "100"]);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /▼/);

  const next = getNextSortDirection({ key: "score", direction: "desc" }, "score", "number");
  onSortChange(next);
  assert.deepEqual(legacyCallbackArg, { key: "score", direction: "asc" });
});

test("21. AdminResponsiveTable에서도 defaultSortKey 및 정렬 props가 정상 반영된다 (데스크톱 및 모바일 카드)", () => {
  const cols = [
    {
      key: "score",
      header: "점수",
      render: (r: { id: number; score: number }) => String(r.score),
      sortable: true,
      sortType: "number" as const,
      sortValue: (r: { id: number; score: number }) => r.score,
    },
  ];
  const data = [{ id: 1, score: 20 }, { id: 2, score: 90 }, { id: 3, score: 50 }];

  // 1) scroll 모드 (기본 데스크톱 테이블 래퍼)
  const htmlScroll = renderToStaticMarkup(
    <AdminResponsiveTable
      mobileStrategy="scroll"
      columns={cols}
      data={data}
      keyExtractor={(r) => String(r.id)}
      defaultSortKey="score"
    />,
  );
  assert.deepEqual(extractFirstColumnValues(htmlScroll), ["90", "50", "20"]);

  // 2) card 모드 (모바일 카드 뷰 순서 반영 확인)
  const htmlCard = renderToStaticMarkup(
    <AdminResponsiveTable
      mobileStrategy="card"
      columns={cols}
      data={data}
      keyExtractor={(r) => String(r.id)}
      defaultSortKey="score"
    />,
  );
  // 데스크톱 테이블 영역 정렬 확인
  assert.deepEqual(extractFirstColumnValues(htmlCard), ["90", "50", "20"]);
  // 모바일 카드 영역에 90, 50, 20 순서로 등장하는지 확인
  const cardIndex90 = htmlCard.indexOf("90");
  const cardIndex50 = htmlCard.indexOf("50");
  const cardIndex20 = htmlCard.indexOf("20");
  assert.ok(cardIndex90 !== -1 && cardIndex50 !== -1 && cardIndex20 !== -1);
  assert.ok(cardIndex90 < cardIndex50 && cardIndex50 < cardIndex20, "모바일 카드에서도 90 -> 50 -> 20 순서로 렌더되어야 함");
});
