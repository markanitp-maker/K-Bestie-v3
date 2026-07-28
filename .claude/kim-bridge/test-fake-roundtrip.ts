import fs from 'fs';
import path from 'path';
import { askSecretary } from './lib/askSecretary';

const BASE_DIR = path.join(process.cwd(), '.claude/kim-bridge');
const OUTBOX_DIR = path.join(BASE_DIR, 'outbox');
const INBOX_DIR = path.join(BASE_DIR, 'inbox');
const ARCHIVE_DIR = path.join(BASE_DIR, 'archive');
const STATE_FILE = path.join(BASE_DIR, 'state.json');

async function main() {
  console.log("Starting fake roundtrip test...");
  
  // Clean state for test
  if (fs.existsSync(OUTBOX_DIR)) fs.rmSync(OUTBOX_DIR, { recursive: true, force: true });
  if (fs.existsSync(INBOX_DIR)) fs.rmSync(INBOX_DIR, { recursive: true, force: true });
  if (fs.existsSync(ARCHIVE_DIR)) fs.rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);

  // We need to know the questionId, but askSecretary generates it inside.
  // We run a separate setTimeout to simulate Kim placing the answer.
  setTimeout(() => {
    // 1초 뒤에 outbox에 있는 파일을 찾아서 답변을 넣어줌
    const files = fs.readdirSync(OUTBOX_DIR);
    if (files.length > 0) {
      const qFile = files[0];
      const qId = qFile.replace('.json', '');
      console.log(`\n[Fake Kim] Found question ${qId} in outbox. Generating answer...`);
      
      const answerJson = {
        questionId: qId,
        answer: "A",
        answeredAt: new Date().toISOString(),
        source: "secretary"
      };
      
      fs.mkdirSync(INBOX_DIR, { recursive: true });
      fs.writeFileSync(path.join(INBOX_DIR, qFile), JSON.stringify(answerJson, null, 2));
      console.log(`[Fake Kim] Placed answer for ${qId} in inbox.\n`);
    }
  }, 1000); // 1 second later

  console.log("[Test] Calling askSecretary (dryRun = true, poll interval = 500ms)...");
  
  const answer = await askSecretary({
    question: "로컬 브리지 기능 구현 방향이 올바른지 확인해주세요.",
    options: {
      A: "그대로 진행",
      B: "수정 후 다시 보고"
    },
    recommendation: "A. 그대로 진행을 추천합니다.",
    context: "테스트 스크립트 실행 중"
  }, true, 500); // dryRun=true, interval=500ms

  console.log(`\n[Test] askSecretary returned: ${answer}`);
  
  let passed = true;
  if (answer === "A") {
    console.log("✅ Answer matches.");
  } else {
    console.log(`❌ Answer mismatch. Expected "A", got "${answer}"`);
    passed = false;
  }

  // Verify state
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const pendingCount = Object.keys(state.pending).length;
  if (pendingCount === 0 && state.lastProcessedId?.startsWith('q_')) {
    console.log("✅ State updated correctly (pending cleared, lastProcessedId set).");
  } else {
    console.log("❌ State not updated correctly:", state);
    passed = false;
  }

  // Verify archive
  const archives = fs.readdirSync(ARCHIVE_DIR);
  if (archives.length === 2 && archives.some(f => f.includes('-answer.json')) && archives.some(f => f.includes('-question.json'))) {
    console.log("✅ Files successfully moved to archive.");
  } else {
    console.log("❌ Files not in archive correctly:", archives);
    passed = false;
  }
  
  if (passed) {
    console.log("\n🚀 All tests passed! Local Bridge is working correctly.");
  } else {
    console.log("\n⚠️ Some tests failed. Please check the logs.");
    process.exit(1);
  }
}

main().catch(console.error);
