"use client";

import React from "react";

interface Props {
  label: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

// requests/061 §8 — 위젯(카드/차트/드릴다운) 단위 오류 격리. 한 위젯이 던진 예외가
// 페이지 전체를 흰 화면으로 만들지 않도록 막는다. 내부 SQL/Secret/stack trace는
// 화면에 노출하지 않는다.
export class RetentionWidgetErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[RetentionWidgetErrorBoundary:${this.props.label}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            background: "var(--color-k-background)",
            borderRadius: 12,
            boxShadow: "var(--shadow-k-card)",
            padding: 24,
            textAlign: "center",
            color: "var(--color-k-text-secondary)",
          }}
        >
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{this.props.label}을(를) 표시하지 못했습니다.</p>
          <p style={{ fontSize: 13 }}>오류 코드: RETENTION_WIDGET_RENDER_FAILED</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 12,
              padding: "6px 16px",
              borderRadius: 999,
              border: "1px solid var(--color-k-navy)",
              background: "white",
              color: "var(--color-k-navy)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
