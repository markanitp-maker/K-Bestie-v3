// 053: child_approval_requests.encrypted_password(pgp_sym_encrypt) 암복호화에 쓰는 대칭키.
// 키 자체는 DB에 저장되지 않고 서버 환경변수로만 존재하며, RPC 호출 시점에 매 요청마다
// Node에서 전달한다 — 다른 필수 서버 전용 env var(getSupabaseServiceRoleKey 등)와 동일하게
// 미설정 시 즉시 실패(fail-closed)한다.
export function getChildApprovalEncryptionKey(): string {
  const key = process.env.CHILD_APPROVAL_PASSWORD_ENC_KEY;
  if (!key) {
    throw new Error("Fatal: CHILD_APPROVAL_PASSWORD_ENC_KEY이(가) 설정되지 않음");
  }
  return key;
}
