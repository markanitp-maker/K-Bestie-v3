// 프롬프트에 들어갈 텍스트에서 제어문자(개행/탭/NUL 등)만 공백으로 치환한다.
// 정규식 유니코드 이스케이프 범위 리터럴 대신 코드포인트 비교로 구현 — 이스케이프
// 표기가 도구 전송 과정에서 손상되는 문제를 피하기 위함.
export function stripControlChars(value: string): string {
  return Array.from(value)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : ch;
    })
    .join("");
}
