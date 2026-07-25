export function getVocativeParticle(name: string | null | undefined): string {
  const cleanName = (name ?? "").trim();
  if (!cleanName) return "야"; // 기본값
  const lastChar = cleanName.charCodeAt(cleanName.length - 1);
  // 한글 완성형 음절 범위: 0xAC00(가) ~ 0xD7A3(힣)
  if (lastChar < 0xac00 || lastChar > 0xd7a3) return "야";
  const hasJongseong = (lastChar - 0xac00) % 28 !== 0;
  return hasJongseong ? "아" : "야";
}

export function appendVocative(name: string | null | undefined): string {
  const cleanName = (name ?? "").trim();
  if (!cleanName) return "";
  return `${cleanName}${getVocativeParticle(cleanName)}`;
}
