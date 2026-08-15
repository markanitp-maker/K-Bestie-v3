"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PlayFrame } from "@/components/play/PlayFrame";

function QuizmasterWrapperContent() {
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();
  const resumeAttemptId = searchParams.get("resume");

  const iframeSrc = resumeAttemptId
    ? `/play/quiz?resume=${encodeURIComponent(resumeAttemptId)}`
    : "/play/quiz";

  return (
    <PlayFrame
      title="퀴즈마스터"
      src={iframeSrc}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}

export default function QuizmasterWrapperPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-white" />}>
      <QuizmasterWrapperContent />
    </Suspense>
  );
}
