import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_TO_PEER_AGE,
  resolveKPeerPersona,
  buildKPeerPersonaFragment,
  fetchKPeerPersonaForChild,
  fetchVerifiedChildIdentity,
} from "./kPeerPersona";

// 요청서(케이 동갑내기 페르소나) — 초1~6·중1 전체 매핑, 형제자매 간 분리, 학년 변경
// 즉시 반영, 학년 누락 fallback을 검증한다.

test("초1~6 학년은 각각 8~13살로 매핑된다", () => {
  for (let g = 1; g <= 6; g++) {
    const persona = resolveKPeerPersona(`${g}학년`);
    assert.equal(persona.hasGrade, true);
    assert.equal(persona.realGrade, g);
    assert.equal(persona.peerAge, GRADE_TO_PEER_AGE[g]);
    assert.equal(persona.peerAge, g + 7);
  }
});

test("중학교 1학년은 실제 학년 7·14살로 매핑되고, 내부 콘텐츠 대체값(초6)을 절대 쓰지 않는다", () => {
  const persona = resolveKPeerPersona("중학교 1학년");
  assert.equal(persona.hasGrade, true);
  assert.equal(persona.realGrade, 7);
  assert.equal(persona.peerAge, 14);
  assert.equal(persona.gradeLabel, "중학교 1학년");

  const fragment = buildKPeerPersonaFragment(persona);
  assert.ok(fragment.includes("중학교 1학년 14살"));
  assert.ok(!fragment.includes("6학년"), "중1을 초6으로 노출하면 안 된다(문항 호환 매핑값 비노출)");
});

test("순수 숫자형 grade 원문(레거시 형식, 예: \"1\")도 정상 매핑되고 자연스러운 라벨로 정규화된다", () => {
  const persona = resolveKPeerPersona("1");
  assert.equal(persona.hasGrade, true);
  assert.equal(persona.realGrade, 1);
  assert.equal(persona.peerAge, 8);
  assert.equal(persona.gradeLabel, "1학년", "숫자 원문 그대로 노출하면 부자연스러우니 학년 라벨로 정규화");
});

test("학년 정보가 없거나(null) 매핑 밖 값이면 나이를 추측하지 않는 안전 fallback을 쓴다", () => {
  for (const raw of [null, undefined, "", "고1", "알 수 없음"]) {
    const persona = resolveKPeerPersona(raw as any);
    assert.equal(persona.hasGrade, false);
    assert.equal(persona.peerAge, null);
    const fragment = buildKPeerPersonaFragment(persona);
    assert.ok(fragment.includes("우리 학년 정보를 먼저 확인해야 해"));
    assert.ok(!/\d살/.test(fragment), "학년 정보 없이 나이를 지어내면 안 된다");
  }
});

test("compact 모드는 15자 캡이 걸린 미션 리액션 경로용으로 훨씬 짧은 정체성 답변 예시를 준다", () => {
  for (const grade of ["2학년", "중학교 1학년"]) {
    const persona = resolveKPeerPersona(grade);
    const compact = buildKPeerPersonaFragment(persona, { compact: true });
    const full = buildKPeerPersonaFragment(persona);
    assert.ok(compact.length < full.length, "compact 지시문이 full보다 짧아야 한다");
    // 지시문 안의 예시 답변 자체가 15자를 넘으면 모델이 그대로 따라 하다 캡을 넘긴다.
    const exampleMatch = compact.match(/"나도[^"]*"/);
    assert.ok(exampleMatch, "compact 지시문에 예시 답변이 있어야 한다");
    assert.ok(exampleMatch![0].length <= 15, `compact 예시 답변이 15자를 넘으면 안 된다: ${exampleMatch![0]}`);
  }
});

test("compact 모드 — 학년 없음 fallback 예시도 15자 이내다", () => {
  const persona = resolveKPeerPersona(null);
  const compact = buildKPeerPersonaFragment(persona, { compact: true });
  const exampleMatch = compact.match(/"[^"]*"/);
  assert.ok(exampleMatch);
  assert.ok(exampleMatch![0].length <= 15);
});

test("페르소나 문구는 반말·동갑내기 정체성을 포함하고 존댓말/교사 말투를 쓰지 않는다", () => {
  const persona = resolveKPeerPersona("4학년");
  const fragment = buildKPeerPersonaFragment(persona);
  assert.ok(fragment.includes("우리 동갑이네"));
  assert.ok(fragment.includes("존댓말이나 선생님·상담사 말투가 아니라"));
  assert.ok(fragment.includes("지어내지 말고"), "실존하지 않는 개인사 지어내기 금지 규칙이 있어야 한다");
});

// ── 서버 조회 헬퍼: 형제자매 분리 + 학년 변경 즉시 반영 ──────────────
interface FakeChildRow {
  given_name: string | null;
  grade: string | null;
}

function makeFakeDb(rows: Record<string, FakeChildRow>) {
  return {
    from(table: string) {
      assert.equal(table, "child_profiles");
      return {
        select() {
          return {
            eq(_col: string, childId: string) {
              return {
                async maybeSingle() {
                  return { data: rows[childId] ?? null, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as any;
}

test("fetchKPeerPersonaForChild — 형제자매마다 완전히 분리된 학년을 반환한다", async () => {
  const db = makeFakeDb({
    "child-a": { given_name: "가영", grade: "3학년" },
    "child-b": { given_name: "나영", grade: "5학년" },
  });

  const personaA = await fetchKPeerPersonaForChild(db, "child-a");
  const personaB = await fetchKPeerPersonaForChild(db, "child-b");

  assert.equal(personaA.realGrade, 3);
  assert.equal(personaA.peerAge, 10);
  assert.equal(personaB.realGrade, 5);
  assert.equal(personaB.peerAge, 12);
});

test("fetchVerifiedChildIdentity — 존재하지 않는 childId는 이름 없이 안전 fallback 페르소나를 반환한다", async () => {
  const db = makeFakeDb({ "child-a": { given_name: "가영", grade: "3학년" } });
  const identity = await fetchVerifiedChildIdentity(db, "unknown-child");
  assert.equal(identity.givenName, null);
  assert.equal(identity.persona.hasGrade, false);
});

test("학년 변경은 다음 조회부터 즉시 반영된다(캐시하지 않음)", async () => {
  const rows: Record<string, FakeChildRow> = {
    "child-a": { given_name: "가영", grade: "3학년" },
  };
  const db = makeFakeDb(rows);

  const before = await fetchKPeerPersonaForChild(db, "child-a");
  assert.equal(before.realGrade, 3);

  rows["child-a"] = { given_name: "가영", grade: "4학년" };
  const after = await fetchKPeerPersonaForChild(db, "child-a");
  assert.equal(after.realGrade, 4);
  assert.equal(after.peerAge, 11);
});
