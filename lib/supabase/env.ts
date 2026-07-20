export const PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk';
export const DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus';

export type SupabaseTarget = 'dev' | 'prod';

export function getSupabaseTarget(): SupabaseTarget {
  const target = process.env.NEXT_PUBLIC_SUPABASE_TARGET;
  if (target === 'prod') {
    return 'prod';
  }
  return 'dev'; // 미설정이거나 다른 값이면 무조건 dev로 폴백 (안전한 기본값)
}

function checkProjectRefMismatch(target: SupabaseTarget, url: string, targetName: string) {
  if (target === 'dev' && url.includes(PROD_PROJECT_REF)) {
    throw new Error(`Fatal: Target is 'dev' but ${targetName} contains Production project ref.`);
  }
  if (target === 'prod' && url.includes(DEV_PROJECT_REF)) {
    throw new Error(`Fatal: Target is 'prod' but ${targetName} contains Dev project ref.`);
  }
}

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    const target = getSupabaseTarget();
    throw new Error(`Fatal: NEXT_PUBLIC_SUPABASE_TARGET=${target} 인데 ${name}이(가) 설정되지 않음`);
  }
  return value;
}

export function getSupabaseUrl(): string {
  const target = getSupabaseTarget();
  const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const devUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
  const url = target === 'prod' ? prodUrl : devUrl;
  const envName = target === 'prod' ? 'NEXT_PUBLIC_SUPABASE_URL' : 'NEXT_PUBLIC_SUPABASE_DEV_URL';
  if (!url) {
    throw new Error(`Fatal: NEXT_PUBLIC_SUPABASE_TARGET=${target} 인데 ${envName}이(가) 설정되지 않음`);
  }
  checkProjectRefMismatch(target, url, envName);
  return url;
}

export function getSupabaseAnonKey(): string {
  const target = getSupabaseTarget();
  const prodKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const devKey = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
  const key = target === 'prod' ? prodKey : devKey;
  const envName = target === 'prod' ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : 'NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY';
  if (!key) {
    throw new Error(`Fatal: NEXT_PUBLIC_SUPABASE_TARGET=${target} 인데 ${envName}이(가) 설정되지 않음`);
  }
  return key;
}

export function getSupabaseServiceRoleKey(): string {
  const target = getSupabaseTarget();
  const envName = target === 'prod' ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_DEV_SERVICE_ROLE_KEY';
  return getEnvVar(envName);
}

function maskProjectRef(ref: string): string {
  if (ref.length <= 8) return '***';
  return `${ref.substring(0, 4)}...${ref.substring(ref.length - 4)}`;
}

export function getSupabaseEnvironmentSummary() {
  const target = getSupabaseTarget();
  let url = '';
  try {
    url = getSupabaseUrl();
  } catch (e: any) {
    return {
      target,
      projectRefMasked: null,
      ok: false,
      error: e.message,
    };
  }
  
  let refMasked = 'N/A';
  if (url.includes(PROD_PROJECT_REF)) {
    refMasked = maskProjectRef(PROD_PROJECT_REF);
  } else if (url.includes(DEV_PROJECT_REF)) {
    refMasked = maskProjectRef(DEV_PROJECT_REF);
  }

  return {
    target,
    projectRefMasked: refMasked,
    ok: true,
  };
}
