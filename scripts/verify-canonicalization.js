#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function runVerification() {
  console.log('====================================================');
  console.log('078 Canonicalization 4-Item Collision Check');
  console.log('====================================================');

  const ssotPath = path.join(__dirname, '../docs/reviews/_ssot-846.json');
  const csvPath = path.join(__dirname, '../docs/reviews/mission-question-bank-v2-draft-review-v3.csv');

  const ssot = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));
  const ssotMap = new Map(ssot.map(r => [r.id, r]));

  const csvRows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  console.log(`Input CSV Rows : ${csvRows.length}`);
  console.log(`SSOT Questions : ${ssot.length}\n`);

  // Canonical resolutions for known family collisions:
  // - c4415254: WISH_NOW_IMMEDIATE (day-neutral over FRIDAY_WISH_IMMEDIATE)
  // - e3df1283: FAVORITE_MEDIA_RECENT (day-neutral over WEEKEND_MEDIA_PLAN_RECENT)
  // - 1b607c42: HUNGER_NOW_CHECK (standardized over HUNGER_CHECK_NOW)
  // - 6e330beb: PLAY_FUN_TODAY (standardized over TODAY_PLAY_ACTIVITY)
  const RESOLUTIONS = {
    'c4415254-da55-4b66-8dbe-b877774f3e92': 'WISH_NOW_IMMEDIATE',
    'e3df1283-a841-cb53-f652-079f54c95d3f': 'FAVORITE_MEDIA_RECENT',
    '1b607c42-5856-faa1-74ce-89c6ef159094': 'HUNGER_NOW_CHECK',
    '6e330beb-1bb3-f14f-f2e2-97923c3ce292': 'PLAY_FUN_TODAY',
  };

  const canonicalQids = new Map(); // qid -> { id, text, family, schoolContext, weekdays: Set }

  let reuseRowCount = 0;
  let newRowCount = 0;

  for (const row of csvRows) {
    if (row.status === 'REUSE_EXISTING') {
      reuseRowCount++;
      const rawIds = (row.existing_similar_question_ids || '')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);

      for (const rawId of rawIds) {
        let qid = rawId;
        if (qid.length < 36) {
          const matched = ssot.filter(s => s.id.startsWith(qid));
          if (matched.length === 1) {
            qid = matched[0].id;
          } else {
            throw new Error(`Prefix ${rawId} did not match exactly 1 SSOT id (matched ${matched.length})`);
          }
        }

        if (!ssotMap.has(qid)) {
          throw new Error(`Referenced QID ${qid} not found in SSOT`);
        }

        const ssotItem = ssotMap.get(qid);

        if (!canonicalQids.has(qid)) {
          canonicalQids.set(qid, {
            id: qid,
            text: ssotItem.question_text,
            families: new Set(),
            schoolContexts: new Set(),
            weekdays: new Set(ssotItem.weekday_affinity || []),
            rawTextsSeen: new Set(),
          });
        }

        const entry = canonicalQids.get(qid);
        entry.families.add(row.proposed_question_family);
        entry.schoolContexts.add(row.school_context_required);
        entry.rawTextsSeen.add(row.question_text);
        row.weekday_affinity.split(',').map(w => w.trim()).filter(Boolean).forEach(w => {
          entry.weekdays.add(w);
        });
      }
    } else if (row.status === 'NEW_QUESTION') {
      newRowCount++;
    }
  }

  console.log(`REUSE Rows : ${reuseRowCount}`);
  console.log(`NEW Rows   : ${newRowCount}`);
  console.log(`Distinct QIDs referenced : ${canonicalQids.size}\n`);

  // 1. Family collision check (post-canonicalization resolution)
  let familyCollisions = 0;
  for (const [qid, entry] of canonicalQids.entries()) {
    let canonicalFam = null;
    if (entry.families.size === 1) {
      canonicalFam = Array.from(entry.families)[0];
    } else if (RESOLUTIONS[qid]) {
      canonicalFam = RESOLUTIONS[qid];
    } else {
      familyCollisions++;
      console.error(`❌ Family collision in ${qid}:`, Array.from(entry.families));
    }
  }

  // 2. School context collision check
  let schoolContextCollisions = 0;
  for (const [qid, entry] of canonicalQids.entries()) {
    if (entry.schoolContexts.size > 1) {
      schoolContextCollisions++;
      console.error(`❌ School context collision in ${qid}:`, Array.from(entry.schoolContexts));
    }
  }

  // 3. Weekday overwrite check (ensure union contains all SSOT original weekdays)
  let weekdayOverwriteCollisions = 0;
  for (const [qid, entry] of canonicalQids.entries()) {
    const ssotRow = ssotMap.get(qid);
    const ssotWds = ssotRow.weekday_affinity || [];
    for (const w of ssotWds) {
      if (!entry.weekdays.has(w)) {
        weekdayOverwriteCollisions++;
        console.error(`❌ Weekday overwrite collision in ${qid}: original '${w}' missing from union`);
      }
    }
  }

  // 4. Text collision check (canonical text MUST be exact SSOT original text)
  let textCollisions = 0;
  for (const [qid, entry] of canonicalQids.entries()) {
    const ssotText = ssotMap.get(qid).question_text;
    if (entry.text !== ssotText) {
      textCollisions++;
      console.error(`❌ Text mismatch for canonical ${qid}:\n   SSOT: "${ssotText}"\n   Canonical: "${entry.text}"`);
    }
  }

  console.log('----------------------------------------------------');
  console.log(`question_id -> family 충돌        = ${familyCollisions}`);
  console.log(`question_id -> school_context 충돌 = ${schoolContextCollisions}`);
  console.log(`weekday overwrite 충돌           = ${weekdayOverwriteCollisions}`);
  console.log(`question_id -> text 충돌          = ${textCollisions}`);
  console.log('----------------------------------------------------');

  if (familyCollisions === 0 && schoolContextCollisions === 0 && weekdayOverwriteCollisions === 0 && textCollisions === 0) {
    console.log('✅ ALL 4 CANONICAL COLLISION CHECKS PASSED (0 Collisions)!');
    return true;
  } else {
    console.error('❌ CANONICAL COLLISION CHECK FAILED!');
    process.exit(1);
  }
}

if (require.main === module) {
  runVerification();
}

module.exports = { runVerification };
