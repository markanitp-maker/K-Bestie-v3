import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const authResponse = await requireAdmin();
  if (authResponse) return authResponse;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { targetProfile } = body;

  if (targetProfile !== 'A' && targetProfile !== 'B') {
    return NextResponse.json({ error: 'Invalid targetProfile. Must be A or B' }, { status: 400 });
  }

  const healthUrl = new URL(`/api/admin/gcai-health?profile=${targetProfile}`, request.url);
  
  let healthRes;
  try {
    healthRes = await fetch(healthUrl.toString(), {
      headers: {
        cookie: request.headers.get('cookie') || '',
        authorization: request.headers.get('authorization') || '',
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Health check request failed', detail: e.message }, { status: 500 });
  }

  if (!healthRes.ok) {
    return NextResponse.json({ error: 'Health check returned error', status: healthRes.status }, { status: 500 });
  }

  const healthData = await healthRes.json();

  if (healthData.status === '미설정') {
    return NextResponse.json({ error: '미설정된 환경변수가 있습니다.', missingKeys: healthData.missingKeys }, { status: 400 });
  }

  if (!healthData.allPassed) {
    const failedChecks = Object.entries(healthData.checks || {})
      .filter(([, c]: any) => c.status !== 'ok')
      .map(([name]) => name);
    return NextResponse.json({ error: 'Health check failed', failedChecks }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const otherProfile = targetProfile === 'A' ? 'B' : 'A';

  // Using Promise.allSettled for parallel non-blocking execution (rule checklist)
  const results = await Promise.allSettled([
    serviceClient.from('gcai_profiles').update({ is_active: true }).eq('profile', targetProfile),
    serviceClient.from('gcai_profiles').update({ is_active: false }).eq('profile', otherProfile)
  ]);

  const hasError = results.some(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
  if (hasError) {
    return NextResponse.json({ error: '프로필 전환 중 일부 실패. 롤백이 필요할 수 있습니다.' }, { status: 500 });
  }

  return NextResponse.json({
    message: 'DB의 권장 활성 프로필만 갱신됨 — 실제 적용은 Vercel 환경변수 GCAI_ACTIVE_PROFILE을 수동으로 바꾼 뒤 재배포 필요',
    targetProfile
  });
}
