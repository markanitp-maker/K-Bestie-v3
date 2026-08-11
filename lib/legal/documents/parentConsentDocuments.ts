import type { LegalDocument } from "../types";

export const LEGAL_COMMUNICATION_CHANNELS = {
  marketing: [] as string[],
  eventNotice: ["서비스 내 알림", "기기에서 별도로 허용한 웹 푸시"] as string[],
} as const;

export const PARENT_PII_CANDIDATE: LegalDocument = {
  key: "parent_pii",
  title: "보호자 개인정보 수집·이용 안내",
  version: "2026-08-11",
  effectiveDate: "2026-08-11",
  required: true,
  sections: [
    {
      id: "purpose",
      title: "1. 처리 목적",
      paragraphs: ["보호자 회원가입과 이용자 식별, 보호자 계정 관리, 자녀와의 관계 확인 및 보호자-자녀 연결, 서비스 제공, 중요 서비스 안내를 위해 처리합니다."],
    },
    {
      id: "data",
      title: "2. 처리 항목",
      paragraphs: [
        "필수 항목: 이름, 이메일, 자녀와의 관계, 인증에 필요한 계정정보, 법정대리인 확인정보(확인 여부와 확인일시).",
        "이메일 방식 가입 시 비밀번호는 인증 시스템을 통해 처리하며 평문으로 저장하지 않습니다.",
        "현재 휴대전화번호, 주소, 생년월일은 수집하지 않습니다.",
      ],
    },
    {
      id: "retention",
      title: "3. 보유 및 이용기간",
      paragraphs: ["계정 유지기간 동안 보유합니다. 회원탈퇴 신청 시 30일의 유예기간 이후 영구 파기하며, 관계 법령에서 별도 보존을 요구하는 정보는 해당 기간 동안 보존할 수 있습니다."],
    },
    {
      id: "refusal",
      title: "4. 동의 거부권",
      paragraphs: ["필수정보 처리에 동의하지 않을 권리가 있습니다. 다만 동의하지 않는 경우 보호자 계정 생성 및 서비스 이용이 제한될 수 있습니다."],
    },
  ],
};

export const MARKETING_CANDIDATE: LegalDocument = {
  key: "marketing",
  title: "마케팅 정보 수신 동의",
  version: "2026-08-11",
  effectiveDate: "2026-08-11",
  required: false,
  sections: [
    {
      id: "purpose",
      title: "1. 수신 목적",
      paragraphs: ["내친구 케이의 신규 기능, 이용 팁, 프로모션 등 광고성 정보를 안내하기 위한 선택 동의입니다. 필수 서비스·보안 안내는 본 동의와 구분하여 발송합니다."],
    },
    {
      id: "channels",
      title: "2. 수신 채널",
      paragraphs: [
        LEGAL_COMMUNICATION_CHANNELS.marketing.length > 0
          ? `현재 채널: ${LEGAL_COMMUNICATION_CHANNELS.marketing.join(", ")}. 기기 권한이 필요한 채널은 별도 허용 시에만 전달됩니다.`
          : "현재 마케팅 목적으로 활성화된 발송 채널은 없습니다. 채널을 활성화할 경우 실제 제공 채널과 수신 설정을 먼저 안내합니다. 구현되지 않은 SMS·전화 채널은 포함하지 않습니다.",
      ],
    },
    {
      id: "choice",
      title: "3. 선택권 및 철회",
      paragraphs: ["동의하지 않아도 기본 서비스를 이용할 수 있습니다. 동의 후에도 설정 또는 고객지원을 통해 수신 동의를 철회할 수 있습니다."],
    },
  ],
};

export const EVENT_NOTICE_CANDIDATE: LegalDocument = {
  key: "event_notice",
  title: "이벤트·혜택 알림 동의",
  version: "2026-08-11",
  effectiveDate: "2026-08-11",
  required: false,
  sections: [
    {
      id: "purpose",
      title: "1. 수신 목적",
      paragraphs: ["이벤트, 혜택 및 프로모션 성격의 알림을 제공하기 위한 선택 동의입니다. 계정·보안·서비스 운영에 꼭 필요한 안내와 혼합하지 않습니다."],
    },
    {
      id: "channels",
      title: "2. 수신 채널",
      paragraphs: [`현재 채널: ${LEGAL_COMMUNICATION_CHANNELS.eventNotice.join(", ")}. 기기 푸시는 운영체제 또는 브라우저 권한을 별도로 허용한 경우에만 전달됩니다.`],
    },
    {
      id: "choice",
      title: "3. 선택권 및 철회",
      paragraphs: ["동의하지 않아도 기본 서비스를 이용할 수 있습니다. 동의 후에도 설정 또는 기기의 알림 설정에서 수신을 중단할 수 있습니다."],
    },
  ],
};
