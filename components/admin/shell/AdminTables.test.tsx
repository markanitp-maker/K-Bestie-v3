import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminDataTable } from "./AdminDataTable";
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
