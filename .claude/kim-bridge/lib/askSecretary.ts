import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const BASE_DIR = path.join(process.cwd(), '.claude/kim-bridge');
const OUTBOX_DIR = path.join(BASE_DIR, 'outbox');
const INBOX_DIR = path.join(BASE_DIR, 'inbox');
const ARCHIVE_DIR = path.join(BASE_DIR, 'archive');
const STATE_FILE = path.join(BASE_DIR, 'state.json');

function ensureDirectories() {
  [OUTBOX_DIR, INBOX_DIR, ARCHIVE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastProcessedId: null, pending: {} }, null, 2));
  }
}

function updateStatePending(questionId: string, add: boolean) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  if (add) {
    state.pending[questionId] = true;
  } else {
    delete state.pending[questionId];
    state.lastProcessedId = questionId;
  }
  const tempFile = `${STATE_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, STATE_FILE);
}

function generateQuestionId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `q_${year}${month}${day}_${hours}${minutes}${seconds}_${rand}`;
}



export interface QuestionData {
  projectName?: string;
  question: string;
  options?: Record<string, string>;
  recommendation?: string;
  context?: string;
}

export async function askSecretary(data: QuestionData, dryRun = false, pollIntervalMs = 15000): Promise<string> {
  ensureDirectories();

  const questionId = generateQuestionId();
  const projectName = data.projectName || 'K-Bestie-v3';
  
  const questionJson = {
    projectName,
    questionId,
    status: "confirmation_required",
    question: data.question,
    options: data.options || {},
    recommendation: data.recommendation || "",
    context: data.context || "",
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(OUTBOX_DIR, `${questionId}.json`), JSON.stringify(questionJson, null, 2));
  updateStatePending(questionId, true);

  let optionsStr = "";
  if (data.options) {
    for (const [key, val] of Object.entries(data.options)) {
      optionsStr += `${key}. ${val}\n`;
    }
  }

  const hermesMsg = `대표님, [${projectName}] 확인 필요\n\n❓ ${data.question}\n\n선택지\n${optionsStr}\n💡 권고: ${data.recommendation}\n\n답변 형식: [${questionId}] A 처럼 보내주시면 됩니다.`;

  if (!dryRun) {
    const hermesExe = '/mnt/c/Users/Home/AppData/Local/Programs/Python/Python313/Scripts/hermes.exe';
    const hermesArgs = ['-p', 'secretary', 'send', '--to', 'discord:1517194137604980866', hermesMsg];
    
    let success = false;
    for (let i = 0; i < 2; i++) {
      try {
        const { stdout, stderr } = await execFileAsync(hermesExe, hermesArgs);
        if (stdout.includes('sent') || stderr.includes('sent')) {
          success = true;
          break;
        }
      } catch (err: any) {
        if (err.stdout?.includes('sent') || err.stderr?.includes('sent')) {
          success = true;
          break;
        }
        console.error(`hermes send attempt ${i + 1} failed:`, err.message);
      }
    }
    
    if (!success) {
      console.error(`Failed to send message via hermes for question ${questionId}`);
      updateStatePending(questionId, false);
      return "ERROR_SEND_FAILED";
    }
  } else {
    console.log(`[DRY RUN] Would have sent to hermes:`);
    console.log(hermesMsg);
  }

  // Polling for inbox
  const maxWaitMs = 30 * 60 * 1000; // 30 minutes max wait
  let waitedMs = 0;

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      waitedMs += pollIntervalMs;
      const inboxFile = path.join(INBOX_DIR, `${questionId}.json`);
      
      if (fs.existsSync(inboxFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
          if (!state.pending[questionId]) {
            console.warn(`[Warning] questionId ${questionId} is not in pending state. Ignoring.`);
            fs.renameSync(inboxFile, path.join(ARCHIVE_DIR, `rejected_${questionId}_not_pending.json`));
            return;
          }
          
          const inboxContent = fs.readFileSync(inboxFile, 'utf-8');
          const inboxData = JSON.parse(inboxContent);
          
          if (inboxData.questionId !== questionId) {
            console.warn(`[Warning] Inbox questionId mismatch for ${questionId}. Ignoring.`);
            fs.renameSync(inboxFile, path.join(ARCHIVE_DIR, `rejected_${questionId}_mismatch.json`));
            return;
          }
          
          clearInterval(timer);
          
          // Pure string conversion, no eval/exec
          const answerStr = String(inboxData.answer);
          
          // Move to archive
          fs.renameSync(
            path.join(OUTBOX_DIR, `${questionId}.json`),
            path.join(ARCHIVE_DIR, `${questionId}-question.json`)
          );
          fs.renameSync(
            inboxFile,
            path.join(ARCHIVE_DIR, `${questionId}-answer.json`)
          );
          
          updateStatePending(questionId, false);
          
          if (!dryRun) {
            await reportProgress(`답변 수신, ${answerStr}으로 작업 재개`, projectName, dryRun);
          } else {
            console.log(`[DRY RUN] 답변 수신, ${answerStr}으로 작업 재개`);
          }
          
          resolve(answerStr);
        } catch (err) {
          console.error("Error parsing inbox file or updating state:", err);
          resolve("ERROR_PROCESSING_INBOX");
        }
      }
      
      if (waitedMs >= maxWaitMs) {
        clearInterval(timer);
        console.error(`Timeout waiting for answer to question ${questionId}`);
        updateStatePending(questionId, false);
        resolve("TIMEOUT");
      }
    }, pollIntervalMs);
  });
}

export async function reportProgress(message: string, projectName = 'K-Bestie-v3', dryRun = false) {
  ensureDirectories();
  const hermesMsg = `[${projectName} 진행 보고]\n${message}`;
  
  if (!dryRun) {
    const hermesExe = '/mnt/c/Users/Home/AppData/Local/Programs/Python/Python313/Scripts/hermes.exe';
    const hermesArgs = ['-p', 'secretary', 'send', '--to', 'discord:1517194137604980866', hermesMsg];
    try {
      await execFileAsync(hermesExe, hermesArgs);
    } catch (err) {
      console.error(`hermes progress report failed:`, err);
    }
  } else {
    console.log(`[DRY RUN] Would have sent progress report to hermes:`);
    console.log(hermesMsg);
  }
}
