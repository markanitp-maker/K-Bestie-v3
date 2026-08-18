import React from "react";

interface Props {
  guideText?: string;
}

export function TodayConversationGuide({ guideText }: Props) {
  if (!guideText || guideText.trim() === "") {
    return (
      <div className="mb-2.5 rounded-[22px] bg-[#10315B] p-6 text-white shadow-sm">
        <h3 className="mb-2.5 text-[15px] font-bold text-white/90">오늘의 한마디</h3>
        <p className="text-[17px] font-semibold leading-[1.55] text-gray-100 sm:text-lg">
          아직 대화 가이드가 준비되지 않았어요.<br />
          아이가 케이와 이야기를 나누면 이곳에서 알려드릴게요.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-2.5 rounded-[22px] bg-[#10315B] p-6 text-white shadow-sm">
      <h3 className="mb-2.5 text-[15px] font-bold text-white/90">오늘의 한마디</h3>
      <p className="text-[17px] font-semibold leading-[1.55] sm:text-lg">
        {guideText}
      </p>
    </div>
  );
}
