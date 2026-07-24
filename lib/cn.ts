/** Tailwind 조건부 클래스 결합 헬퍼. clsx/tailwind-merge 없이 falsy만 걸러 join한다. */

type ClassValue = string | false | null | undefined;

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(" ");
}
