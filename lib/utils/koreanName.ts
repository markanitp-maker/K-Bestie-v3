export function toKoreanVocative(givenName: string | null | undefined): string {
  const name = (givenName ?? "").trim();
  if (!name) return "";
  const lastChar = name.charCodeAt(name.length - 1);
  // 한글 완성형 음절 범위: 0xAC00(가) ~ 0xD7A3(힣)
  if (lastChar < 0xac00 || lastChar > 0xd7a3) return name;
  const hasJongseong = (lastChar - 0xac00) % 28 !== 0;
  return `${name}${hasJongseong ? "아" : "야"}`;
}
