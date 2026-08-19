// 요청서 013 §7-2, §7-3, §6, 시나리오 C·D — 아이 발화 추출 규칙 고정.

import assert from "node:assert/strict";
import test from "node:test";

import {
  extractGrowthCandidates,
  inferAskedMeasurementType,
  type GrowthUtteranceCandidate,
} from "./utteranceExtraction";

const extract = (utterance: string, previousKUtterance?: string): GrowthUtteranceCandidate[] =>
  extractGrowthCandidates({ utterance, previousKUtterance });

const one = (utterance: string, previousKUtterance?: string): GrowthUtteranceCandidate => {
  const result = extract(utterance, previousKUtterance);
  assert.equal(result.length, 1, `후보가 1개가 아니다: ${JSON.stringify(result)}`);
  return result[0];
};

// ── §7-2 키 추출 ──────────────────────────────────────────────

test("013 §7-2: '키 142cm야' → height 142", () => {
  const candidate = one("키 142cm야");
  assert.equal(candidate.measurementType, "height");
  assert.equal(candidate.value, 142);
  assert.equal(candidate.unit, "cm");
  assert.equal(candidate.confidence, "high");
});

test("013 §7-2: '142센티' → height 142", () => {
  assert.equal(one("142센티").value, 142);
  assert.equal(one("142센티미터").measurementType, "height");
  assert.equal(one("142센치").value, 142);
});

test("013 §7-2: '나는 142야' + 키 질문 문맥 → height 142", () => {
  const candidate = one("나는 142야", "요즘 키 재봤어?");
  assert.equal(candidate.measurementType, "height");
  assert.equal(candidate.value, 142);
});

test("013 §7-2: 질문 문맥이 없으면 맨숫자는 후보를 만들지 않는다", () => {
  // 어떤 종류인지 단정할 수 없으면 추측하지 않는다(§6-1).
  assert.deepEqual(extract("나는 142야"), []);
  assert.deepEqual(extract("142"), []);
});

test("013 §7-2: 키와 몸무게를 함께 물었으면 맨숫자를 해석하지 않는다", () => {
  assert.deepEqual(extract("142", "키랑 몸무게 재봤어?"), []);
  assert.equal(inferAskedMeasurementType("키랑 몸무게 재봤어?"), null);
});

test("013 §7-2: '140쯤' → low confidence", () => {
  assert.equal(one("키 140쯤", "키 재봤어?").confidence, "low");
});

test("013 §7-2: '아마 138' → low confidence", () => {
  assert.equal(one("아마 138", "키 재봤어?").confidence, "low");
});

test("013 §7-2: '14cm' 는 후보를 만들지 않는다", () => {
  // 초등학생 키로 불가능한 값이다(§3-5, 시나리오 D).
  assert.deepEqual(extract("키 14cm"), []);
});

test("013 §7-2: '142kg' 를 키로 저장하지 않는다", () => {
  // 단위가 kg 이므로 몸무게로 해석되고, 그 값은 아이 몸무게로 비현실적이라 버려진다.
  const result = extract("키 142kg");
  assert.equal(result.filter((c) => c.measurementType === "height").length, 0, "키로 저장됐다");
  assert.equal(result.filter((c) => c.measurementType === "weight").length, 0, "비현실 몸무게가 저장됐다");
});

// ── §7-3 몸무게 추출 ──────────────────────────────────────────

test("013 §7-3: '몸무게 38kg' → weight 38", () => {
  const candidate = one("몸무게 38kg");
  assert.equal(candidate.measurementType, "weight");
  assert.equal(candidate.value, 38);
  assert.equal(candidate.unit, "kg");
  assert.equal(candidate.confidence, "high");
});

test("013 §7-3: '38킬로야' → weight 38", () => {
  assert.equal(one("38킬로야").value, 38);
  assert.equal(one("38킬로그램이야").measurementType, "weight");
});

test("013 §7-3: '나는 38이야' + 몸무게 질문 문맥 → weight 38", () => {
  const candidate = one("나는 38이야", "몸무게도 재봤어?");
  assert.equal(candidate.measurementType, "weight");
  assert.equal(candidate.value, 38);
});

test("013 §7-3: '40인가?' → low confidence", () => {
  assert.equal(one("40인가?", "몸무게 재봤어?").confidence, "low");
});

test("013 §7-3: '400kg' 는 후보를 만들지 않는다", () => {
  assert.deepEqual(extract("몸무게 400kg"), []);
});

test("013 §7-3: '38cm' 를 몸무게로 저장하지 않는다", () => {
  const result = extract("몸무게 38cm");
  assert.equal(result.filter((c) => c.measurementType === "weight").length, 0, "몸무게로 저장됐다");
});

// ── §6 모호성 ────────────────────────────────────────────────

test("013 §6-2: 소수점 한 자리를 그대로 보존한다", () => {
  assert.equal(one("어제 쟀는데 141.5cm였어").value, 141.5);
  assert.equal(one("38.2kg이야").value, 38.2);
});

test("013 §6-3: 한 발화에 여러 값이면 뒤쪽(현재값)을 쓴다", () => {
  const candidate = one("지난번엔 140이었고 지금은 142야", "키 재봤어?");
  assert.equal(candidate.value, 142);
});

test("013 §6-4: 키와 몸무게를 한 번에 말하면 각각 독립 후보다", () => {
  const result = extract("키 142cm고 몸무게 38kg이야");
  assert.equal(result.length, 2);
  assert.equal(result.find((c) => c.measurementType === "height")?.value, 142);
  assert.equal(result.find((c) => c.measurementType === "weight")?.value, 38);
});

// ── 시나리오 C 불확실 발화 ────────────────────────────────────

test("013 시나리오 C: 불확실 발화는 전부 low confidence 다", () => {
  for (const [utterance, asked] of [
    ["140쯤?", "키 재봤어?"],
    ["잘 모르겠는데 40kg인가?", "몸무게 재봤어?"],
    ["엄마가 138이라고 했던 것 같아", "키 재봤어?"],
    ["아마 42kg?", "몸무게 재봤어?"],
  ] as const) {
    const result = extract(utterance, asked);
    assert.ok(result.length > 0, `후보를 아예 못 만들었다: ${utterance}`);
    assert.equal(result[0].confidence, "low", `high 로 판정됐다: ${utterance}`);
  }
});

test("013: 희망·과거 표현은 측정값이 아니다", () => {
  assert.deepEqual(extract("키 150cm 되고 싶어"), []);
  assert.deepEqual(extract("작년에 키 135cm였어"), []);
});

test("013 §3-3: rawValueText 에 문장 전체를 담지 않는다", () => {
  const candidate = one("오늘 학교에서 키 재봤는데 142cm였어 신기하지");
  assert.ok(candidate.rawValueText.length <= 40);
  assert.ok(!candidate.rawValueText.includes("학교"), `문장이 새어 들어갔다: ${candidate.rawValueText}`);
});

test("013: 숫자가 없으면 아무것도 만들지 않는다", () => {
  assert.deepEqual(extract("나 오늘 키 컸어!"), []);
  assert.deepEqual(extract(""), []);
});

// ── 동의 게이트 (§3-16) ──────────────────────────────────────

test("013 §3-16: 성장정보 미설정 가정에서는 후보를 저장하지 않는다", async () => {
  const { recordGrowthCandidates } = await import("./candidates");
  let inserted = false;
  const db = {
    from: (table: string) => {
      if (table === "child_growth_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      return {
        insert: async () => {
          inserted = true;
          return { error: null };
        },
      };
    },
  } as never;

  const result = await recordGrowthCandidates({
    db,
    childId: "child-1",
    candidates: extract("키 142cm야"),
    sourceType: "child_utterance_free_chat",
  });

  assert.equal(result.skippedNoConsent, true);
  assert.equal(result.inserted, 0);
  assert.equal(inserted, false, "동의 없이 아이 신체정보가 저장됐다");
});

test("013 §3-16: 성장정보를 설정한 가정에서는 후보가 저장된다", async () => {
  const { recordGrowthCandidates } = await import("./candidates");
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => {
      if (table === "child_growth_profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { child_id: "child-1" }, error: null }) }) }),
        };
      }
      if (table === "growth_measurements") {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          }),
        };
      }
      return {
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return { error: null };
        },
      };
    },
  } as never;

  const result = await recordGrowthCandidates({
    db,
    childId: "child-1",
    candidates: extract("키 142cm야"),
    sourceType: "child_utterance_free_chat",
  });

  assert.equal(result.inserted, 1);
  assert.equal(rows[0].measurement_type, "height");
  assert.equal(rows[0].status, "pending");
  // §3-3 — 대화 문장이 아니라 숫자 조각만 저장한다.
  assert.equal(rows[0].raw_value_text, "142cm");
});

// ── §5-12 기존 기록 보존 ──────────────────────────────────────

const makeConfirmDb = (existingRow: Record<string, unknown> | null) => {
  const calls: { updates: Array<Record<string, unknown>>; inserts: Array<Record<string, unknown>> } = {
    updates: [],
    inserts: [],
  };
  const db = {
    from: (table: string) => {
      if (table === "growth_measurement_candidates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "cand-1", child_id: "child-1", measurement_type: "weight", value: 38, status: "pending" },
                  error: null,
                }),
              }),
            }),
          }),
          update: (row: Record<string, unknown>) => ({
            eq: () => ({ eq: async () => { calls.updates.push({ table, ...row }); return { error: null }; } }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow }) }) }),
        }),
        update: (row: Record<string, unknown>) => ({
          eq: async () => { calls.updates.push({ table, ...row }); return { error: null }; },
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({ single: async () => { calls.inserts.push(row); return { data: { id: "m-1" }, error: null }; } }),
        }),
      };
    },
  } as never;
  return { db, calls };
};

test("013 §5-12: 같은 날 parent_manual 행에 병합할 때 source 를 소급 변경하지 않는다", async () => {
  const { confirmGrowthCandidate } = await import("./candidates");
  const { db, calls } = makeConfirmDb({ id: "m-existing", source: "parent_manual" });

  const result = await confirmGrowthCandidate({
    db,
    childId: "child-1",
    candidateId: "cand-1",
    reviewerUserId: "parent-1",
  });

  assert.equal(result.ok, true);
  const measurementUpdate = calls.updates.find((row) => row.table === "growth_measurements");
  assert.ok(measurementUpdate, "공식 기록을 갱신하지 않았다");
  assert.equal(measurementUpdate!.weight_kg, 38);
  assert.equal(
    "source" in measurementUpdate!,
    false,
    "부모가 직접 입력한 행의 source 를 덮어썼다",
  );
});

test("013 §3-7: 새로 만드는 행에는 parent_confirmed_child_report 를 붙인다", async () => {
  const { confirmGrowthCandidate } = await import("./candidates");
  const { db, calls } = makeConfirmDb(null);

  const result = await confirmGrowthCandidate({
    db,
    childId: "child-1",
    candidateId: "cand-1",
    reviewerUserId: "parent-1",
  });

  assert.equal(result.ok, true);
  assert.equal(calls.inserts.length, 1);
  assert.equal(calls.inserts[0].source, "parent_confirmed_child_report");
  assert.equal(calls.inserts[0].weight_kg, 38);
});

test("013 §6-6: 공식 최신값과 같은 값은 후보로 올리지 않는다", async () => {
  const { recordGrowthCandidates } = await import("./candidates");
  let inserted = false;
  const db = {
    from: (table: string) => {
      if (table === "child_growth_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { child_id: "c" }, error: null }) }) }) };
      }
      if (table === "growth_measurements") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [{ measured_at: "2026-08-18", height_cm: 142, weight_kg: null }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {
        insert: async () => {
          inserted = true;
          return { error: null };
        },
      };
    },
  } as never;

  const result = await recordGrowthCandidates({
    db,
    childId: "c",
    candidates: extract("키 142cm야"),
    sourceType: "child_utterance_free_chat",
  });

  assert.equal(result.inserted, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(inserted, false, "부모가 이미 가진 값이 다시 올라갔다");
});

test("013 §6-6: 값이 달라졌으면 새 후보로 올린다", async () => {
  const { recordGrowthCandidates } = await import("./candidates");
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => {
      if (table === "child_growth_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { child_id: "c" }, error: null }) }) }) };
      }
      if (table === "growth_measurements") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [{ measured_at: "2026-08-18", height_cm: 140, weight_kg: null }], error: null }),
              }),
            }),
          }),
        };
      }
      return {
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return { error: null };
        },
      };
    },
  } as never;

  const result = await recordGrowthCandidates({
    db,
    childId: "c",
    candidates: extract("키 142cm야"),
    sourceType: "child_utterance_free_chat",
  });

  assert.equal(result.inserted, 1);
  assert.equal(rows[0].value, 142);
});
