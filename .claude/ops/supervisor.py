#!/usr/bin/env python3
import os
import sys
import json
import time
import subprocess
import shlex
import re

REGISTRY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'registry.json')
HERMES_CMD = "/mnt/c/Users/Home/AppData/Local/Programs/Python/Python313/Scripts/hermes.exe -p secretary send --to discord:1517194137604980866"

def load_registry():
    if os.path.exists(REGISTRY_FILE):
        with open(REGISTRY_FILE, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except:
                pass
    return {}

def save_registry(data):
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    with open(REGISTRY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def send_discord(message):
    cmd = f"{HERMES_CMD} {shlex.quote(message)}"
    for _ in range(2):
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
            if 'sent' in res.stdout.lower() or 'sent' in res.stderr.lower():
                return True
        except Exception:
            pass
        time.sleep(2)
    return False

def get_tmux_output(session, log_path):
    # Try tmux capture-pane first
    try:
        res = subprocess.run(['tmux', 'capture-pane', '-t', session, '-p', '-S', '-120'], capture_output=True, text=True)
        if res.returncode == 0:
            return res.stdout.strip().split('\n')
    except:
        pass
        
    # If tmux is gone, read from the log file
    try:
        if os.path.exists(log_path):
            with open(log_path, 'r', encoding='utf-8') as f:
                lines = f.read().strip().split('\n')
                return lines[-120:] if lines else []
    except:
        pass
    
    return None

def check_session_alive(session):
    res = subprocess.run(['tmux', 'has-session', '-t', session], capture_output=True)
    return res.returncode == 0

def file_mtime(path):
    try:
        if os.path.exists(path):
            return os.path.getmtime(path)
    except:
        pass
    return 0

def build_message(status, title, details, action, require_ack="없음"):
    msg = f"대표님, [K-Bestie-v3] 작업 상태: {status}\n\n"
    msg += f"✅ 확인된 상태\n- {title}\n"
    if details:
        msg += f"  ({details})\n"
    msg += f"\n🟡 다음 조치\n- {action}\n"
    msg += f"\n👤 대표님 확인\n- {require_ack}"
    return msg

def monitor(run_once=False):
    while True:
        registry = load_registry()
        changed = False
        now = time.time()
        
        for tid, task in list(registry.items()):
            events = task.get('events', {})
            session = task['session']
            status = task['status']
            task_type = task['type']
            
            # 1) Start Event
            if 'start' not in events:
                msg = build_message("진행 중", f"{task_type} 작업 시작됨", f"세션: {session}", "작업 감시 시작")
                if send_discord(msg):
                    events['start'] = True
                    changed = True

            # 2) Terminal states handling
            if status == 'completed':
                if not task.get('acked') and 'missing_report' not in events:
                    completed_time = task.get('completed_time', now)
                    if now - completed_time > 90:
                        msg = build_message("확인 필요", f"{task_type} 작업 완료 후 90초간 보고 누락됨", f"세션: {session}", "감시기가 누락 완료 보고를 대신 보냅니다.")
                        if send_discord(msg):
                            events['missing_report'] = True
                            task['status'] = 'missing_report'
                            changed = True
                continue
            elif status in ['failed', 'unresponsive', 'missing_report', 'retry_exceeded']:
                continue
                
            # 3) Running state checks
            alive = check_session_alive(session)
            output = get_tmux_output(session, task['log_path'])
            mtime = file_mtime(task['log_path'])
            
            if output:
                recent = output[-40:]
                joined_recent = '\n'.join(recent)
                
                # Check for normal completion
                if '__TASK_DONE__' in joined_recent:
                    task['status'] = 'completed'
                    task['completed_time'] = now
                    changed = True
                    continue
                
                # Check for crash/failure
                last_line = recent[-1] if recent else ""
                prompt_back = bool(re.match(r'^[^ \t]*[$%#>] $', last_line))
                exit_hint = bool(re.search(r'(exit code [0-9]|exited with|exit status [1-9])', joined_recent, re.IGNORECASE))
                
                if prompt_back or exit_hint:
                    retry_count = task.get('retry_count', 0) + 1
                    task['retry_count'] = retry_count
                    
                    if retry_count >= 3:
                        msg = build_message("중단", f"{task_type} 작업이 3회 연속 실패했습니다.", f"세션: {session}", "자동 재시도 한도를 초과해 메인 Claude 판단이 필요합니다.")
                        if send_discord(msg):
                            task['status'] = 'retry_exceeded'
                            events['retry_exceeded'] = True
                            changed = True
                    else:
                        msg = build_message("진행 중", f"{task_type} 작업 실패 감지됨", f"세션: {session}, 재시도 횟수: {retry_count}", "다음 감시 주기에 자동 재시도 대기")
                        if send_discord(msg):
                            # Not changing to failed yet, just recording the crash event and waiting for resume
                            pass
                        changed = True
                    continue

            # If dead and no output at all or missing task done
            if not alive:
                msg = build_message("중단", f"{task_type} 작업 세션이 예기치 않게 종료됨", f"세션: {session}", "메인 Claude 판단 필요")
                if send_discord(msg):
                    task['status'] = 'failed'
                    events['failed'] = True
                    changed = True
                continue

            # 4) Unresponsive Check (5 mins = 300s)
            last_activity = max(mtime, task.get('start_time', now))
            if now - last_activity > 300:
                msg = build_message("중단", f"{task_type} 작업이 5분 이상 무응답 상태입니다.", f"세션: {session}", "메인 Claude 판단 필요")
                if send_discord(msg):
                    task['status'] = 'unresponsive'
                    events['unresponsive'] = True
                    changed = True

        if changed:
            save_registry(registry)
            
        if run_once:
            break
            
        time.sleep(60)

def register(tid, type_, session, log_path):
    registry = load_registry()
    registry[tid] = {
        'project': 'K-Bestie-v3',
        'type': type_,
        'session': session,
        'start_time': time.time(),
        'log_path': log_path,
        'retry_count': 0,
        'status': 'running',
        'events': {},
        'acked': False
    }
    save_registry(registry)
    print(f"Registered {tid}")

def ack(tid):
    registry = load_registry()
    if tid in registry:
        registry[tid]['acked'] = True
        save_registry(registry)
        print(f"Acked {tid}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: supervisor.py [monitor | monitor --once | register <id> <type> <session> <log> | ack <id>]")
        sys.exit(1)
    
    cmd = sys.argv[1]
    if cmd == 'monitor':
        monitor(run_once=('--once' in sys.argv))
    elif cmd == 'register' and len(sys.argv) == 6:
        register(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif cmd == 'ack' and len(sys.argv) == 3:
        ack(sys.argv[2])
    else:
        print("Invalid arguments")
