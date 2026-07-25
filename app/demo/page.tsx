"use client";

import Image from "next/image";
import Link from "next/link";
import { DemoFrame } from "./components/DemoFrame";

export default function DemoStartPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col items-center justify-center px-6 py-6 text-center overflow-hidden">
        <div className="mb-6">
          <Image
            src="/Images/logo/Logo.png"
            alt="내친구 케이"
            width={140}
            height={40}
            className="mx-auto object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        <div className="mb-6 flex items-center justify-center">
          <Image
            src="/Images/mascot/mascot-standing.png"
            alt="케이 마스코트"
            width={180}
            height={180}
            className="object-contain w-auto h-auto max-w-[180px] max-h-[180px]"
          />
        </div>

        <h1 className="text-xl font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          누구로 체험해 볼까요?
        </h1>
        <p className="text-sm mb-10" style={{ color: "#6b7280" }}>
          아이 모드와 부모 모드를 자유롭게 눌러보세요
        </p>

        <div className="w-full max-w-xs flex flex-col gap-4">
          <Link
            href="/demo/child"
            className="w-full py-4 rounded-2xl font-bold text-white text-base shadow-sm transition-transform active:scale-[0.98]"
            style={{ background: "var(--color-k-orange)" }}
          >
            아이 모드로 체험하기
          </Link>
          <Link
            href="/demo/parent"
            className="w-full py-4 rounded-2xl font-bold text-white text-base shadow-sm transition-transform active:scale-[0.98]"
            style={{ background: "var(--color-k-navy)" }}
          >
            부모 모드로 체험하기
          </Link>
        </div>
      </div>
    </DemoFrame>
  );
}
