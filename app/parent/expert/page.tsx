"use client";

import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { BackArrow } from "@/components/ParentIcons";
const EXPERTS = [
  {
    id: 1,
    name: "자살예방상담전화",
    number: "1393",
    badge: "긴급",
    badgeColor: "#EF4444",
    badgeBg: "#FEF2F2",
    emoji: "🚨",
    hours: "24시간",
  },
  {
    id: 2,
    name: "정신건강위기상담전화",
    number: "1577-0199",
    badge: "긴급",
    badgeColor: "#EF4444",
    badgeBg: "#FEF2F2",
    emoji: "🏥",
    hours: "24시간",
  },
  {
    id: 3,
    name: "아동학대 신고",
    number: "112",
    badge: "긴급",
    badgeColor: "#EF4444",
    badgeBg: "#FEF2F2",
    emoji: "🚔",
    hours: "24시간",
  },
  {
    id: 4,
    name: "청소년상담 1388",
    number: "1388",
    badge: "주의",
    badgeColor: "#D97706",
    badgeBg: "#FFFBEB",
    emoji: "🧑‍🎓",
    hours: "24시간",
  },
  {
    id: 5,
    name: "Wee센터",
    number: null,
    badge: "일반",
    badgeColor: "#6B7280",
    badgeBg: "#F9FAFB",
    emoji: "🏫",
    hours: "평일 09:00–18:00",
    url: "https://wee.go.kr",
  },
  {
    id: 6,
    name: "한국아동보호전문기관",
    number: "1577-1391",
    badge: "일반",
    badgeColor: "#6B7280",
    badgeBg: "#F9FAFB",
    emoji: "🧒",
    hours: null,
    url: "https://korea1391.go.kr",
  },
  {
    id: 7,
    name: "한국청소년상담복지개발원",
    number: "051-662-3174",
    badge: "일반",
    badgeColor: "#6B7280",
    badgeBg: "#F9FAFB",
    emoji: "🏛️",
    hours: null,
    url: "https://kyci.or.kr",
  },
];

export default function ParentExpertPage() {
  return (
    <div
      className="min-h-dvh pb-[72px] lg:pb-12 lg:pl-[240px] w-full transition-all"
      style={{ background: "var(--color-k-surface)" }}
    >
      {/* 헤더 */}
      <div className="bg-white px-5 pt-12 pb-4 flex items-center gap-3">
        <Link href="/parent/home" style={{ color: "var(--color-k-navy)" }}>
          <BackArrow />
        </Link>
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--color-k-text-secondary)" }}>
            전문가 연결
          </p>
          <h1 className="text-[17px] font-bold text-gray-900">전문가와 연결하기 🔗</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col gap-3">
        {/* 안내 배너 */}
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--color-k-navy-tint)", boxShadow: "var(--shadow-k-card)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--color-k-navy)" }}>
            💜 아이의 마음이 걱정될 때
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "#7C7CCC" }}>
            아래 기관에 연락하면 전문가의 도움을 받을 수 있어요.
            긴급한 상황이라면 바로 전화하세요.
          </p>
        </div>

        {/* 기관 카드 목록 */}
        {EXPERTS.map((expert) => (
          <div
            key={expert.id}
            className="bg-white rounded-2xl p-4"
            style={{ boxShadow: "var(--shadow-k-card)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-2xl shrink-0">{expert.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-900">{expert.name}</p>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
                      style={{ background: expert.badgeBg, color: expert.badgeColor }}
                    >
                      {expert.badge}
                    </span>
                  </div>
                  {expert.hours && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-k-text-secondary)" }}>
                      🕐 {expert.hours}
                    </p>
                  )}
                  {expert.url && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-k-text-secondary)" }}>
                      🌐 {expert.url}
                    </p>
                  )}
                </div>
              </div>

              {expert.number && (
                <a
                  href={`tel:${expert.number}`}
                  className="shrink-0 px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
                  style={{ background: expert.badgeColor }}
                >
                  <span>📞</span>
                  <span>{expert.number}</span>
                </a>
              )}
            </div>
          </div>
        ))}

        {/* 하단 안내 */}
        <p className="text-xs text-center pb-2" style={{ color: "var(--color-k-text-secondary)" }}>
          위 기관은 공공 상담 서비스로 무료 이용 가능합니다.
        </p>
      </div>

      <ParentTabBar />
    </div>
  );
}
