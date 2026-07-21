const fs = require('fs');
const path = require('path');

const chunksDir = path.join(__dirname, '../.next/static/chunks');

const SECRETS_TO_CHECK = [
  'GCP_VERTEX_SA_KEY_JSON',
  'GCP_BILLING_SA_KEY_JSON',
  'GCP_STT_API_KEY',
  'GCP_TTS_API_KEY',
  'VERTEX_LIVE_RELAY_SECRET',
  'GEMINI_API_KEY',
  'GEMMA_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GCAI_B_VERTEX_SA_KEY_JSON',
  'GCAI_B_STT_API_KEY',
  'GCAI_B_TTS_API_KEY',
  'GCAI_B_VERTEX_LIVE_RELAY_SECRET'
];

let leakedSecrets = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walk(filePath);
    } else if (filePath.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const secret of SECRETS_TO_CHECK) {
        if (content.includes(secret)) {
          leakedSecrets.push({ file: filePath, secret });
        }
      }
    }
  }
}

walk(chunksDir);

if (leakedSecrets.length > 0) {
  console.error(`FATAL: 클라이언트 번들에서 서버 전용 비밀키 참조가 발견되었습니다!`);
  for (const leak of leakedSecrets) {
    console.error(` - 파일: ${leak.file}, 시크릿: ${leak.secret}`);
  }
  process.exit(1);
} else {
  console.log(`SUCCESS: 클라이언트 번들에 서버 전용 비밀키가 노출되지 않았습니다.`);
  process.exit(0);
}
