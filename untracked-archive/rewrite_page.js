const fs = require('fs');

let content = fs.readFileSync('app/admin/retention/page.tsx', 'utf8');

// 1. Add imports
content = content.replace('import { LineChart', 'import { AdminDataTable } from "@/components/admin/shell/AdminDataTable";\nimport { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";\nimport { AdminKpiCard, AdminKpiGrid } from "@/components/admin/shell/AdminKpiCard";\nimport { LineChart');

// 2. Rewrite MetricCard to use AdminKpiCard
const metricCardRegex = /function MetricCard\(\{[^}]+\}\) \{[\s\S]*?return \([\s\S]*?\);\n\}/;
const newMetricCard = `function MetricCard({ label, value, sub, deltaPct, actualString }: { label: string; value: string; sub?: string; deltaPct?: number | null; actualString?: string }) {
  const desc = (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {deltaPct !== undefined && deltaPct !== null && (
        <div style={{ color: deltaPct > 0 ? "var(--admin-primary)" : deltaPct < 0 ? "var(--admin-danger)" : "var(--admin-text-secondary)", fontWeight: 600 }}>
          {deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "-"}{Math.abs(deltaPct)}%
        </div>
      )}
      {actualString && <div>{actualString}</div>}
      {sub && <div style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
  return <AdminKpiCard title={label} value={value} description={desc} />;
}`;
content = content.replace(metricCardRegex, newMetricCard);

// 3. Replace --color-k-* with --admin-*
const colorMap = {
  '--color-k-background': '--admin-surface',
  '--color-k-surface': '--admin-bg',
  '--color-k-border': '--admin-border',
  '--color-k-text-primary': '--admin-text-primary',
  '--color-k-text-secondary': '--admin-text-secondary',
  '--color-k-navy': '--admin-primary',
  '--color-k-navy-tint': '--admin-bg',
  '--color-k-orange': '--admin-warning',
  '--color-k-danger': '--admin-danger'
};
for (const [k, v] of Object.entries(colorMap)) {
  content = content.split(k).join(v);
}
// Remove --shadow-k-card usages just in case they aren't matching admin perfectly, actually we can keep it as is, prompt didn't say remove it. But we'll leave it.

// 4. Rewrite DrillDownSection Table to AdminDataTable
const drillDownTableRegex = /<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", whiteSpace: "nowrap" }}>[\s\S]*?<\/table>/;
const newDrillDownTable = `<AdminDataTable
              columns={
                listType === "families" ? [
                  { key: "family", header: "가족", render: (item: any) => <IdentityCell name={item.representativeParentName} loginId={item.representativeLoginId} maskedId={item.maskedId} /> },
                  { key: "createdAt", header: "생성일", render: (item: any) => new Date(item.createdAt).toLocaleDateString() },
                  { key: "count", header: "부모/아이 수", render: (item: any) => \`\${item.parentCount} / \${item.childCount}\` },
                  { key: "active", header: "동시 활성(7일)", render: (item: any) => item.dualActive7d ? "✅" : "-" },
                ] : listType === "all" ? [
                  { key: "type", header: "유형", render: (item: any) => item.userType === "parent" ? "부모" : "아이" },
                  { key: "user", header: "사용자", render: (item: any) => <IdentityCell name={item.name} loginId={item.loginId} maskedId={item.maskedId} /> },
                  { key: "activeDays", header: "활성 일수", render: (item: any) => \`\${item.activeDaysTotal ?? 0}일\` },
                  { key: "retention", header: "D1/D3/D7", render: (item: any) => \`\${retainCell(item.d1Retained)} / \${retainCell(item.d3Retained)} / \${retainCell(item.d7Retained)}\` },
                ] : listType === "child" ? [
                  { key: "child", header: "아이", render: (item: any) => <IdentityCell name={item.name} loginId={item.loginId} maskedId={item.maskedId} /> },
                  { key: "grade", header: "학년", render: (item: any) => item.grade },
                  { key: "activeDays", header: "활성 일수", render: (item: any) => \`\${item.activeDaysTotal}일\` },
                  { key: "counts", header: "미션/자유대화/놀이 수", render: (item: any) => \`\${item.missionCount} / \${item.freechatCount} / \${item.playCount}\` },
                  { key: "retention", header: "D1/D3/D7", render: (item: any) => \`\${retainCell(item.d1Retained)} / \${retainCell(item.d3Retained)} / \${retainCell(item.d7Retained)}\` },
                ] : [
                  { key: "parent", header: "부모", render: (item: any) => <IdentityCell name={item.name} loginId={item.loginId} maskedId={item.maskedId} /> },
                  { key: "joinedAt", header: "가입일", render: (item: any) => new Date(item.joinedAt).toLocaleDateString() },
                  { key: "counts", header: "로그인/리포트/대화거리 뷰", render: (item: any) => \`\${item.visitCount} / \${item.reportViewCount} / \${item.topicViewCount}\` },
                  { key: "retention", header: "D1/D3/D7", render: (item: any) => \`\${retainCell(item.d1Retained)} / \${retainCell(item.d3Retained)} / \${retainCell(item.d7Retained)}\` },
                  { key: "status", header: "상태", render: (item: any) => <StatusBadge status={item.status ?? ""} /> },
                ]
              }
              data={listData}
              keyExtractor={(item: any, i: number) => item.maskedId || String(i)}
            />`;
content = content.replace(drillDownTableRegex, newDrillDownTable);

// 5. Rewrite Filters to AdminFilterBar
const filterRegex = /<div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap", alignItems: "center", background: "var\(--admin-surface\)", padding: "16px 24px", borderRadius: 12, boxShadow: "var\(--shadow-k-card\)" }}>([\s\S]*?)<\/div>\n\n        {error &&/g;
content = content.replace(filterRegex, (match, inner) => {
  return `<AdminFilterBar
          filterNodes={[
            <div key="period" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text-secondary)" }}>조회 기간:</span>
              {(["7d", "14d", "30d", "month", "all"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: period === p ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                    background: period === p ? "var(--admin-primary)" : "white",
                    color: period === p ? "white" : "var(--admin-text-secondary)",
                    fontSize: 13,
                    fontWeight: period === p ? 700 : 400,
                    cursor: "pointer",
                  }}
                >
                  {p === "7d" ? "최근 7일" : p === "14d" ? "최근 14일" : p === "30d" ? "최근 30일" : p === "month" ? "이번 달" : "전체"}
                </button>
              ))}
            </div>,
            <label key="testAccount" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer", color: "var(--admin-text-primary)" }}>
              <input 
                type="checkbox" 
                checked={includeTestAccounts} 
                onChange={e => setIncludeTestAccounts(e.target.checked)} 
                style={{ width: 16, height: 16, accentColor: "var(--admin-primary)" }}
              />
              내부 테스트 계정 포함
            </label>,
            <a
              key="export"
              href={\`/api/admin/retention/export?scope=\${scope}&includeTestAccounts=\${includeTestAccounts}\`}
              download
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                background: "var(--admin-text-primary)",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                marginLeft: "auto"
              }}
            >
              CSV 다운로드
            </a>
          ]}
        />\n\n        {error &&`;
});

// 6. Replace KPI Grid
const kpiGridRegex = /<div style={{ display: "grid", gridTemplateColumns: "repeat\(auto-fit, minmax\(240px, 1fr\)\)", gap: 16 }}>([\s\S]*?)<\/div>\n            <\/div>\n            <\/RetentionWidgetErrorBoundary>/;
content = content.replace(kpiGridRegex, `<AdminKpiGrid>\n$1</AdminKpiGrid>\n            </div>\n            </RetentionWidgetErrorBoundary>`);

fs.writeFileSync('app/admin/retention/page.tsx', content);
