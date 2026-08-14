import { PWA_CLIENT_VERSION } from "./clientVersion";

/**
 * 배포 하나를 가리키는 식별자. 클라이언트 번들과 서버가 같은 값을 갖고, 배포가
 * 바뀌면 값도 바뀐다.
 *
 * 왜 필요한가 — 2026-08-14 Production 장애에서 버전 식별이 통째로 죽어 있었다.
 * `PWA_CLIENT_VERSION`은 사람이 손으로 올리는 상수라, 상수를 안 올린 채 배포가
 * 나가면 (a) `/api/client-version`이 옛 클라이언트와 같은 값을 돌려주고,
 * (b) `sw.js` 본문이 바이트까지 동일해 서비스워커가 갱신되지 않는다. 그날 배포
 * 3회가 전부 그랬고, 그래서 아이가 앱을 껐다 켜도 옛 캐시에 계속 물려 있었다.
 * `NEXT_PUBLIC_DEPLOYMENT_SHA`도 CLI 배포에는 `VERCEL_GIT_COMMIT_SHA`가 없어
 * 프로덕션 전체가 `"local"`로 기록됐다(DB `client_version_events`로 확인).
 *
 * 값은 next.config.ts의 `env`가 빌드 시점에 인라인한다. 클라이언트 번들과 서버
 * 번들이 같은 빌드에서 같은 값을 굽기 때문에, 한 배포 안에서는 반드시 일치하고
 * 배포가 바뀔 때만 달라진다. 빌드마다 흔들리는 값(타임스탬프·난수)을 쓰면 같은
 * 배포 안에서 불일치가 나 새로고침이 반복되므로 절대 쓰지 않는다.
 */
export const BUILD_STAMP: string =
  (process.env.NEXT_PUBLIC_BUILD_STAMP || "").trim() || PWA_CLIENT_VERSION;

export function getServerDeploymentInfo(): {
  buildId: string;
  buildStamp: string;
  deploymentId: string;
  swVersion: string;
  serviceWorkerScriptUrl: string;
} {
  const buildStamp = BUILD_STAMP;
  const deploymentId =
    (process.env.VERCEL_DEPLOYMENT_ID || "").trim() || buildStamp;
  const swVersion = buildStamp ? `kbestie-shell-${buildStamp}` : "";
  const serviceWorkerScriptUrl = "/sw.js";

  return {
    buildId: buildStamp,
    buildStamp,
    deploymentId,
    swVersion,
    serviceWorkerScriptUrl,
  };
}
