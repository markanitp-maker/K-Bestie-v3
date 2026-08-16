import fs from 'fs';

async function testSwRouteFile() {
  console.log('=== Verifying app/api/pwa/sw/route.ts File Content ===');
  const code = fs.readFileSync('app/api/pwa/sw/route.ts', 'utf8');

  const hasDynamicBuildId = code.includes('process.env.NEXT_PUBLIC_DEPLOYMENT_SHA') || code.includes('process.env.VERCEL_GIT_COMMIT_SHA');
  const hasSkipWaiting = code.includes('self.skipWaiting();');
  const hasOldCachePurge = code.includes('name.startsWith("kbestie-shell-") && name !== CACHE_NAME');
  const hasClientsClaim = code.includes('self.clients.claim();');
  const hasNoCacheHeaders = code.includes('no-cache, no-store, must-revalidate');

  console.log('1. Dynamic BUILD_ID & CACHE_NAME:', hasDynamicBuildId);
  console.log('2. Auto self.skipWaiting() on install:', hasSkipWaiting);
  console.log('3. Old cache purge on activate:', hasOldCachePurge);
  console.log('4. self.clients.claim() on activate:', hasClientsClaim);
  console.log('5. HTTP No-Cache Headers:', hasNoCacheHeaders);

  const passed = hasDynamicBuildId && hasSkipWaiting && hasOldCachePurge && hasClientsClaim && hasNoCacheHeaders;
  console.log('\n=== SW ROUTE FILE INTEGRITY STATUS ===:', passed ? 'PASSED ✅' : 'FAILED ❌');
}

testSwRouteFile().catch(console.error);
