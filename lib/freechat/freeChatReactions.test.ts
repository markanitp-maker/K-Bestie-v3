import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickReaction,
  insertSafetyEventWithDedupe,
  isRecentDuplicateSafetyEvent,
  SAFETY_EVENT_DEDUPE_TTL_MS,
} from '../freeChatReactions';

interface MockSafetyRow {
  id: string;
  session_id: string | null;
  child_id: string | null;
  subcategory: string;
  child_text: string;
  created_at: string;
  source?: string;
}

function createMockSafetySupabase(options: { initialRows?: MockSafetyRow[]; queryError?: boolean; insertError?: boolean } = {}) {
  const rows: MockSafetyRow[] = options.initialRows ? [...options.initialRows] : [];
  let currentNowMs = Date.now();
  let insertCount = 0;
  let queryCount = 0;

  return {
    get rows() { return rows; },
    get insertCount() { return insertCount; },
    get queryCount() { return queryCount; },
    setNowMs: (ms: number) => { currentNowMs = ms; },
    from: (table: string) => {
      assert.equal(table, 'safety_events');
      return {
        select: (_cols?: string) => {
          queryCount++;
          if (options.queryError) {
            const errChain: any = {
              eq: () => errChain,
              gte: () => errChain,
              limit: async () => ({ data: null, error: { message: 'DB connection error' } }),
            };
            return errChain;
          }

          const filters: Array<(row: MockSafetyRow) => boolean> = [];
          const queryObj: any = {
            eq: (col: string, val: unknown) => {
              filters.push((r: any) => r[col] === val);
              return queryObj;
            },
            gte: (col: string, val: unknown) => {
              filters.push((r: any) => {
                const rVal = r[col];
                if (typeof rVal === 'string' && typeof val === 'string') {
                  return new Date(rVal).getTime() >= new Date(val).getTime();
                }
                return rVal >= val;
              });
              return queryObj;
            },
            limit: async (n: number) => {
              const matched = rows.filter((r) => filters.every((f) => f(r)));
              return { data: matched.slice(0, n), error: null };
            },
          };
          return queryObj;
        },
        insert: async (data: Record<string, any>) => {
          insertCount++;
          if (options.insertError) {
            return { error: { message: 'DB insert failed' } };
          }
          const newRow: MockSafetyRow = {
            id: `evt-${rows.length + 1}`,
            session_id: data.session_id ?? null,
            child_id: data.child_id ?? null,
            subcategory: data.subcategory,
            child_text: data.child_text,
            created_at: data.created_at ?? new Date(currentNowMs).toISOString(),
            source: data.source ?? 'QUESTION_ENGINE',
          };
          rows.push(newRow);
          return { data: newRow, error: null };
        },
      };
    },
  };
}

test('치명 안전 미탐 해결 — 위험 신호 + 가슴 결합 시 반드시 inappropriate_contact 발동', async (t) => {
  const fixedMissedCases = [
    { input: '만져서 가슴이 아파', desc: '만져서 + 가슴 통증 호소' },
    { input: '주물러서 가슴이 아파', desc: '주물러서 + 가슴 통증 호소' },
    { input: '아저씨가 만져서 가슴이 아파', desc: '가해자 언급 + 만져서 + 가슴 통증' },
    { input: '쓰다듬어서 가슴이 이상해', desc: '쓰다듬어서 + 가슴 이상 호소' },
  ];

  for (const { input, desc } of fixedMissedCases) {
    await t.test(`[미탐 해결] ${input} (${desc})`, () => {
      const res = pickReaction(input);
      assert.equal(
        res.category,
        'safety',
        `"${input}"은(는) 반드시 safety로 발동해야 합니다. 반환값: category=${res.category}, text=${res.text}`
      );
      assert.equal(res.safetySubcategory, 'inappropriate_contact');
      assert.equal(res.flaggedForParent, true);
    });
  }
});

test('부적절 접촉 실제 위험 탐지 — 기존 발동 대상 유지 (회귀 없음)', async (t) => {
  const requiredSafetyCases = [
    { input: '아저씨가 고추 보여달래', desc: '노출 요구' },
    { input: '삼촌이 가슴 만졌어', desc: '가슴 만짐' },
    { input: '형이 고추 만지라고 했어', desc: '접촉 강요' },
    { input: '누가 내 고추 사진 찍으래', desc: '사진 촬영 강요' },
    { input: '아저씨가 몸을 만졌어', desc: '신체 만짐' },
    { input: '비밀로 하래', desc: '비밀 강요' },
    { input: '옷을 벗으래', desc: '탈의 강요' },
    { input: '아무한테도 말하지 말래', desc: '발설 금지 강요' },
    { input: '이상한 데 만졌어', desc: '이상 부위 접촉' },
    { input: '사진 찍재', desc: '사진 촬영 요구' },
    { input: '둘만의 비밀이래', desc: '비밀 요구' },
    { input: '누가 가슴 만지려고 해', desc: '가슴 만짐 시도' },
    { input: '가슴 보여달라고 했어', desc: '가슴 노출 요구' },
    { input: '바지 벗기고 고추 만졌어', desc: '탈의 후 접촉' },
    { input: '가슴 만졌대', desc: '가슴 접촉' },
    { input: '고추 만지래', desc: '접촉 요구' },
    { input: '누가 가슴에 손을 대려고 했어', desc: '가슴 접촉 시도' },
  ];

  for (const { input, desc } of requiredSafetyCases) {
    await t.test(`[필수 발동 유지] ${input} (${desc})`, () => {
      const res = pickReaction(input);
      assert.equal(res.category, 'safety', `"${input}"은(는) 반드시 safety여야 합니다.`);
      assert.equal(res.safetySubcategory, 'inappropriate_contact');
      assert.equal(res.flaggedForParent, true);
    });
  }
});

test('자유대화 안전 오탐 방지 — 음식 단어 및 일상/운동 관용구 (Safety 발동 금지)', async (t) => {
  const falsePositiveCases = [
    { input: '오늘 고추장에 떡볶이 찍어 먹었어', desc: '고추장 음식 문맥' },
    { input: '고춧가루 넣으니까 매웠어', desc: '고춧가루 음식 문맥' },
    { input: '초고추장 좋아해?', desc: '초고추장 음식 문맥' },
    { input: '난 고추 안 먹어. 너무 매워', desc: '단독 고추 음식 문맥' },
    { input: '청양고추 매워', desc: '청양고추 음식 문맥' },
    { input: '가슴이 두근두근했어', desc: '가슴 감정/심장 관용구' },
    { input: '달리기 하니까 가슴이 아파', desc: '달리기 운동 후 신체 증상 (위험신호 없음)' },
    { input: '고추소박이 맛있어', desc: '고추소박이 음식 복합어' },
    { input: '고추된장무침 먹었어', desc: '고추된장무침 음식 복합어' },
    { input: '추장보다 높은 사람은?', desc: '넌센스 퀴즈' },
    { input: '고추장', desc: '단독 음식 단어' },
    { input: '고추장 맞아', desc: '퀴즈 정답' },
    { input: '고추장보다 높은 건 초고추장이잖아', desc: '퀴즈 대화' },
    { input: '청양고추 너무 매워', desc: '청양고추 음식 문맥' },
    { input: '할머니가 고추 키워', desc: '고추 농사/식물' },
    { input: '풋고추 쌈장에 찍어 먹었어', desc: '풋고추 음식' },
    { input: '고추기름 넣어서 볶았어', desc: '고추기름 요리' },
    { input: '가슴이 뭉클했어', desc: '가슴 감정 관용구' },
    { input: '가슴이 찡했어', desc: '가슴 감정 관용구' },
    { input: '가슴이 벅차올랐어', desc: '가슴 감정 관용구' },
    { input: '가슴이 답답해', desc: '가슴 감정/신체 관용구' },
    { input: '숨차서 가슴이 뛰어', desc: '운동 후 숨참' },
  ];

  for (const { input, desc } of falsePositiveCases) {
    await t.test(`[발동 금지] ${input} (${desc})`, () => {
      const res = pickReaction(input);
      assert.notEqual(
        res.category,
        'safety',
        `"${input}"은(는) safety로 발동하면 안 됩니다. 반환값: category=${res.category}, text=${res.text}`
      );
      assert.equal(res.flaggedForParent, false);
    });
  }
});

test('safety_events DB 기반 단시간 중복 방지 — 같은 아이 + 같은 발화 연속 3회 시 insert 1회만 발생', async () => {
  const mockDb = createMockSafetySupabase();

  const params = {
    sessionId: 'session-abc',
    childId: 'child-123',
    subcategory: 'inappropriate_contact' as const,
    childText: '만져서 가슴이 아파',
  };

  const baseTime = 1000000;

  // 1회차 호출 (최초): DB에 이전 이벤트 없으므로 insert 성공
  mockDb.setNowMs(baseTime);
  const res1 = await insertSafetyEventWithDedupe(mockDb, params, baseTime);
  assert.equal(res1.inserted, true);
  assert.equal(res1.duplicate, false);
  assert.equal(mockDb.insertCount, 1);

  // 2회차 호출 (5초 뒤 동일 발화): DB 조회로 최근 60초 내 이벤트 발견 -> 중복 차단 (insert 없음)
  mockDb.setNowMs(baseTime + 5000);
  const res2 = await insertSafetyEventWithDedupe(mockDb, params, baseTime + 5000);
  assert.equal(res2.inserted, false);
  assert.equal(res2.duplicate, true);
  assert.equal(mockDb.insertCount, 1);

  // 3회차 호출 (10초 뒤 동일 발화): DB 조회로 중복 차단 (insert 없음)
  mockDb.setNowMs(baseTime + 10000);
  const res3 = await insertSafetyEventWithDedupe(mockDb, params, baseTime + 10000);
  assert.equal(res3.inserted, false);
  assert.equal(res3.duplicate, true);
  assert.equal(mockDb.insertCount, 1);

  // 4회차 호출 (65초 뒤 TTL 만료 후): 60초 이전 이벤트이므로 새 이벤트로 인정되어 insert 1회 수행
  mockDb.setNowMs(baseTime + 65000);
  const res4 = await insertSafetyEventWithDedupe(mockDb, params, baseTime + 65000);
  assert.equal(res4.inserted, true);
  assert.equal(res4.duplicate, false);
  assert.equal(mockDb.insertCount, 2);

  // 다른 아이의 동일 발화: child_id가 다르므로 각각 독립적으로 1회 insert 수행
  mockDb.setNowMs(baseTime + 66000);
  const otherChildParams = { ...params, childId: 'child-999' };
  const res5 = await insertSafetyEventWithDedupe(mockDb, otherChildParams, baseTime + 66000);
  assert.equal(res5.inserted, true);
  assert.equal(res5.duplicate, false);
  assert.equal(mockDb.insertCount, 3);
});

test('인스턴스가 달라져도 (캐시가 비어도/무상태) DB 조회를 통해 중복이 막히는지 검증', async () => {
  const baseTime = 2000000;
  // Instance A가 DB에 기록한 상태를 모방
  const initialRow: MockSafetyRow = {
    id: 'evt-existing',
    session_id: 'session-inst-a',
    child_id: 'child-abc',
    subcategory: 'inappropriate_contact',
    child_text: '만져서 가슴이 아파',
    created_at: new Date(baseTime).toISOString(),
    source: 'QUESTION_ENGINE',
  };

  // Instance B는 메모리 캐시가 전혀 없는 완전히 새로운 프로세스/클라이언트
  const mockDbInstanceB = createMockSafetySupabase({ initialRows: [initialRow] });

  const params = {
    sessionId: 'session-inst-b',
    childId: 'child-abc',
    subcategory: 'inappropriate_contact' as const,
    childText: '만져서 가슴이 아파',
  };

  // Instance B에서 10초 뒤 동일 아이·동일 발화 요청
  const res = await insertSafetyEventWithDedupe(mockDbInstanceB, params, baseTime + 10000);
  assert.equal(res.inserted, false);
  assert.equal(res.duplicate, true);
  assert.equal(mockDbInstanceB.insertCount, 0, '인스턴스가 바뀌어도 DB 조회로 중복이 차단되어야 함');
});

test('DB 조회 실패 시 fail-open — insert가 차단되지 않고 진행되는지 검증', async () => {
  // DB query error를 시뮬레이션하는 mock
  const mockDbWithError = createMockSafetySupabase({ queryError: true });

  const params = {
    sessionId: 'session-error-test',
    childId: 'child-xyz',
    subcategory: 'inappropriate_contact' as const,
    childText: '만져서 가슴이 아파',
  };

  const res = await insertSafetyEventWithDedupe(mockDbWithError, params);
  assert.equal(res.inserted, true, 'DB dedupe 쿼리가 실패해도 fail-open으로 insert가 실행되어야 함');
  assert.equal(res.duplicate, false);
  assert.equal(mockDbWithError.insertCount, 1);
});

test('다른 안전 카테고리 정상 동작 및 관용구 예외 회귀 없음', async () => {
  // 1. 자해
  const selfHarm = pickReaction('죽고 싶어');
  assert.equal(selfHarm.category, 'safety');
  assert.equal(selfHarm.safetySubcategory, 'self_harm');

  // 1-1. 자해 관용구 제외
  const selfHarmIdiom = pickReaction('배고파 죽겠어');
  assert.notEqual(selfHarmIdiom.category, 'safety');

  // 2. 폭력
  const violence = pickReaction('친구한테 맞았어');
  assert.equal(violence.category, 'safety');
  assert.equal(violence.safetySubcategory, 'violence');

  // 2-1. 폭력 점수 문맥 제외
  const scoring = pickReaction('100점 맞았어');
  assert.notEqual(scoring.category, 'safety');

  // 3. 괴롭힘
  const bullying = pickReaction('애들이 나를 왕따시켜');
  assert.equal(bullying.category, 'safety');
  assert.equal(bullying.safetySubcategory, 'violence');

  // 4. 협박
  const threat = pickReaction('가만 안 둔다고 협박했어');
  assert.equal(threat.category, 'safety');
  assert.equal(threat.safetySubcategory, 'threat');

  // 5. 방임
  const neglect = pickReaction('집에 아무도 없어 밥을 안 줘');
  assert.equal(neglect.category, 'safety');
  assert.equal(neglect.safetySubcategory, 'neglect');
});

test('안전 응답 중복 억제 — pickRandomAvoiding 동작', () => {
  const input = '아저씨가 몸을 만졌어';
  const first = pickReaction(input);
  assert.equal(first.category, 'safety');

  // 직전 멘트를 lastKText로 넘기면 다른 멘트 선택 시도
  const second = pickReaction(input, first.text);
  assert.equal(second.category, 'safety');
  assert.notEqual(second.text, first.text, '직전 안전 멘트와 동일한 멘트가 연속으로 나오지 않아야 합니다.');
});
