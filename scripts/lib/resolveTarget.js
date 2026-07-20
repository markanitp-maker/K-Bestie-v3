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

module.exports = {
  resolveProjectRef,
  getTargetEnv
};
