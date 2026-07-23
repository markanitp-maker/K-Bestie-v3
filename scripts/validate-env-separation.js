#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');

const PROD_REF = 'fetvnhhjicndmxvhrffk';
const DEV_REF = 'mkrsaaedxqrcrktapaus';

if (!fs.existsSync(envPath)) {
  console.log('OK: .env.local not found, skipping check.');
  process.exit(0);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};

envContent.split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

let hasError = false;

// Check Dev URL
if (envVars['NEXT_PUBLIC_SUPABASE_DEV_URL']) {
  const devUrl = envVars['NEXT_PUBLIC_SUPABASE_DEV_URL'];
  if (!devUrl.includes(DEV_REF)) {
    console.error(`ERROR: NEXT_PUBLIC_SUPABASE_DEV_URL does not contain Dev ref (${DEV_REF}).`);
    hasError = true;
  }
  if (devUrl.includes(PROD_REF)) {
    console.error(`ERROR: NEXT_PUBLIC_SUPABASE_DEV_URL contains Production ref (${PROD_REF}).`);
    hasError = true;
  }
}

// Check Prod URL
if (envVars['NEXT_PUBLIC_SUPABASE_URL']) {
  const prodUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];
  if (prodUrl.includes(DEV_REF)) {
    console.error(`ERROR: NEXT_PUBLIC_SUPABASE_URL contains Dev ref (${DEV_REF}).`);
    hasError = true;
  }
}

// Check Dev Anon Key
if (envVars['NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY']) {
  const devKey = envVars['NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY'];
  if (devKey.includes(PROD_REF)) {
    console.error(`ERROR: NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY contains Production ref (${PROD_REF}).`);
    hasError = true;
  }
}

// Check Prod Anon Key
if (envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  const prodKey = envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (prodKey.includes(DEV_REF)) {
    console.error(`ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY contains Dev ref (${DEV_REF}).`);
    hasError = true;
  }
}

// Check Dev Service Role Key
if (envVars['SUPABASE_DEV_SERVICE_ROLE_KEY']) {
  const devKey = envVars['SUPABASE_DEV_SERVICE_ROLE_KEY'];
  if (devKey.includes(PROD_REF)) {
    console.error(`ERROR: SUPABASE_DEV_SERVICE_ROLE_KEY contains Production ref (${PROD_REF}).`);
    hasError = true;
  }
}

// Check Prod Service Role Key
if (envVars['SUPABASE_SERVICE_ROLE_KEY']) {
  const prodKey = envVars['SUPABASE_SERVICE_ROLE_KEY'];
  if (prodKey.includes(DEV_REF)) {
    console.error(`ERROR: SUPABASE_SERVICE_ROLE_KEY contains Dev ref (${DEV_REF}).`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\nFAILED: Dev/Production environment separation is compromised.');
  process.exit(1);
}

console.log('OK: Dev/Production 환경 분리 확인 완료');
process.exit(0);
