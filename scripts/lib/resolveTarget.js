const PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk';
const DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus';

// 2026-08-11 사고 대응 게이트① 지적: 이전에는 임의 문자열을 그대로 허용해
// --target=dev-a 처럼 지어낸 값도 resolveProjectRef()에서 'prod'가 아니면
// 전부 Dev로 보내면서, 마이그레이션 추적 키(target_env)는 그 지어낸 문자열
// 그대로 써서 같은 Dev DB에 서로 다른 추적 키로 동일 파일을 --force 없이
// 재실행할 수 있었다. dev/prod 두 값만 엄격히 허용한다.
function getTargetEnv() {
  const args = process.argv.slice(2);
  const targetArg = args.find(a => a.startsWith('--target='));
  if (!targetArg) return 'dev';
  const value = targetArg.split('=')[1];
  if (value !== 'dev' && value !== 'prod') {
    console.error(`오류: --target 값은 'dev' 또는 'prod'만 허용됩니다 (입력값: ${value}).`);
    process.exit(1);
  }
  return value;
}

function resolveProjectRef() {
  const target = getTargetEnv();

  if (target === 'prod') {
    return PROD_PROJECT_REF;
  }
  return DEV_PROJECT_REF;
}

function assertProdConfirmed() {
  const target = getTargetEnv();
  if (target === 'prod') {
    const args = process.argv.slice(2);
    const hasConfirm = args.includes('--confirm=PRODUCTION');
    if (!hasConfirm) {
      console.error('오류: Production 환경에 적용하려면 --target=prod와 함께 반드시 --confirm=PRODUCTION 플래그를 명시해야 합니다.');
      console.error('예시: node scripts/apply-migration.js <파일> --target=prod --confirm=PRODUCTION');
      process.exit(1);
    }
  }
}

module.exports = {
  resolveProjectRef,
  getTargetEnv,
  assertProdConfirmed
};
