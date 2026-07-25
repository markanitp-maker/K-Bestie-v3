"use client";

import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { ParentNav } from "../../components/ParentNav";

const SETTINGS_MENU = [
  { icon: "➕", title: "아이 추가", desc: "새로운 아이 계정을 추가해요" },
  { icon: "🔄", title: "아이 변경", desc: "다른 아이 프로필로 전환해요" },
  { icon: "📝", title: "아이 정보 관리", desc: "이름, 학년, 생일 등을 관리해요" },
];

export default function DemoParentSettingsPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "var(--color-k-surface)" }}
        >
          <Link href="/demo" className="font-bold text-sm cursor-pointer" style={{ color: "var(--color-k-navy)" }}>
            설정
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {SETTINGS_MENU.map((item, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-center gap-3"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                style={{ background: "#f3f4f6" }}
              >
                {item.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                  {item.title}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                  {item.desc}
                </p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280" }}>
                →
              </span>
            </div>
          ))}
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
