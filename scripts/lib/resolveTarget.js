const PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk';
const DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus';

function getTargetEnv() {
  const args = process.argv.slice(2);
  const targetArg = args.find(a => a.startsWith('--target='));
  return targetArg ? targetArg.split('=')[1] : 'dev';
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
