const fs = require('fs');
const path = require('path');

const PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk';
const DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus';

const target = (process.env.NEXT_PUBLIC_SUPABASE_TARGET === 'prod' || (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL.includes(PROD_PROJECT_REF))) ? 'prod' : 'dev';

const expectedUrl = target === 'prod' ? `${PROD_PROJECT_REF}.supabase.co` : `${DEV_PROJECT_REF}.supabase.co`;

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
      if (content.includes(expectedUrl)) {
        found = true;
      }
    }
  }
}

walk(chunksDir);

if (!found) {
  console.error(`FATAL: NEXT_PUBLIC_SUPABASE_${target === 'prod' ? 'URL' : 'DEV_URL'} 값이 클라이언트 번들에 인라인되지 않았습니다 (예상 문자열: ${expectedUrl})`);
  process.exit(1);
} else {
  console.log(`SUCCESS: NEXT_PUBLIC_SUPABASE_${target === 'prod' ? 'URL' : 'DEV_URL'} 값이 클라이언트 번들에서 확인되었습니다.`);
  process.exit(0);
}

