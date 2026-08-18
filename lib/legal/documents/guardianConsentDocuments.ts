import type { LegalDocument } from "../types";

export const GUARDIAN_U14_CANDIDATE: LegalDocument = {
  key: "guardian_u14",
  title: "만 14세 미만 아동 법정대리인 동의",
  version: "2026-08-18",
  effectiveDate: "2026-08-18",
  required: true,
  sections: [
    {
      id: "subject",
      title: "1. 동의 대상과 절차",
      paragraphs: ["등록하려는 아이가 만 14세 미만이며 서비스 이용을 위해 법정대리인의 동의가 필요함을 확인합니다. 보호자 본인 계정 가입, 보호자 정보와 자녀와의 관계 입력, 회원가입 단계의 명시적 체크박스 동의와 동의 확인시각 저장 방식으로 확인합니다."],
    },
    {
      id: "scope",
      title: "2. 동의 범위",
      paragraphs: [
        "아이의 성·이름, 로그인 아이디, 비밀번호, 학년, 성별, 보호자-자녀 연결정보와 내부 식별정보를 처리하는 것에 동의합니다.",
        "아이와 케이의 대화 텍스트, 대화 맥락, 음성 인식 처리, 리포트·요약 인사이트 생성 및 자유대화에서 자발적으로 포함될 수 있는 사적·민감한 내용을 서비스 제공 목적 범위에서 처리하는 것에 동의합니다.",
      ],
    },
    {
      id: "voice",
      title: "3. 음성 처리",
      paragraphs: ["음성은 음성 인식을 위해 실시간 전달될 수 있습니다. K-Bestie 서버는 음성 원본을 별도 저장하지 않고 처리 목적 달성 후 즉시 폐기합니다. 인식된 텍스트는 대화 데이터 정책을 따릅니다."],
    },
    {
      id: "retention",
      title: "4. 보존 및 파기",
      paragraphs: ["계정정보는 회원탈퇴 신청 후 30일 유예 뒤 파기하고, raw/corrected 대화는 7일 후 파기합니다. 리포트·요약은 Care Start 6개월, Care Insight 기본 3년과 선택 연장기간, Care Premium 기본 5년 동안 보존합니다. Premium 무제한 선택 시 설정 유지기간 동안 보존합니다."],
    },
    {
      id: "external",
      title: "5. 외부 AI·클라우드 및 국외 처리",
      paragraphs: ["Supabase, Vercel에서 아이의 계정·대화·이용기록 관련 데이터가, Google 계열 서비스에서 아이의 대화·음성 관련 데이터가 서비스 제공에 필요한 범위로 처리될 수 있습니다. 수탁사별 이전받는 자와 국외이전 세부사항은 개인정보 처리방침의 국외이전 항목에서 확인할 수 있습니다."],
    },
    {
      id: "withdrawal",
      title: "6. 동의 거부·철회 및 탈퇴",
      paragraphs: ["동의를 거부하거나 설정에서 철회할 수 있습니다. 필수 동의를 거부하거나 철회하면 아이 계정의 채팅·미션·리포트·음성 등 서비스 이용이 제한됩니다. 회원탈퇴는 신청 후 30일 유예기간을 거쳐 관련 개인정보를 파기하며 법정 보존정보는 예외로 할 수 있습니다."],
    },
  ],
};

export const GUARDIAN_AUTHORITY_CANDIDATE: LegalDocument = {
  key: "guardian_authority",
  title: "법정대리인 또는 적법한 동의 권한 보유 확인",
  version: "2026-08-18",
  effectiveDate: "2026-08-18",
  required: true,
  sections: [
    {
      id: "confirmation",
      title: "1. 동의 권한 확인",
      paragraphs: ["사용자는 자신이 해당 아이의 법정대리인이거나 아이 개인정보 처리에 적법하게 동의할 권한을 보유하고 있음을 확인합니다."],
    },
    {
      id: "truthfulness",
      title: "2. 정확한 정보 제공",
      paragraphs: ["타인의 아이를 권한 없이 등록하거나 보호자-자녀 관계 등 허위 정보를 입력해서는 안 됩니다."],
    },
    {
      id: "verification",
      title: "3. 추가 확인",
      paragraphs: ["서비스는 필요한 경우 보호자-자녀 관계 및 동의권한 확인을 요청할 수 있습니다."],
    },
  ],
};
