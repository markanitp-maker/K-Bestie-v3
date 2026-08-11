import type { LegalDocument } from "../types";

export const CHILD_PII_CANDIDATE: LegalDocument = {
  key: "child_pii",
  title: "아이 개인정보 수집·이용 동의",
  version: "2026-08-11",
  effectiveDate: "2026-08-11",
  required: true,
  sections: [
    {
      id: "purpose",
      title: "1. 처리 목적",
      paragraphs: ["아이 계정 생성, 보호자-자녀 연결, AI 친구 케이와의 대화 서비스와 음성 인식, 일일·주간 등 부모 리포트 생성, 서비스 운영, 품질 및 안정성 확보를 위해 처리합니다."],
    },
    {
      id: "account-data",
      title: "2. 계정정보",
      paragraphs: [
        "성, 이름, 로그인 아이디, 비밀번호, 학년, 성별, 보호자-자녀 연결정보를 처리합니다. 비밀번호는 인증 시스템에서 처리하며 평문으로 저장하지 않습니다.",
        "현재 관심사, 생년월일, 이메일, 휴대전화번호는 아이 개인정보 항목으로 수집하지 않습니다.",
      ],
    },
    {
      id: "conversation-data",
      title: "3. 대화 데이터",
      reviewRequired: true,
      paragraphs: [
        "아이가 케이와 나눈 대화 텍스트, 대화 관련 서비스 이용정보, 리포트 생성에 필요한 대화 맥락을 처리합니다.",
        "[LEGAL_REVIEW_REQUIRED] 회사는 아이에게 민감정보 입력을 요구하지 않습니다. 다만 아이가 자유대화 과정에서 건강, 고민, 학교·친구 관계 등 사적인 내용을 자발적으로 포함할 수 있으며, 회사는 서비스 제공에 필요한 범위를 넘어 해당 정보를 별도의 목적으로 이용하지 않습니다. 이 우발적 민감정보 및 아동 자유대화의 처리 근거·동의 범위는 법률 검토가 필요합니다.",
      ],
    },
    {
      id: "voice",
      title: "4. 음성 처리",
      paragraphs: ["음성 기반 대화 과정에서 음성 데이터가 음성 인식 서비스를 통해 실시간 처리될 수 있습니다. 음성 원본은 K-Bestie 서버에 별도 저장하지 않으며 음성 인식 목적 달성 후 즉시 폐기합니다(보존기간 0초). 음성 인식 결과인 텍스트는 대화 데이터 정책에 따라 처리될 수 있습니다."],
    },
    {
      id: "retention",
      title: "5. 보유 및 이용기간",
      paragraphs: [
        "계정 기본정보: 회원탈퇴 신청 후 30일 유예기간 경과 뒤 영구 파기.",
        "raw 대화 및 corrected 대화: 각 7일 후 파기.",
        "Care Start 리포트·요약: 6개월.",
        "Care Insight 리포트·요약: 기본 3년 및 선택된 연장기간.",
        "Care Premium 리포트·요약: 기본 5년. 무제한 보존을 선택한 이용자는 해당 설정을 유지하는 기간 동안 보존.",
        "관계 법령에서 별도 보존을 요구하는 정보는 법정 기간 동안 보존할 수 있습니다.",
      ],
    },
    {
      id: "external-processing",
      title: "6. 외부 AI·클라우드 처리",
      reviewRequired: true,
      paragraphs: ["[LEGAL_REVIEW_REQUIRED] 서비스 제공을 위해 Supabase, Vercel, Google 계열 서비스를 이용하며, 대화 텍스트·AI 요청 맥락·음성 스트림 등이 필요한 범위에서 국외 처리될 수 있습니다. 수탁사별 법인명, 이전국가, 연락처와 법적 근거는 개인정보 처리방침의 국외이전 항목 및 실제 계약을 기준으로 최종 확정해야 합니다."],
    },
    {
      id: "refusal",
      title: "7. 동의 거부권",
      paragraphs: ["법정대리인은 아이 개인정보 처리에 대한 동의를 거부할 수 있습니다. 다만 필수 개인정보 처리에 동의하지 않을 경우 아이 계정 생성 및 서비스 이용이 제한될 수 있습니다."],
    },
  ],
};
