/**
 * Report Language Integrity Validation Module
 *
 * Validates report text and nested JSON structures to ensure text is written in natural Korean
 * and prevents unintended Japanese Hiragana, Katakana, and Japanese-context Kanji code-mixing.
 */

export interface LanguageIntegrityViolation {
  path: string; // JSON path where violation was detected, e.g. "weekly.summary" or "sections[2].text"
  kind: "hiragana" | "katakana" | "japanese_context";
  sample: string; // Surrounding context of violation (up to 40 chars)
}

export interface LanguageIntegrityResult {
  ok: boolean;
  violations: LanguageIntegrityViolation[];
}

/**
 * Unicode regular expressions for script detection.
 * Hiragana: U+3040 - U+309F
 * Katakana: U+30A0 - U+30FF (includes long vowel mark 'ー' U+30FC)
 * CJK Unified Ideographs: U+4E00 - U+9FFF, U+3400 - U+4DBF, U+F900 - U+FAFF
 */
const HIRAGANA_REGEX = /[\u3040-\u309F]+/g;
const KATAKANA_REGEX = /[\u30A0-\u30FF]+/g;

/**
 * Japanese Shinjitai (simplified/modern Japanese Kanji) and Kokuji (Japanese-origin Kanji)
 * that do not exist in Korean traditional Hanja (正字) usage.
 */
const JAPANESE_SPECIFIC_KANJI_REGEX =
  /[実気広学体図売駅転発対会国円込枠峠畑匂咲渋訳択読経済応変験関観楽団専厳続総絵鉄黒寿恵]/g;

/**
 * Japanese context patterns involving Kanji:
 * 1. Kanji adjacent to Hiragana or Katakana (e.g. の実力, 英語の, 実力だ)
 * 2. Kanji directly concatenated with Korean Hangul without spaces or punctuation (e.g. 영어實力, 實力향상)
 */
const KANJI_KANA_ADJACENT_REGEX =
  /([\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+[\u3040-\u309F\u30A0-\u30FF]+|[\u3040-\u309F\u30A0-\u30FF]+[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+)/g;

const HANGUL_KANJI_DIRECT_REGEX =
  /([가-힣][\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+|[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+[가-힣])/g;

/**
 * Extracts a substring of up to 40 characters centered around the match index.
 */
function extractSample(text: string, startIndex: number, matchLength: number): string {
  const maxSampleLen = 40;
  if (text.length <= maxSampleLen) {
    return text;
  }
  const matchCenter = startIndex + Math.floor(matchLength / 2);
  const half = Math.floor(maxSampleLen / 2);
  let start = Math.max(0, matchCenter - half);
  let end = Math.min(text.length, start + maxSampleLen);
  if (end - start < maxSampleLen && start > 0) {
    start = Math.max(0, end - maxSampleLen);
  }
  return text.slice(start, end);
}

/**
 * Inspects a single text string for language integrity violations.
 *
 * Detection rules:
 * 1. Hiragana: Any Hiragana character is detected as kind="hiragana".
 * 2. Katakana: Any Katakana character (including 'ー') is detected as kind="katakana".
 * 3. Japanese-context Kanji: Detected as kind="japanese_context" when:
 *    - Japanese Shinjitai / Kokuji characters appear outside parenthetical annotations.
 *    - Kanji is directly adjacent to Hiragana or Katakana.
 *    - Kanji is directly concatenated with Hangul characters without spaces.
 *    - Two or more consecutive Kanji appear within a Korean sentence context.
 *    Note: Parenthetical Hanja annotations (e.g. "서아(書兒)") are allowed as legitimate Korean usage.
 *
 * @param text The string to inspect.
 * @param path Optional JSON path for reporting violations (defaults to "$").
 * @returns Array of detected LanguageIntegrityViolation objects.
 */
export function inspectReportText(
  text: string,
  path = "$"
): LanguageIntegrityViolation[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const violations: LanguageIntegrityViolation[] = [];

  // 1. Hiragana detection
  let match: RegExpExecArray | null;
  while ((match = HIRAGANA_REGEX.exec(text)) !== null) {
    violations.push({
      path,
      kind: "hiragana",
      sample: extractSample(text, match.index, match[0].length),
    });
  }

  // 2. Katakana detection
  while ((match = KATAKANA_REGEX.exec(text)) !== null) {
    violations.push({
      path,
      kind: "katakana",
      sample: extractSample(text, match.index, match[0].length),
    });
  }

  // 3. Japanese-context Kanji detection
  // Mask legitimate parenthetical Hanja annotations (e.g., "서아(書兒)", "김서현（金瑞賢）")
  // Parentheses containing ONLY Hanja, spaces, commas, and dots are masked with spaces.
  let maskedText = text;
  maskedText = maskedText.replace(
    /[(\uFF08][\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\s,·・]+[)\uFF09]/g,
    (m) => " ".repeat(m.length)
  );

  const reportedKanjiSpans: Array<{ start: number; end: number }> = [];

  const addJapaneseContextViolation = (
    startIndex: number,
    endIndex: number,
    length: number
  ) => {
    const overlaps = reportedKanjiSpans.some(
      (span) => Math.max(span.start, startIndex) < Math.min(span.end, endIndex)
    );
    if (!overlaps) {
      reportedKanjiSpans.push({ start: startIndex, end: endIndex });
      violations.push({
        path,
        kind: "japanese_context",
        sample: extractSample(text, startIndex, length),
      });
    }
  };

  // 3a. Japanese Shinjitai / Kokuji
  while ((match = JAPANESE_SPECIFIC_KANJI_REGEX.exec(maskedText)) !== null) {
    addJapaneseContextViolation(
      match.index,
      match.index + match[0].length,
      match[0].length
    );
  }

  // 3b. Kanji adjacent to Hiragana or Katakana
  while ((match = KANJI_KANA_ADJACENT_REGEX.exec(maskedText)) !== null) {
    addJapaneseContextViolation(
      match.index,
      match.index + match[0].length,
      match[0].length
    );
  }

  // 3c. Hangul directly concatenated with Kanji without whitespace
  while ((match = HANGUL_KANJI_DIRECT_REGEX.exec(maskedText)) !== null) {
    addJapaneseContextViolation(
      match.index,
      match.index + match[0].length,
      match[0].length
    );
  }

  // 3d. 2 or more consecutive Kanji in a Korean sentence context
  const hasKorean = /[가-힣]/.test(text);
  if (hasKorean) {
    const KANJI_MULTI_REGEX =
      /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]{2,}/g;
    while ((match = KANJI_MULTI_REGEX.exec(maskedText)) !== null) {
      addJapaneseContextViolation(
        match.index,
        match.index + match[0].length,
        match[0].length
      );
    }
  }

  return violations;
}

/**
 * Recursively validates an entire report structure (nested objects, arrays, and primitives)
 * for language integrity.
 *
 * Traversal rules:
 * - Traverses all nested objects and arrays up to depth limit (20).
 * - Skips non-string primitive values (number, boolean, null, undefined).
 * - Tracks visited object references to prevent infinite loops from circular references.
 * - Formats path as `a.b[0].c` for nested fields, or `$` for top-level strings.
 *
 * @param value The report value or structure to validate.
 * @returns LanguageIntegrityResult with overall `ok` boolean and list of violations.
 */
export function validateReportLanguageIntegrity(
  value: unknown
): LanguageIntegrityResult {
  const violations: LanguageIntegrityViolation[] = [];
  const seen = new Set<unknown>();

  function walk(current: unknown, currentPath: string, depth: number) {
    if (depth > 20) {
      return;
    }
    if (current === null || current === undefined) {
      return;
    }

    if (typeof current === "string") {
      const textViolations = inspectReportText(current, currentPath || "$");
      violations.push(...textViolations);
      return;
    }

    if (typeof current !== "object") {
      return;
    }

    if (seen.has(current)) {
      return;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
        walk(current[i], itemPath, depth + 1);
      }
    } else {
      for (const [key, val] of Object.entries(
        current as Record<string, unknown>
      )) {
        const fieldPath = currentPath ? `${currentPath}.${key}` : key;
        walk(val, fieldPath, depth + 1);
      }
    }
  }

  walk(value, "", 0);

  return {
    ok: violations.length === 0,
    violations,
  };
}
