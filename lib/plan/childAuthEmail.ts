// username → Supabase Auth 내부 이메일 (절대 노출 금지). member_accounts 발급 흐름과
// 아이 승인 처리 흐름(053) 양쪽에서 공유하는 단일 정의.
const FAKE_DOMAIN = "kbestie.local";

export const toAuthEmail = (username: string) => `${username}@${FAKE_DOMAIN}`;
