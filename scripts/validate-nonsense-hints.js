#!/usr/bin/env node
/**
 * 넌센스 퀴즈 힌트 검증 (요청서 016 §4).
 *
 * 2026-08-20 실측으로 두 세대의 문제를 겪었다.
 *
 * 1세대 — 500문항 중 489개의 hint_1 이 "정답은 N글자 안팎이에요." 라는 글자수
 * 템플릿이고 전부 존댓말이었다. 힌트에 문제를 풀 실마리가 하나도 없었다.
 *
 * 2세대 — 내용 힌트로 바꿨더니 이번엔 **정답 조립법을 그대로 알려줬다.**
 *   "왕이 넘어지면?" (킹콩) → "임금을 뜻하는 영단어 뒤에 쿵 넘어지는 소리를 붙여 봐"
 *   "쥐 네 마리가 모이면?" (쥐포) → "숫자 4를 뜻하는 영단어를 뒤에 붙여 봐"
 * 대표님 QA 에서 이게 걸렸다. 맞히는 재미가 남지 않는다.
 *
 * 그래서 이 검증기는 **조립법 누출**까지 잡는다. 힌트는 답이 어느 쪽에 있는지
 * 좁혀 주기만 해야 하고, 어떻게 만드는지 알려주면 안 된다.
 *
 * 사람이 500문항을 다 읽을 수는 없으므로 기계로 잡을 수 있는 것만 잡는다 —
 * 정답 누출, 조립법 누출, 첫 글자 공개, 글자수 안내, 존댓말. 재미 판단은 사람 몫이다.
 *
 * 사용법:
 *   node scripts/validate-nonsense-hints.js <후보.json> <원본.json> [...]
 *
 * 후보 JSON: [{ "id": "NQ0001", "hint_1": "...", "hint_2": "..." }, ...]
 *   hint_2 는 없으면 검사하지 않는다(1차만 바꿀 때도 쓸 수 있게).
 * 원본 JSON: [{ "id": "NQ0001", "question": "...", "canonical_answer": "...", ... }, ...]
 */

const fs = require('fs');

const HONORIFIC = /(예요|이에요|에요|해요|세요|어요|아요|네요|습니다|입니다|십니다)/;
const SYLLABLE_COUNT = /\d+\s*글자|[한두세네다섯여섯일곱여덟아홉열]\s*글자|글자\s*수/;
const FIRST_SYLLABLE_REVEAL = /첫\s*글자|첫\s*소리|['‘"“][^'’"”]{1}['’"”]\s*(로|으로)\s*시작/;

/**
 * 조립법 누출. "무엇 뒤에 무엇을 붙여라" 처럼 만드는 방법을 알려주는 힌트다.
 * 아이가 스스로 떠올릴 여지를 남기지 않는다.
 */
//
// 오탐을 피하려면 "낱말을 조립하라는 지시" 와 "사물을 설명하는 말" 을 갈라야 한다.
// 실측 오탐(2026-08-20): "문장 끝에 붙이는 부호야"(물음표), "팔 끝에 붙어 있고"(손),
// "우표를 붙여 우체통에 넣는"(편지), "종이에 줄여 나타낸 도표"(지도).
// 이들은 사물 설명이다. 조립 지시는 **말·소리·글자를 대상으로** 한다는 점이 다르다.
const RECIPE_LEAK = [
  // 말/소리/글자/이름을 붙이거나 합치라는 지시
  /(?:말|소리|글자|단어|이름|낱말)[^.!?]{0,12}(?:뒤|앞|끝|처음)에[^.!?]{0,12}(?:붙|이어|더해|넣)/,
  /(?:뒤|앞|끝|처음)에[^.!?]{0,12}(?:말|소리|글자|단어|이름|낱말)[^.!?]{0,8}(?:을|를)?\s*(?:붙|이어|더해|넣)/,
  /(?:말|소리|글자|단어|이름|낱말)[^.!?]{0,12}(?:합쳐|합치면|더하면|이어\s*붙|붙여\s*(?:봐|보면|읽))/,
  // 거꾸로 읽기·줄임말 같은 조작 지시
  /거꾸로\s*(?:읽|바꿔|해)/,
  /(?:줄인\s*말|줄여\s*(?:봐|보면|말하면))/,
  // 다른 언어/문자로 바꾸라는 지시
  /(?:영단어|영어로|영어\s*단어|한자로|한자\s*)/,
  /(?:소리|말)(?:를|을)\s*흉내/,
  /(?:앞글자|뒷글자|앞부분|뒷부분)(?:를|을|만)?\s*(?:붙|합|따|모으|읽)/,
];

const MIN_LEN = 8;
const MAX_LEN = 70;

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, '');
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 정답 누출 검사. 한 글자 정답은 부분문자열 검사가 무의미하므로 따옴표 노출만 본다. */
function leaksAnswer(hint, answer, rawAnswer) {
  if (!answer) return null;
  if (answer.length >= 2) {
    if (normalize(hint).includes(answer)) return `정답("${rawAnswer}")이 들어 있다`;
    // 정답이 3글자 이상이면 연속 2글자만 나와도 사실상 공개다.
    if (answer.length >= 3) {
      for (let i = 0; i + 2 <= answer.length; i += 1) {
        const pair = answer.slice(i, i + 2);
        if (normalize(hint).includes(pair)) return `정답의 연속 두 글자("${pair}")가 들어 있다`;
      }
    }
    return null;
  }
  const quoted = new RegExp(`['‘"“]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*['’"”]`);
  return quoted.test(hint) ? `정답("${rawAnswer}")을 따옴표로 드러냈다` : null;
}

function checkHint(hint, original, label, problems, id) {
  const fail = (reason) => problems.push({ id, hint, reason: `${label}: ${reason}` });
  if (!hint) {
    fail('비었다');
    return;
  }
  if (hint.length < MIN_LEN) fail(`너무 짧다(${hint.length}자)`);
  if (hint.length > MAX_LEN) fail(`너무 길다(${hint.length}자)`);

  const answer = normalize(original.canonical_answer);
  const leak = leaksAnswer(hint, answer, original.canonical_answer);
  if (leak) fail(leak);

  if (FIRST_SYLLABLE_REVEAL.test(hint)) fail('첫 글자를 공개한다');
  if (SYLLABLE_COUNT.test(hint)) fail('글자수를 알려준다');
  if (HONORIFIC.test(hint)) fail('존댓말이다');

  const recipe = RECIPE_LEAK.find((pattern) => pattern.test(hint));
  if (recipe) fail(`정답 조립법을 알려준다 (${recipe.source})`);

  if (normalize(hint) === normalize(original.question)) fail('문제를 그대로 되풀이한다');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('사용법: node scripts/validate-nonsense-hints.js <후보.json> <원본.json> [...]');
    process.exit(1);
  }

  const candidates = loadJson(args[0]);
  const source = new Map();
  for (const file of args.slice(1)) {
    for (const row of loadJson(file)) source.set(row.id, row);
  }

  const problems = [];
  const seenIds = new Set();
  let checkedHint2 = 0;

  for (const row of candidates) {
    const id = row?.id;
    if (!id) {
      problems.push({ id: '(없음)', hint: '', reason: 'id 가 없다' });
      continue;
    }
    if (seenIds.has(id)) problems.push({ id, hint: '', reason: '같은 id 가 두 번 나왔다' });
    seenIds.add(id);

    const original = source.get(id);
    if (!original) {
      problems.push({ id, hint: '', reason: '원본에 없는 id 다' });
      continue;
    }

    checkHint(String(row.hint_1 ?? '').trim(), original, '1차', problems, id);

    const hint2 = row.hint_2 === undefined ? null : String(row.hint_2 ?? '').trim();
    if (hint2 !== null) {
      checkedHint2 += 1;
      checkHint(hint2, original, '2차', problems, id);
      // 2차가 1차와 같으면 두 번째 기회가 없는 것과 같다.
      if (normalize(hint2) === normalize(String(row.hint_1 ?? ''))) {
        problems.push({ id, hint: hint2, reason: '2차: 1차와 같다' });
      }
    }
  }

  const missing = [...source.keys()].filter((id) => !seenIds.has(id));

  console.log(`후보 ${candidates.length}건 / 원본 ${source.size}건 / 2차 검사 ${checkedHint2}건`);
  console.log(`누락 ${missing.length}건${missing.length ? ': ' + missing.slice(0, 10).join(', ') + (missing.length > 10 ? ' ...' : '') : ''}`);
  console.log(`문제 ${problems.length}건`);
  for (const p of problems.slice(0, 40)) {
    console.log(`  ✗ ${p.id} [${p.reason}] ${p.hint}`);
  }
  if (problems.length > 40) console.log(`  ... 그리고 ${problems.length - 40}건 더`);

  process.exit(problems.length > 0 || missing.length > 0 ? 1 : 0);
}

main();
