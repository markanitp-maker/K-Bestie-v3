const fs = require('fs');
const { execSync, execFileSync } = require('child_process');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, 'registry.json');
const PROJECT_NAME = "K-Bestie-v3";
// test mode if --test is passed
const IS_TEST = process.argv.includes('--test');
const UNRESPONSIVE_MS = IS_TEST ? 10 * 1000 : 10 * 60 * 1000;
const MISSING_CONFIRM_MS = IS_TEST ? 10 * 1000 : 90 * 1000;

function loadRegistry() {
    if (fs.existsSync(REGISTRY_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
            if (!data.tasks) data.tasks = {};
            return data;
        } catch (e) {
            return { tasks: {} };
        }
    }
    return { tasks: {} };
}

function saveRegistry(reg) {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), 'utf8');
}

function getTmuxSessions() {
    try {
        const out = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return out.split('\n').filter(s => s.trim().length > 0);
    } catch (e) {
        return [];
    }
}

function getTmuxOutput(session) {
    try {
        const out = execSync(`tmux capture-pane -t "${session}" -p -S -120`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return out;
    } catch (e) {
        return null;
    }
}

function checkIsCrashed(output) {
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;
    const recent = lines.slice(-40);
    
    // exit hints
    for (const line of recent) {
        if (/exit code [0-9]|exited with|exit status [1-9]/i.test(line)) {
            return true;
        }
    }
    
    // shell prompt back
    const lastLine = recent[recent.length - 1];
    if (/^[^ \t]*[$%#>] $/.test(lastLine)) {
        return true;
    }
    
    return false;
}

function getFileMTime(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (e) {
        return null;
    }
}

function sendDiscord(message) {
    const cmdPath = '/mnt/c/Users/Home/AppData/Local/Programs/Python/Python313/Scripts/hermes.exe';
    const args = [
        '-p', 'secretary',
        'send',
        '--to', 'discord:1517194137604980866',
        message
    ];
    let success = false;
    for (let i = 0; i < 2; i++) {
        try {
            const out = execFileSync(cmdPath, args, { encoding: 'utf8' });
            if (out.includes('sent')) {
                success = true;
                break;
            }
        } catch (e) {
            // failed, retry
            console.error("Discord send failed, retrying...", e.message);
        }
    }
    return success;
}

function formatMessage(title, events) {
    let body = `대표님, [${PROJECT_NAME}] 작업 상태: ${title}\n\n✅ 확인된 상태\n`;
    for (const ev of events) {
        body += `- ${ev.msg}\n`;
    }
    body += `\n🟡 다음 조치\n- ${events[0].action}\n\n👤 대표님 확인\n- 없음`;
    return body;
}

function reportEvent(task, eventType) {
    if (task.events_reported[eventType]) return true;

    let msg = "";
    let action = "메인 Claude 판단이 필요합니다.";
    let title = "알림";

    if (eventType === 'start') {
        title = "진행 중";
        msg = `${task.task_type} 작업(${task.task_id})이 시작되었습니다.`;
        action = "작업 완료를 대기합니다.";
    } else if (eventType === 'done') {
        title = "완료";
        msg = `${task.task_type} 작업(${task.task_id})이 정상 완료되었습니다.`;
        action = "다음 지시를 대기합니다.";
    } else if (eventType === 'failed') {
        title = "중단";
        msg = `${task.task_type} 작업(${task.task_id})이 실패·크래시 상태입니다.`;
        action = "자동 복구 또는 메인 Claude 개입이 필요합니다.";
    } else if (eventType === 'unresponsive') {
        title = "확인 필요";
        msg = `${task.task_type} 작업(${task.task_id})이 일정 시간 응답이 없습니다.`;
        action = "작업 상태 점검이 필요합니다.";
    } else if (eventType === 'retry_exceeded') {
        title = "중단";
        msg = `${task.task_type} 작업(${task.task_id})이 재시도 한도를 초과했습니다.`;
        action = "메인 Claude 개입이 필요합니다.";
    } else if (eventType === 'missing_confirmation') {
        title = "확인 필요";
        msg = `${task.task_type} 작업(${task.task_id})이 완료됐으나 작업자 보고가 누락되었습니다.`;
        action = "감시기가 대신 완료 보고를 발송합니다.";
    }

    const formatted = formatMessage(title, [{ msg, action }]);
    console.log(`Sending Discord:\n${formatted}`);
    
    if (sendDiscord(formatted)) {
        task.events_reported[eventType] = true;
        return true;
    }
    return false;
}

function syncTasks() {
    const reg = loadRegistry();
    const activeSessions = getTmuxSessions();
    const now = Date.now();

    // 1. Register new sessions
    for (const session of activeSessions) {
        const match = session.match(/^(agy(?:-qa)?|codex|claude-review)-(.*)$/);
        if (match) {
            const task_type = match[1];
            const task_id = match[2];
            if (!reg.tasks[session]) {
                reg.tasks[session] = {
                    task_id,
                    project_name: PROJECT_NAME,
                    task_type,
                    tmux_session: session,
                    start_time: now,
                    log_path: `/tmp/${session}.log`,
                    retry_count: 0,
                    current_state: "running",
                    events_reported: {},
                    done_time: null,
                    confirmed: false,
                    last_activity_time: now
                };
            }
        }
    }

    // 2. Process all tasks
    for (const session in reg.tasks) {
        const task = reg.tasks[session];
        if (task.confirmed && task.events_reported.done) continue; // fully done and confirmed

        if (!task.events_reported.start) {
            reportEvent(task, 'start');
        }

        const isAlive = activeSessions.includes(session);
        let output = null;

        if (isAlive) {
            output = getTmuxOutput(session);
        }

        if (output && output.includes('__TASK_DONE__')) {
            if (task.current_state !== 'done') {
                task.current_state = 'done';
                task.done_time = now;
                reportEvent(task, 'done');
            }
        } else if (isAlive && output && checkIsCrashed(output)) {
            if (task.current_state !== 'failed') {
                task.current_state = 'failed';
                task.retry_count++;
                if (task.retry_count >= 3) {
                    reportEvent(task, 'retry_exceeded');
                } else {
                    reportEvent(task, 'failed');
                }
            }
        } else if (!isAlive && task.current_state === 'running') {
            // disappeared without done
            task.current_state = 'failed';
            task.retry_count++;
            reportEvent(task, 'failed');
        } else if (isAlive && output && !checkIsCrashed(output) && !output.includes('__TASK_DONE__')) {
            // It resumed running
            if (task.current_state === 'failed') {
                task.current_state = 'running';
                task.events_reported['failed'] = false; // Allow reporting failure again
            }
        }

        // Check responsiveness
        if (task.current_state === 'running') {
            const mtime = getFileMTime(task.log_path);
            if (mtime) {
                // If log updated, reset last activity
                if (!task.last_mtime || mtime > task.last_mtime) {
                    task.last_activity_time = now;
                    task.last_mtime = mtime;
                }
            }
            if (now - task.last_activity_time > UNRESPONSIVE_MS) {
                if (!task.events_reported.unresponsive) {
                    reportEvent(task, 'unresponsive');
                }
            }
        }

        // Check missing confirmation
        if (task.current_state === 'done' && !task.confirmed) {
            if (now - task.done_time > MISSING_CONFIRM_MS) {
                if (!task.events_reported.missing_confirmation) {
                    reportEvent(task, 'missing_confirmation');
                }
            }
        }
    }

    saveRegistry(reg);
}

const args = process.argv.slice(2).filter(a => a !== '--test');
if (args[0] === 'confirm') {
    const session = args[1];
    const reg = loadRegistry();
    if (reg.tasks[session]) {
        reg.tasks[session].confirmed = true;
        saveRegistry(reg);
        console.log(`Task ${session} confirmed.`);
    } else {
        console.log(`Task ${session} not found in registry.`);
    }
} else if (args[0] === 'watch') {
    console.log("Starting watchdog...");
    syncTasks();
    setInterval(syncTasks, 10000); // Check every 10 seconds (useful for tests)
} else {
    // just run once
    syncTasks();
}
