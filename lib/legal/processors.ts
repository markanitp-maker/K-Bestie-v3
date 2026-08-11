import type { OverseasProcessor } from "./types";

const PIPA_TRANSFER_BASIS =
  "「개인정보 보호법」 제28조의8제1항제3호에 따라, 이용자(법정대리인 포함)와 체결한 서비스 이용계약의 체결 및 이행을 위하여 반드시 필요한 처리위탁으로서 국외로 이전합니다. 이전에 관한 사항은 이 개인정보 처리방침에 공개합니다.";

export const OVERSEAS_PROCESSORS: readonly OverseasProcessor[] = [
  {
    id: "supabase",
    name: "Supabase Pte. Ltd.",
    country: "싱가포르(Supabase 공식 DPA상 데이터 수입자 법인 소재지)",
    contact: "privacy@supabase.io",
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
    legalBasis: PIPA_TRANSFER_BASIS,
    subprocessorsUrl: "https://supabase.com/legal/subprocessors",
  },
  {
    id: "vercel",
    name: "Vercel Inc.",
    country: "미국(Vercel Inc. 법인 소재지 및 호스팅 인프라 제공 지역)",
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
    legalBasis: PIPA_TRANSFER_BASIS,
    subprocessorsUrl: "https://vercel.com/legal/sub-processors",
  },
  {
    id: "google",
    name: "Google Cloud/Vertex AI 처리 인프라 (국내 계약·청구 주체: Google Cloud Korea LLC, Google Asia Pacific Pte. Ltd.의 국내 재판매사)",
    country: "Google Cloud Vertex AI의 global 자동 리전 선택 방식이 기본 적용되어 특정 국가로 고정되지 않으며, 서비스 구성에 따라 미국 등 여러 국가의 데이터센터가 사용될 수 있습니다.",
    contact: "https://policies.google.com/privacy 내 안내된 절차",
    purpose: ["AI 대화 생성", "AI 요청 맥락 처리", "음성 인식"],
    dataCategories: ["대화 텍스트", "AI 요청 Context", "음성 바이너리 스트림", "음성 인식에 필요한 정보"],
    transferTiming: "AI 대화 생성 또는 음성 인식 요청 시 실시간",
    transferMethod: "암호화된 네트워크를 통한 전송",
    retention: "K-Bestie는 음성 원본을 저장하지 않으며, 제공업체의 계약·서비스별 데이터 처리조건에 따른 기간",
    legalBasis: PIPA_TRANSFER_BASIS,
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
