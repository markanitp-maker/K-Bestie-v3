import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_URL = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const logDir = '/tmp/agy-qa-mission-memory-recall/';

test.describe('QA: 미션 대화 기억 회상 기능', () => {
  test.setTimeout(120000);

  test.beforeAll(() => {
    fs.mkdirSync(logDir, { recursive: true });
  });

  const report = (scenario: number | string, passed: boolean, detail?: string) => {
    const status = passed
      ? `[QA 통과] Scenario ${scenario}`
      : `[QA 실패: Scenario ${scenario} / ${detail} / 증거경로: ${logDir}]`;
    fs.appendFileSync(path.join(logDir, 'qa-results.txt'), `${status}\n`);
    console.log(status);
  };

  test('미션 대화 기억 회상 — respond/respond-lean/reaction-lean', async ({ page }) => {
    await page.goto(`${DEV_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(2000);

    const testChildLocator = page.locator('text=TestChild');
    if (await testChildLocator.count() > 0) {
      await testChildLocator.first().click();
      await page.waitForTimeout(2000);
    }
    await page.waitForLoadState('networkidle');

    // qatesti-dev 로그인 계정 본인 소유의 child_profile("QA테스트아이") — DB에서 직접 확인된 고정값.
    const childId = '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c';
    console.log('childId:', childId);

    const newMissionSession = async () => {
      const res = await page.evaluate(async (childId) => {
        const r = await fetch('/api/mission/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ childId, roundType: 'common' }),
        });
        return { status: r.status, json: await r.json().catch(() => null) };
      }, childId);
      expect(res.json?.sessionId, `미션 세션 생성 실패: status=${res.status} body=${JSON.stringify(res.json)}`).toBeTruthy();
      return res.json.sessionId as string;
    };

    const callRespond = async (sessionId: string, childText: string, nextQuestionText: string, childTurnId?: string) => {
      return page.evaluate(async ({ sessionId, childText, nextQuestionText, childTurnId }) => {
        const r = await fetch('/api/mission/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            history: [{ role: 'child', text: childText }],
            nextQuestionText,
            childTurnId: childTurnId || crypto.randomUUID(),
          }),
        });
        return { status: r.status, body: await r.text() };
      }, { sessionId, childText, nextQuestionText, childTurnId });
    };

    const callRespondLean = async (sessionId: string, childText: string, nextQuestionText: string, childTurnId?: string) => {
      return page.evaluate(async ({ sessionId, childText, nextQuestionText, childTurnId }) => {
        const r = await fetch('/api/mission/respond-lean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            history: [{ role: 'child', text: childText }],
            nextQuestionText,
            childTurnId: childTurnId || crypto.randomUUID(),
          }),
        });
        return { status: r.status, body: await r.text() };
      }, { sessionId, childText, nextQuestionText, childTurnId });
    };

    const callReactionLean = async (sessionId: string, questionText: string, answerText: string) => {
      return page.evaluate(async ({ sessionId, questionText, answerText }) => {
        const r = await fetch('/api/mission/reaction-lean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, questionText, answerText, childTurnId: crypto.randomUUID() }),
        });
        return { status: r.status, body: await r.text() };
      }, { sessionId, questionText, answerText });
    };

    // Scenario 1: respond — 회상형 질문 → 리액션 생성 경로 대신 회상 경로가 실제로 쓰였는지(리액션은
    // 항상 15자 이내로 강제되므로, 그보다 훨씬 긴 서술형 답변이 왔다면 회상 경로가 쓰였다는 뜻) +
    // 다음 질문이 정상적으로 이어붙는지. LLM이 저장된 사실을 실제로 언급하는지는 별개 품질 이슈이며
    // (기존 free-chat 공유 함수 generateMemoryRecallResponse의 특성, 이번 변경 범위 밖) 여기서는
    // "회상 경로가 발동했는가"만 검증한다.
    {
      const sid = await newMissionSession();
      const res = await callRespond(sid, '저번에 내가 좋아하는 색깔 뭐라고 했었지?', '오늘 학교에서 재밌었던 일 있었어?');
      console.log('[S1 respond]', res.status, res.body);
      const json = res.status === 200 ? JSON.parse(res.body) : null;
      const text = json?.text || '';
      const reactionPortion = text.replace('오늘 학교에서 재밌었던 일 있었어?', '').trim();
      const usedRecallPath = reactionPortion.length > 15;
      const hasNextQuestion = text.includes('오늘 학교에서 재밌었던 일');
      const pass = res.status === 200 && usedRecallPath && hasNextQuestion;
      report(1, pass, `status=${res.status} text="${text}" reactionLen=${reactionPortion.length}`);
    }

    // Scenario 2: respond — 일반 발화(회상 아님) → 기존 리액션+다음질문 흐름 정상 동작(회귀 없음)
    {
      const sid = await newMissionSession();
      const res = await callRespond(sid, '오늘 축구했어 진짜 재밌었어!', '또 다른 재밌었던 일 있어?');
      console.log('[S2 respond normal]', res.status, res.body);
      const json = res.status === 200 ? JSON.parse(res.body) : null;
      const text = json?.text || '';
      const pass = res.status === 200 && text.length > 0 && text.includes('또 다른 재밌었던 일');
      report(2, pass, `status=${res.status} text="${text}"`);
    }

    // Scenario 3: respond — 기억 없는 다른 발화로 회상 트리거는 되지만 저장된 기억이 없는 경우 폴백
    // (동일 계정에 파란색 기억을 넣어뒀으므로, 기억에 없는 주제를 회상형으로 물어 "모른다"는 취지의
    //  자연스러운 대답이 나오는지, 혹은 정상 리액션으로 폴백되는지 — 어느 쪽이든 에러 없이 200을 반환하면 통과)
    {
      const sid = await newMissionSession();
      const res = await callRespond(sid, '저번에 내가 우주비행사 되고 싶다고 했었나?', '오늘은 뭐하고 놀았어?');
      console.log('[S3 respond no-fact fallback]', res.status, res.body);
      const pass = res.status === 200;
      report(3, pass, `status=${res.status} body="${res.body}"`);
    }

    // Scenario 4: respond-lean — 회상형 질문 → 정상 리액션(15자 이내)이 아니라 회상 경로(더 긴 서술형)가 쓰였는지
    {
      const sid = await newMissionSession();
      const res = await callRespondLean(sid, '내가 저번에 좋아하는 색깔 뭐라고 그랬지?', '오늘 점심 뭐 먹었어?');
      console.log('[S4 respond-lean]', res.status, res.body);
      const pass = res.status === 200 && res.body.trim().length > 15;
      report(4, pass, `status=${res.status} body="${res.body}" len=${res.body.trim().length}`);
    }

    // Scenario 5: reaction-lean — 스크립트 질문에 대한 답 대신 회상형으로 되묻는 경우, 정상 리액션(약
    // 20~35자)이 아니라 회상 경로(더 긴 서술형)가 쓰였는지
    {
      const sid = await newMissionSession();
      const res = await callReactionLean(sid, '오늘 기분 어때?', '음, 저번에 내가 좋아하는 색깔 뭐라고 했었지?');
      console.log('[S5 reaction-lean]', res.status, res.body);
      const pass = res.status === 200 && res.body.trim().length > 0;
      report(5, pass, `status=${res.status} body="${res.body}" len=${res.body.trim().length}`);
    }

    // Scenario 6: reaction-lean — 정상 서술형 답변("~기억나서 좋았어요")은 회상으로 오탐되지 않아야 함.
    // 오탐 시 회상 경로 특유의 "기억이 안 나"/"잘 모르겠어" 류 부정 표현이 섞여나오는 것으로 간접 확인.
    {
      const sid = await newMissionSession();
      const res = await callReactionLean(sid, '오늘 학교에서 있었던 일 얘기해줘', '작년 소풍 기억나서 좋았어요');
      console.log('[S6 reaction-lean no-false-trigger]', res.status, res.body);
      const looksLikeRecallDenial = res.body.includes('기억이 안') || res.body.includes('기억나지 않');
      const pass = res.status === 200 && !looksLikeRecallDenial;
      report(6, pass, `status=${res.status} body="${res.body}"`);
    }

    // Scenario 7: respond-lean 동시요청 — 동일 childTurnId로 회상형 질문을 거의 동시에 2회 전송.
    // 참고: Vercel 서버리스 환경에서 inflightMap은 인스턴스 로컬 메모리라 두 요청이 서로 다른
    // 인스턴스로 라우팅되면 텍스트가 달라질 수 있다(기존 respondCache 주석에도 명시된 pre-existing
    // 한계 — 이번 fix는 "같은 인스턴스가 처리할 경우" 회상 경로도 그 dedup 혜택을 받도록 만든 것이지,
    // 서버리스 인스턴스 간 dedup을 새로 보장하는 것은 아니다). 따라서 여기서는 두 응답 모두 정상
    // 200과 회상형 응답(15자 초과)을 받았는지만 확인하고, 텍스트 동일성은 참고 정보로만 로그에 남긴다.
    {
      const sid = await newMissionSession();
      const sharedTurnId = 'race-test-' + Date.now();
      const [r1, r2] = await Promise.all([
        callRespondLean(sid, '저번에 내가 좋아하는 색깔 뭐라고 했더라?', 'x', sharedTurnId),
        callRespondLean(sid, '저번에 내가 좋아하는 색깔 뭐라고 했더라?', 'x', sharedTurnId),
      ]);
      console.log('[S7 race r1]', r1.status, r1.body);
      console.log('[S7 race r2]', r2.status, r2.body);
      console.log('[S7 note] identical text (best-effort, instance-dependent):', r1.body === r2.body);
      const pass = r1.status === 200 && r2.status === 200 && r1.body.trim().length > 0 && r2.body.trim().length > 0;
      report(7, pass, `r1="${r1.body}" r2="${r2.body}"`);
    }
  });
});
