import React from "react";

interface Props {
  guideText?: string;
}

export function TodayConversationGuide({ guideText }: Props) {
  if (!guideText || guideText.trim() === "") {
    return (
      <div className="bg-[#10315B] text-white rounded-[20px] p-5 shadow-sm mb-6">
        <h3 className="text-xs font-bold mb-2 opacity-80">오늘의 한마디</h3>
        <p className="text-sm font-medium leading-relaxed text-gray-200">
          아직 대화 가이드가 준비되지 않았어요.<br />
          아이가 케이와 이야기를 나누면 이곳에서 알려드릴게요.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#10315B] text-white rounded-[20px] p-5 shadow-sm mt-4 mb-6">
      <h3 className="text-xs font-bold mb-2 opacity-80">오늘의 한마디</h3>
      <p className="text-sm font-medium leading-relaxed">
        {guideText}
      </p>
    </div>
  );
}
