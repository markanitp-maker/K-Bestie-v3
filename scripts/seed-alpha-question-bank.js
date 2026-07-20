#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveProjectRef, getTargetEnv } = require('./lib/resolveTarget');

const envVars = {};
fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

function getDeterministicQuestionId(groupCode) {
  const hash = crypto
    .createHash('sha256')
    .update('kbestie-alpha-question:' + groupCode)
    .digest('hex');
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  const target = getTargetEnv();
  const projectRef = resolveProjectRef();
  const supabaseUrl = `https://${projectRef}.supabase.co`;
  
  const serviceKey = target === 'prod' ? envVars.SUPABASE_SERVICE_ROLE_KEY : envVars.SUPABASE_DEV_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error(`[Error] Missing service role key for target ${target}`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const manifestPath = path.join(__dirname, '../data/questions/alpha-approved-manifest.json');
  const bankPath = path.join(__dirname, '../data/questions/question-bank-v2.0.json');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

  const approvedGroupCodes = new Set(manifest.approved_group_codes || []);
  
  if (approvedGroupCodes.size === 0) {
    console.log("No approved group codes found in manifest.");
    return;
  }

  const rowsToUpsert = [];

  for (const q of bank) {
    if (approvedGroupCodes.has(q.group_code)) {
      const id = getDeterministicQuestionId(q.group_code);
      rowsToUpsert.push({
        id,
        question_text: q.question_text,
        applicable_grades: q.applicable_grades,
        cycle_type: q.cycle_type,
        dashboard_area_tag: q.dashboard_area_tag,
        round_type: q.round_type,
        conversation_stage: q.conversation_stage,
        question_intent: q.question_intent,
        question_bank_version: "v2.0",
        clinical_status: "PENDING_REVIEW",
        is_active: false
      });
    }
  }

  if (rowsToUpsert.length === 0) {
    console.log("No matching questions found in bank.");
    return;
  }

  const { data, error } = await supabase
    .from('mission_questions')
    .upsert(rowsToUpsert, { onConflict: 'id' });

  if (error) {
    console.error(`[Error] Upsert failed: ${error.message}`);
    console.log(`Summary: Processed group_codes: ${rowsToUpsert.length} / Success: 0 / Fail: ${rowsToUpsert.length}`);
  } else {
    console.log(`Summary: Processed group_codes: ${rowsToUpsert.length} / Success: ${rowsToUpsert.length} / Fail: 0`);
  }
}

main().catch(console.error);
