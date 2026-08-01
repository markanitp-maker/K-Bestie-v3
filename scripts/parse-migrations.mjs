import fs from 'fs';
const logContent = fs.readFileSync('C:\\Users\\Home\\.gemini\\antigravity-ide\\brain\\c85bec54-2fa8-4715-a38d-980d30469161\\.system_generated\\tasks\\task-380.log', 'utf8');

const match = logContent.match(/\[.*?\]/s);
if (match) {
  try {
    const data = JSON.parse(match[0]);
    const target = ['20260721300000', '20260721300001', '20260725100000', '20260725100001'];
    
    console.log("DB applied versions:");
    data.forEach(m => {
      if (target.includes(m.local) || target.includes(m.remote)) {
        console.log(`Version ${m.local || m.remote} - Local: ${!!m.local}, Remote: ${!!m.remote}`);
      }
    });
  } catch (e) {
    console.error("Parse error", e);
  }
}
