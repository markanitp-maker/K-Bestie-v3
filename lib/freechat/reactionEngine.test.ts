import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import reactionSeedData from './reactionSeed.json' with { type: 'json' };
import { classifyInput, pickReaction, getFreeChatReaction, detectInputIntensity } from './reactionEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const reactionSeed = reactionSeedData as Array<{
  id: string;
  situation_group: number;
  text: string;
  keywords: string[];
  intensity: string;
}>;

// For audit
const audit = {
  total: reactionSeed.length,
  distribution: { low: 0, medium: 0, high: 0 },
  perGroupDistribution: {} as Record<number, { low: 0, medium: 0, high: 0 }>,
  duplicateCount: 0,
  questionFormViolations: 0,
  bannedPatternViolations: 0,
  fixedItems: [] as string[]
};

test('Reaction Engine & Seed Data Tests', async (t) => {
  await t.test('Total 300 items', () => {
    assert.strictEqual(reactionSeed.length, 300, 'Seed data should have exactly 300 items');
  });

  await t.test('Exactly 10 items per group (1~30)', () => {
    const groupCounts: Record<number, number> = {};
    for (const item of reactionSeed) {
      groupCounts[item.situation_group] = (groupCounts[item.situation_group] || 0) + 1;
    }
    
    for (let i = 1; i <= 30; i++) {
      assert.strictEqual(groupCounts[i], 10, `Group ${i} should have exactly 10 items`);
    }
  });

  await t.test('No question marks or long informative texts (except group 29)', () => {
    for (const item of reactionSeed) {
      if (item.situation_group !== 29) {
        assert.ok(!item.text.includes('?'), `Item ${item.id} has a question mark but is not in group 29`);
        assert.ok(item.text.length < 50, `Item ${item.id} is too long (${item.text.length} chars) - might be informative/detailed`);
      }
    }
  });

  await t.test('intensity field must be low, medium, or high', () => {
    for (const item of reactionSeed) {
      assert.ok(['low', 'medium', 'high'].includes(item.intensity), `Item ${item.id} has invalid intensity: ${item.intensity}`);
      const intensity = item.intensity as 'low' | 'medium' | 'high';
      audit.distribution[intensity]++;
      
      if (!audit.perGroupDistribution[item.situation_group]) {
        audit.perGroupDistribution[item.situation_group] = { low: 0, medium: 0, high: 0 };
      }
      audit.perGroupDistribution[item.situation_group][intensity]++;
    }
  });

  await t.test('intensity distribution is not perfectly uniform', () => {
    const { low, medium, high } = audit.distribution;
    assert.ok(low > 0 && medium > 0 && high > 0, 'Each intensity level should exist at least once');
    const isPerfectlyUniform = low === 100 && medium === 100 && high === 100;
    assert.ok(!isPerfectlyUniform, 'Intensity distribution should not be artificially perfectly uniform (100/100/100)');
  });

  await t.test('Group-by-group intensity distribution', () => {
    console.log('\n--- Group Intensity Distribution ---');
    for (let i = 1; i <= 30; i++) {
      const dist = audit.perGroupDistribution[i];
      console.log(`Group ${i.toString().padStart(2, '0')}: low=${dist.low}, medium=${dist.medium}, high=${dist.high}`);
      assert.ok((dist.low + dist.medium + dist.high) > 0, `Group ${i} must have at least 1 item`);
    }
    console.log('------------------------------------\n');
  });

  await t.test('No exact duplicates in text and check prefix similarity', () => {
    const texts = reactionSeed.map(item => item.text);
    const uniqueTexts = new Set(texts);
    audit.duplicateCount = texts.length - uniqueTexts.size;
    assert.strictEqual(uniqueTexts.size, 300, 'All reaction texts should be completely unique');

    const groups: Record<number, string[]> = {};
    for (const item of reactionSeed) {
      if (!groups[item.situation_group]) groups[item.situation_group] = [];
      groups[item.situation_group].push(item.text);
    }

    for (let i = 1; i <= 30; i++) {
      const groupTexts = groups[i];
      const prefixCounts: Record<string, number> = {};
      for (const text of groupTexts) {
        if (text.length >= 5) {
          const prefix = text.substring(0, 5);
          prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
        }
      }
      for (const [prefix, count] of Object.entries(prefixCounts)) {
        assert.ok(count <= 2, `Group ${i} has too many items (${count}) starting with "${prefix}"`);
      }
    }
  });

  await t.test('No question forms', () => {
    const qPattern = /\?|까\s*$|니\s*$|냐\s*$|을까\s*$/;
    let violations = 0;
    for (const item of reactionSeed) {
      if (qPattern.test(item.text)) {
        violations++;
        console.warn(`Question form violation: [${item.id}] ${item.text}`);
      }
    }
    audit.questionFormViolations = violations;
    assert.strictEqual(violations, 0, 'There should be 0 question forms');
  });

  await t.test('No banned words or patterns', () => {
    const bannedPattern = /해야|하지마|하지 마|해봐|네 잘못|니 잘못|엄마가 잘못|아빠가 잘못|인 것 같아 걱정돼|우울증|문제가 있|이상해/;
    let violations = 0;
    for (const item of reactionSeed) {
      if (bannedPattern.test(item.text) && !item.text.includes('해볼래')) {
        violations++;
        console.warn(`Banned word violation: [${item.id}] ${item.text}`);
      }
    }
    audit.bannedPatternViolations = violations;
    assert.strictEqual(violations, 0, 'There should be 0 banned words');
  });

  await t.test('classifyInput returns correct group for representative inputs', () => {
    // Testing group 1: "좋아", "신나"
    assert.strictEqual(classifyInput('오늘 정말 신나!'), 1);
    
    // Testing group 2: "해냈어", "잘했어"
    assert.strictEqual(classifyInput('나 오늘 드디어 해냈어!'), 2);

    // Testing group 8: "속상해", "슬퍼" etc (assuming keywords from group 8 exist)
    const groupKeywords: Record<number, string> = {};
    for (const item of reactionSeed) {
      if (!groupKeywords[item.situation_group] && item.keywords && item.keywords.length > 0) {
        groupKeywords[item.situation_group] = item.keywords[0];
      }
    }

    for (let i = 1; i <= 28; i++) {
      const keyword = groupKeywords[i];
      if (keyword) {
        assert.strictEqual(classifyInput(`매우 ${keyword}`), i, `Expected group ${i} for keyword ${keyword}`);
      }
    }

    // Testing group 29 (Question)
    assert.strictEqual(classifyInput('이건 뭐야?'), 29);
    assert.strictEqual(classifyInput('오늘 날씨 어때', { isQuestionFromChild: true }), 29);

    // Testing group 30 (Low Confidence ASR)
    assert.strictEqual(classifyInput('으어어', { isLowConfidenceAsr: true }), 30);
    
    // Testing fallback (group 5)
    assert.strictEqual(classifyInput('그냥 저냥 무명키워드'), 5);
  });

  await t.test('pickReaction avoids recent texts history', () => {
    const group1Texts = reactionSeed.filter(i => i.situation_group === 1).map(i => i.text);
    
    // Put 9 out of 10 in history
    const history = group1Texts.slice(0, 9);
    const chosen = pickReaction(1, history);
    
    // Must pick the 10th one
    assert.strictEqual(chosen.text, group1Texts[9], 'Should pick the only available item not in history');
    
    // Put all 10 in history
    const fullHistory = [...group1Texts];
    const fallbackChosen = pickReaction(1, fullHistory);
    assert.ok(group1Texts.includes(fallbackChosen.text), 'Should allow repetition if all items are in history');
  });

  await t.test('detectInputIntensity & pickReaction fallback', () => {
    assert.strictEqual(detectInputIntensity('그냥'), 'low');
    assert.strictEqual(detectInputIntensity('진짜 최고야'), 'high');
    assert.strictEqual(detectInputIntensity('적당히 괜찮은 것 같아'), 'medium');

    // pickReaction intensity matching
    // pickReaction will try to find matching intensity. If none, it falls back to all candidates of the group.
    const fallbackIntensityChosen = pickReaction(1, [], 'non_existent_intensity' as any);
    const sourceItemFallback = reactionSeed.find(i => i.id === fallbackIntensityChosen.id);
    assert.strictEqual(sourceItemFallback?.situation_group, 1, 'Should fallback to the same group candidates when intensity not found');
  });

  await t.test('getFreeChatReaction combination', () => {
    const res = getFreeChatReaction('이건 뭐야?', []);
    assert.strictEqual(res.situationGroup, 29);
    assert.ok(res.text.length > 0);
  });

  await t.test('Save audit result', () => {
    const auditPath = path.join(__dirname, 'reactionSeed-full-audit.json');
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
    assert.ok(fs.existsSync(auditPath));
  });
});

