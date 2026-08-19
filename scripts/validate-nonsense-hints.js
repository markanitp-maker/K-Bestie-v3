#!/usr/bin/env node
/**
 * 넌센스 퀴즈 1차 힌트 후보 검증 (요청서 010).
 *
 * 2026-08-20 Dev QA 실측: 500문항 중 489개의 hint_1 이 "정답은 N글자 안팎이에요." 라는
 * 글자수 템플릿이고 전부 존댓말이었다. 케이가 그대로 옮겨 말해 아이에게 존댓말을 쓰고,
 * 힌트에 문제에 대한 정보가 하나도 없어 아이가 맞힐 방법이 없었다.
 *
 * 새로 만든 힌트 후보를 사람이 489개 다 읽을 수는 없으므로, 확실히 틀린 두 가지 —
 * 정답 누출과 페르소나 위반 — 만은 기계로 잡는다. 나머지 재미 판단은 사람 몫이다.
 *
 * 사용법:
 *   node scripts/validate-nonsense-hints.js <후보.json> [<원본.json> ...]
 *
 * 후보 JSON 형식: [{ "id": "NQ0001", "hint_1": "..." }, ...]
 * 원본 JSON 형식: [{ "id": "NQ0001", "question": "...", "canonical_answer": "...", ... }, ...]
 *   원본을 주지 않으면 정답 누출 검사를 건너뛰지 않고 오류로 멈춘다.
 */

const fs = require('fs');

const HONORIFIC = /(예요|이에요|에요|해요|세요|어요|아요|네요|습니다|입니다|십니다)/;
const SYLLABLE_COUNT = /\d+\s*글자|[한두세네다섯여섯일곱여덟아홉열]\s*글자/;
const FIRST_SYLLABLE_REVEAL = /첫\s*글자|첫\s*소리|['‘"“][^'’"”]{1}['’"”]\s*(로|으로)\s*시작/;
const MIN_LEN = 6;
const MAX_LEN = 70;

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, '');
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

  for (const row of candidates) {
    const id = row?.id;
    const hint = String(row?.hint_1 ?? '').trim();
    const fail = (reason) => problems.push({ id, hint, reason });

    if (!id) {
      fail('id 가 없다');
      continue;
    }
    if (seenIds.has(id)) fail('같은 id 가 두 번 나왔다');
    seenIds.add(id);

    const original = source.get(id);
    if (!original) {
      fail('원본에 없는 id 다');
      continue;
    }

    if (!hint) {
      fail('힌트가 비었다');
      continue;
    }
    if (hint.length < MIN_LEN) fail(`너무 짧다(${hint.length}자)`);
    if (hint.length > MAX_LEN) fail(`너무 길다(${hint.length}자)`);

    // 1) 정답 누출 — 가장 치명적이다. 힌트가 답을 말하면 놀이가 아니다.
    //
    // 정답이 한 글자면 부분문자열 검사가 쓸모없다. "못" 은 "못 하는" 에, "1" 은 "12" 에
    // 들어가므로 정상 힌트가 전부 걸린다(실측: NQ0461 정답 "1" / 힌트 "12를 지나면").
    // 한 글자 정답은 따옴표로 감싸 드러낸 경우만 누출로 본다.
    const answer = normalize(original.canonical_answer);
    if (answer.length >= 2) {
      if (normalize(hint).includes(answer)) fail(`정답("${original.canonical_answer}")이 힌트에 들어 있다`);
    } else if (answer.length === 1) {
      const quoted = new RegExp(`['‘"“]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*['’"”]`);
      if (quoted.test(hint)) fail(`정답("${original.canonical_answer}")을 따옴표로 드러냈다`);
    }

    // 2) 첫 글자 공개 — 2차 힌트의 몫이고, 짧은 정답에서는 사실상 정답 공개다.
    if (FIRST_SYLLABLE_REVEAL.test(hint)) fail('첫 글자를 공개한다');

    // 3) 글자수 템플릿 — 이번에 없애려는 바로 그 힌트다.
    if (SYLLABLE_COUNT.test(hint)) fail('글자수만 알려주는 힌트다');

    // 4) 존댓말 — 케이는 아이의 또래 친구다.
    if (HONORIFIC.test(hint)) fail('존댓말이다');

    // 5) 문제를 그대로 되풀이하는 힌트는 정보가 0 이다.
    if (normalize(hint) === normalize(original.question)) fail('문제를 그대로 되풀이한다');
  }

  const missing = [...source.keys()].filter((id) => !seenIds.has(id));

  console.log(`후보 ${candidates.length}건 / 원본 ${source.size}건`);
  console.log(`누락 ${missing.length}건${missing.length ? ': ' + missing.slice(0, 10).join(', ') + (missing.length > 10 ? ' ...' : '') : ''}`);
  console.log(`문제 ${problems.length}건`);
  for (const p of problems.slice(0, 40)) {
    console.log(`  ✗ ${p.id} [${p.reason}] ${p.hint}`);
  }
  if (problems.length > 40) console.log(`  ... 그리고 ${problems.length - 40}건 더`);

  process.exit(problems.length > 0 || missing.length > 0 ? 1 : 0);
}

main();
