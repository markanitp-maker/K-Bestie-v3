const fs = require('fs');
const path = require('path');

const PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk';
const DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus';

const chunksDir = path.join(__dirname, '../.next/static/chunks');

let found = false;

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
      if (content.includes(PROD_PROJECT_REF) || content.includes(DEV_PROJECT_REF) || content.includes('supabase.co')) {
        found = true;
      }
    }
  }
}

walk(chunksDir);

if (!found) {
  console.error(`FATAL: Supabase URL 값이 클라이언트 번들에 인라인되지 않았습니다.`);
  process.exit(1);
} else {
  console.log(`SUCCESS: Supabase URL 값이 클라이언트 번들에서 확인되었습니다.`);
  process.exit(0);
}


