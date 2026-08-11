import type { OverseasProcessor } from "./types";

// LEGAL_REVIEW_REQUIRED: 실제 K-Bestie 계약 주체, 선택 리전, 이전국가 및 개인정보보호법상
// 국외이전 근거를 법률자문자가 계약서/DPA와 대조해 확정해야 한다. 미확정 값은 추측하지 않는다.
export const OVERSEAS_PROCESSORS: readonly OverseasProcessor[] = [
  {
    id: "supabase",
    name: "Supabase, Inc.",
    country: "[LEGAL_REVIEW_REQUIRED] 실제 프로젝트 리전 및 재수탁 처리국 확인 필요",
    contact: "privacy@supabase.io (실제 계약상 연락처 재확인 필요)",
    purpose: ["이용자 인증", "데이터베이스 운영", "서비스 데이터 저장·관리"],
    dataCategories: [
      "보호자 이메일 및 인증정보",
      "아이 성명·학년·성별·내부 식별정보",
      "보호자-자녀 연결정보",
      "대화 텍스트",
      "리포트 및 요약·메모리 데이터",
    ],
    transferTiming: "회원가입, 로그인 및 서비스 데이터 저장·조회 시",
    transferMethod: "암호화된 네트워크를 통한 전송",
    retention: "K-Bestie의 데이터별 보존기간 또는 계약 종료 후 제공업체 삭제정책에 따른 기간",
    legalBasis: "[LEGAL_REVIEW_REQUIRED] 개인정보 보호법상 국외이전 근거와 동의 방식 확정 필요",
    subprocessorsUrl: "https://supabase.com/legal/subprocessors",
  },
  {
    id: "vercel",
    name: "Vercel Inc.",
    country: "[LEGAL_REVIEW_REQUIRED] 요청 처리 리전 및 재수탁 처리국 확인 필요",
    contact: "privacy@vercel.com",
    purpose: ["웹 애플리케이션 호스팅·배포", "Serverless/API Runtime", "운영 요청 및 로그 처리"],
    dataCategories: [
      "계정 식별정보",
      "서비스 요청 데이터",
      "요청에 포함되는 경우 대화 텍스트",
      "접속·요청 관련 정보",
    ],
    transferTiming: "웹 또는 API 요청 시 실시간",
    transferMethod: "암호화된 네트워크를 통한 전송",
    retention: "실시간 처리 후 Vercel 계약 및 운영 로그 설정에 따른 기간",
    legalBasis: "[LEGAL_REVIEW_REQUIRED] 개인정보 보호법상 국외이전 근거와 동의 방식 확정 필요",
    subprocessorsUrl: "https://security.vercel.com",
  },
  {
    id: "google",
    name: "[LEGAL_REVIEW_REQUIRED] 실제 계약 Google 법인명 확인 필요",
    country: "[LEGAL_REVIEW_REQUIRED] Gemini·Google Cloud STT 처리 리전 및 재수탁 처리국 확인 필요",
    contact: "[LEGAL_REVIEW_REQUIRED] 실제 Google Cloud 계약상 개인정보 문의처 확인 필요",
    purpose: ["AI 대화 생성", "AI 요청 맥락 처리", "음성 인식"],
    dataCategories: ["대화 텍스트", "AI 요청 Context", "음성 바이너리 스트림", "음성 인식에 필요한 정보"],
    transferTiming: "AI 대화 생성 또는 음성 인식 요청 시 실시간",
    transferMethod: "암호화된 네트워크를 통한 전송",
    retention: "K-Bestie는 음성 원본을 저장하지 않으며, 제공업체의 계약·서비스별 데이터 처리조건에 따른 기간",
    legalBasis: "[LEGAL_REVIEW_REQUIRED] 개인정보 보호법상 국외이전 근거와 아동 대화 처리 동의 문구 확정 필요",
    subprocessorsUrl: "https://cloud.google.com/terms/subprocessors",
  },
] as const;

export const DATA_PROCESSORS = [
  {
    id: "supabase",
    name: "Supabase",
    tasks: "인증, 데이터베이스 운영, 서비스 데이터 저장·관리",
  },
  {
    id: "vercel",
    name: "Vercel",
    tasks: "웹 호스팅, 배포, Serverless/API Runtime 및 운영 요청 처리",
  },
  {
    id: "google",
    name: "Google 계열 서비스",
    tasks: "AI 대화 생성, AI 처리 및 음성 인식",
  },
] as const;

export const formatOverseasProcessor = (processor: OverseasProcessor): string[] => [
  `이전받는 자: ${processor.name}`,
  `이전 국가: ${processor.country}`,
  `연락처: ${processor.contact}`,
  `이전 목적: ${processor.purpose.join(", ")}`,
  `이전 항목: ${processor.dataCategories.join(", ")}`,
  `이전 시기: ${processor.transferTiming}`,
  `이전 방법: ${processor.transferMethod}`,
  `보유·이용기간: ${processor.retention}`,
  `이전 근거: ${processor.legalBasis}`,
  ...(processor.subprocessorsUrl ? [`재수탁사 정보: ${processor.subprocessorsUrl}`] : []),
];
