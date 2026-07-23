#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');

const PROD_REF = 'fetvnhhjicndmxvhrffk';
const DEV_REF = 'mkrsaaedxqrcrktapaus';

const DEV_RELAY_HOST = 'vertex-live-relay-dev-611941846194.us-west1.run.app';
const PROD_RELAY_HOST = 'vertex-live-relay-zdxagols5q-uw.a.run.app';

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  });
}

if (!process.env['NEXT_PUBLIC_SUPABASE_DEV_URL'] && !process.env['NEXT_PUBLIC_SUPABASE_URL']) {
  console.log('OK: Dev/Production 환경 분리 확인 완료');
  process.exit(0);
}

let hasError = false;
const envVars = process.env;

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

// Check Vertex Live Relay URL
if (envVars['VERTEX_LIVE_RELAY_URL']) {
  const relayUrl = envVars['VERTEX_LIVE_RELAY_URL'];
  const target = envVars['NEXT_PUBLIC_SUPABASE_TARGET'] || 'dev';

  if (target === 'dev' && relayUrl.includes(PROD_RELAY_HOST)) {
    console.error(`ERROR: target is 'dev' but VERTEX_LIVE_RELAY_URL contains Production relay host (${PROD_RELAY_HOST}).`);
    hasError = true;
  }
  if (target === 'prod' && relayUrl.includes(DEV_RELAY_HOST)) {
    console.error(`ERROR: target is 'prod' but VERTEX_LIVE_RELAY_URL contains Dev relay host (${DEV_RELAY_HOST}).`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\nFAILED: Dev/Production environment separation is compromised.');
  process.exit(1);
}

console.log('OK: Dev/Production 환경 분리 확인 완료');
process.exit(0);
