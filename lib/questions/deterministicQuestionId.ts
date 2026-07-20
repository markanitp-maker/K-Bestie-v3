import crypto from "crypto";

/**
 * group_code를 기반으로 결정론적 UUID를 생성합니다.
 */
export function getDeterministicQuestionId(groupCode: string): string {
  const hash = crypto
    .createHash("sha256")
    .update("kbestie-alpha-question:" + groupCode)
    .digest("hex");
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
