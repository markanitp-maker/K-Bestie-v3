import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdmin';
import { getGcaiEnvKeys, type GcaiProfile } from '@/app/api/_lib/gcaiProfiles';
import { getModelForGroup, VERTEX_LIVE_VOICE_MODEL_ID } from '@/app/api/_lib/ai';
import { createServiceClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';

export async function GET(request: Request) {
  const authResponse = await requireAdmin();
  if (authResponse) return authResponse;

  const { searchParams } = new URL(request.url);
  const profile = searchParams.get('profile');

  if (profile !== 'A' && profile !== 'B') {
    return NextResponse.json({ error: 'Invalid profile. Must be A or B' }, { status: 400 });
  }

  const envKeys = getGcaiEnvKeys(profile as GcaiProfile);
  const requiredKeys = Object.entries(envKeys);
  const missingKeys = requiredKeys
    .filter(([, keyName]) => !process.env[keyName])
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    return NextResponse.json({ status: '미설정', missingKeys }, { status: 200 });
  }

  const checks: Record<string, { status: string; detail?: string; ms?: number }> = {};
  let allPassed = true;

  const runCheck = async (name: string, checkFn: () => Promise<void>) => {
    const start = Date.now();
    try {
      await checkFn();
      checks[name] = { status: 'ok', ms: Date.now() - start };
    } catch (e: any) {
      checks[name] = { status: 'fail', detail: e.message || 'Unknown error', ms: Date.now() - start };
      allPassed = false;
    }
  };

  const keyJson = process.env[envKeys.GCP_VERTEX_SA_KEY_JSON]!;
  const project = process.env[envKeys.GOOGLE_CLOUD_PROJECT]!;
  const location = process.env[envKeys.GOOGLE_CLOUD_LOCATION] || 'us-central1';

  let ai: GoogleGenAI | null = null;
  let aiInitError: Error | null = null;
  try {
    const credentials = JSON.parse(keyJson);
    ai = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: { credentials }
    });
  } catch (e: any) {
    aiInitError = new Error('Invalid GCP_VERTEX_SA_KEY_JSON format');
  }

  const checkTextModel = async (groupId: 'A' | 'B') => {
    if (aiInitError || !ai) throw aiInitError;
    const modelConfig = await getModelForGroup(groupId);
    await ai.models.generateContent({
      model: modelConfig.modelId,
      contents: 'ping',
      config: { maxOutputTokens: 1 }
    });
  };

  await Promise.allSettled([
    runCheck('groupA', () => checkTextModel('A')),
    runCheck('groupB', () => checkTextModel('B')),
    runCheck('groupC', async () => {
      if (aiInitError || !ai) throw aiInitError;
      await ai.models.generateContent({
        model: VERTEX_LIVE_VOICE_MODEL_ID,
        contents: 'ping',
        config: { maxOutputTokens: 1 }
      });
    }),
    runCheck('stt', async () => {
      const sttKey = process.env[envKeys.GCP_STT_API_KEY]!;
      const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${sttKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { languageCode: 'en-US' }, audio: { content: 'AA==' } })
      });
      if (!res.ok) throw new Error('STT check failed: ' + await res.text());
    }),
    runCheck('tts', async () => {
      const ttsKey = process.env[envKeys.GCP_TTS_API_KEY]!;
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${ttsKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text: 'a' }, voice: { languageCode: 'en-US' }, audioConfig: { audioEncoding: 'MP3' } })
      });
      if (!res.ok) throw new Error('TTS check failed: ' + await res.text());
    })
  ]);

  const result = {
    profile,
    checks,
    allPassed
  };

  try {
    const serviceClient = createServiceClient();
    await serviceClient.from('gcai_profiles').upsert({
      profile,
      last_health_check_at: new Date().toISOString(),
      last_health_check_result: checks
    }, { onConflict: 'profile' });
  } catch (e) {
    // Ignore db write failure for health check endpoint itself to remain resilient
    console.error('Failed to update gcai_profiles', e);
  }

  return NextResponse.json(result);
}
