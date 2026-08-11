import { DATA_PROCESSORS, formatOverseasProcessor, OVERSEAS_PROCESSORS } from "../processors";
import type { LegalDocument } from "../types";

export const PRIVACY_POLICY_CANDIDATE: LegalDocument = {
  key: "privacy_policy",
  title: "내친구 케이 개인정보 처리방침",
  version: "2026-08-11",
  effectiveDate: "2026-08-11",
  required: false,
  sections: [
    {
      id: "data-and-purpose",
      title: "제1조 처리하는 개인정보의 항목과 목적",
      paragraphs: [
        "보호자: 이름, 이메일, 자녀와의 관계, 인증·계정정보 및 법정대리인 확인정보를 회원가입, 이용자 식별, 계정 관리, 보호자-자녀 연결과 중요 안내를 위해 처리합니다.",
        "아이: 성·이름, 로그인 아이디, 비밀번호, 학년, 성별, 보호자-자녀 연결정보와 내부 식별정보를 아이 계정 생성과 서비스 제공을 위해 처리합니다. 비밀번호는 인증 시스템에서 처리하며 평문 저장하지 않습니다.",
        "서비스 이용 과정: 대화 텍스트, 서비스 이용기록, 접속·요청 관련 정보, 리포트 및 요약 인사이트를 AI 대화, 리포트 생성, 서비스 운영·보안·품질 확보를 위해 처리합니다.",
        "음성: 음성 인식을 위해 실시간 처리하며, K-Bestie 서버에 원본을 저장하지 않고 목적 달성 후 즉시 폐기합니다(보존기간 0초).",
        "현재 보호자의 휴대전화번호·주소·생년월일 및 아이의 관심사·생년월일·이메일·휴대전화번호는 수집하지 않습니다.",
      ],
    },
    {
      id: "sensitive-conversation",
      title: "제2조 자유대화 중 사적·민감한 내용",
      reviewRequired: true,
      paragraphs: ["[LEGAL_REVIEW_REQUIRED] 회사는 이용자에게 민감정보 입력을 요구하지 않습니다. 다만 아이 등 이용자가 자유대화 과정에서 건강, 고민, 학교·친구 관계 등 자신의 이야기를 자발적으로 포함할 수 있으며, 회사는 서비스 제공에 필요한 범위를 넘어 해당 정보를 별도의 목적으로 이용하지 않습니다. 우발적 민감정보와 아동 자유대화의 처리 근거·보호조치는 법률 검토 후 확정해야 합니다."],
    },
    {
      id: "children",
      title: "제3조 만 14세 미만 아동의 개인정보",
      reviewRequired: true,
      paragraphs: ["보호자 계정 생성, 보호자 정보 및 자녀와의 관계 입력, 회원가입 단계의 명시적 동의, 동의 확인시각 저장 절차를 적용합니다. 카드·FAX·전화·SMS 확인 방식은 사용하지 않습니다. [LEGAL_REVIEW_REQUIRED] 현재 확인 절차가 법정대리인 동의 확인 요건을 충족하는지 법률 검토가 필요합니다."],
    },
    {
      id: "retention",
      title: "제4조 개인정보의 보유기간과 파기",
      paragraphs: [
        "보호자·아이 계정정보: 회원탈퇴 신청 후 30일 유예기간 경과 뒤 파기.",
        "음성 원본: 저장하지 않음, 처리 후 즉시 폐기.",
        "raw 대화: 7일. corrected 대화: 7일.",
        "Care Start 리포트·요약: 6개월.",
        "Care Insight 리포트·요약: 기본 3년과 선택 연장기간.",
        "Care Premium 리포트·요약: 기본 5년. 무제한 보존 선택 시 설정 유지기간 동안 보존.",
        "기타 법정보존정보: 관련 법령에서 정한 기간.",
        "보존기간이 끝나거나 처리 목적이 달성된 개인정보는 복구하기 어렵도록 삭제합니다. 전자적 파일은 시스템의 삭제 절차에 따라 파기합니다.",
      ],
    },
    {
      id: "delegation",
      title: "제5조 개인정보 처리업무의 위탁",
      paragraphs: [
        ...DATA_PROCESSORS.map((processor) => `${processor.name}: ${processor.tasks}.`),
        "Vercel의 Serverless/API Runtime을 통한 요청 데이터의 실시간 경유와 Supabase 데이터베이스의 서비스 데이터 저장은 구분됩니다. Vercel에는 요청 처리와 운영에 필요한 범위를 넘어 서비스 데이터가 데이터베이스 형태로 영구 저장된다고 표현하지 않습니다.",
      ],
    },
    {
      id: "overseas-transfer",
      title: "제6조 개인정보의 국외이전",
      reviewRequired: true,
      paragraphs: [
        "[LEGAL_REVIEW_REQUIRED] 아래 내용은 실제 데이터 흐름을 기준으로 작성한 개발 후보이며, 각 업체의 실제 계약·DPA, 프로젝트 리전, 법인명, 이전국가, 연락처 및 개인정보 보호법상 이전 근거를 확인한 뒤 확정해야 합니다.",
        ...OVERSEAS_PROCESSORS.flatMap((processor) => [`[${processor.id}]`, ...formatOverseasProcessor(processor)]),
      ],
    },
    {
      id: "rights",
      title: "제7조 이용자와 법정대리인의 권리 및 행사방법",
      paragraphs: ["이용자와 법정대리인은 개인정보 열람, 정정, 삭제, 처리정지, 동의 철회 및 회원탈퇴를 요청할 수 있습니다. 아이 정보 수정·삭제와 법정대리인 동의 철회 및 회원탈퇴는 보호자 설정 화면에서 할 수 있으며, 그 밖의 요청은 고객지원 또는 개인정보 보호책임자 이메일로 접수할 수 있습니다. 본인 또는 적법한 대리인 확인이 필요한 경우 확인 절차를 요청할 수 있습니다."],
    },
    {
      id: "cookies",
      title: "제8조 쿠키·저장소 및 행태정보",
      paragraphs: ["회사는 온라인 맞춤형 광고 제공을 목적으로 이용자의 행태정보를 수집·이용하지 않습니다. 로그인 유지, 기능 제공, 보안 및 서비스 품질을 위해 쿠키, 브라우저 저장소와 접속·요청 기록을 필요한 범위에서 사용할 수 있으며 브라우저 설정에서 쿠키 저장을 제한할 수 있습니다. 제한 시 로그인 유지 등 일부 기능이 동작하지 않을 수 있습니다."],
    },
    {
      id: "security",
      title: "제9조 개인정보의 안전성 확보조치",
      paragraphs: ["개인정보 접근권한 관리, 인증 및 접근통제, 전송구간 보호, 비밀정보의 서버 환경변수 관리, 로그 접근 제한, 개인정보 최소처리와 보존기간 경과 후 파기 등 현재 서비스에 적용된 범위의 보호조치를 시행합니다."],
    },
    {
      id: "officer",
      title: "제10조 개인정보 보호책임자",
      reviewRequired: true,
      paragraphs: ["성명: 안형진", "직책: 대표", "이메일: hjan21@outlook.com", "[LEGAL_REVIEW_REQUIRED] 실제 사업자·운영주체 표시와 직책, 추가 신고·연락처 기재 필요 여부를 확정해야 합니다."],
    },
    {
      id: "changes",
      title: "제11조 처리방침의 변경",
      paragraphs: ["본 처리방침을 변경하는 경우 시행일과 주요 변경사항을 서비스 내 공지 등 적절한 방법으로 안내합니다. 이 2026-08-11 문서는 개발 후보이며 법률 검토와 대표 승인 전 Production에 공개하거나 활성화하지 않습니다."],
    },
  ],
};
