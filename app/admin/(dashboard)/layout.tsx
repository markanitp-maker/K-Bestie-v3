export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-k-surface)" }}>
      <header
        style={{
          background: "var(--color-k-background)",
          borderBottom: "1px solid var(--color-k-border)",
          padding: "16px 24px",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-k-text-primary)", margin: 0 }}>
          내친구 케이 — 관리자
        </h1>
      </header>
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "24px" }}>{children}</main>
    </div>
  );
}
