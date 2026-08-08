import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { getOffsetDateStr, toKSTDateStr } from "../lib/analytics/kstDate";
import { computeChildActivityMetrics } from "../lib/admin/retentionChildMetrics";

config({ path: process.env.KBESTIE_ENV_FILE || ".env.local", override: false });

type Target = "development" | "production";
const names = ["안서현", "고나연"];
// 요청 당시 대표 값은 운영 데이터가 추가되면 자연스럽게 변하는 참고 스냅샷이다.
// 검증의 합격 기준은 아래 고정값이 아니라 같은 조회 시점의 원본 슬롯/이벤트와
// computeChildActivityMetrics 결과가 정확히 일치하는지 여부다.
const productionReferenceSnapshot = new Map([
  ["안서현", { attempts: 13, completed: 11, event: "7/60" }],
  ["고나연", { attempts: 9, completed: 6, event: "5/60" }],
]);

function credentials(target: Target) {
  if (target === "production") {
    return { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.SUPABASE_SERVICE_ROLE_KEY! };
  }
  return { url: process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!, key: process.env.SUPABASE_DEV_SERVICE_ROLE_KEY! };
}

async function main() {
for (const target of ["development", "production"] as const) {
  const { url, key } = credentials(target);
  if (!url || !key) throw new Error(`${target}: credentials missing`);
  const service = createClient(url, key, { auth: { persistSession: false } });
  const { data: children, error: childError } = await service
    .from("child_profiles")
    .select("id,name")
    .in("name", names);
  if (childError) throw childError;

  const today = toKSTDateStr(new Date().toISOString());
  const range = { fromStr: getOffsetDateStr(today, -6), toStr: today };
  const childIds = (children ?? []).map((child) => child.id);
  const metrics = await computeChildActivityMetrics(service, childIds, range);
  const { data: rawRows, error: rawError } = childIds.length
    ? await service.from("mission_progress").select("child_id,business_date,round_type,status").in("child_id", childIds)
    : { data: [], error: null };
  if (rawError) throw rawError;
  const { data: eventRows, error: eventError } = childIds.length
    ? await service.from("child_mission_onboarding_events").select("child_id,mission_completed_count").eq("environment", target).in("child_id", childIds)
    : { data: [], error: null };
  if (eventError) throw eventError;
  const { data: behaviorRows, error: behaviorError } = childIds.length
    ? await service.from("behavior_events").select("child_id,event_name,occurred_at").in("child_id", childIds).in("event_name", ["freechat_start", "play_start"])
    : { data: [], error: null };
  if (behaviorError) throw behaviorError;

  const eventByChild = new Map((eventRows ?? []).map((row) => [row.child_id, row.mission_completed_count]));
  const results = (children ?? []).map((child) => {
    const rows = (rawRows ?? []).filter((row) => row.child_id === child.id && row.business_date >= range.fromStr! && row.business_date <= range.toStr! && ["round1_day", "round2_night"].includes(row.round_type));
    const attempts = new Set(rows.map((row) => `${row.business_date}:${row.round_type}`));
    const completed = new Set(rows.filter((row) => row.status === "COMPLETED").map((row) => `${row.business_date}:${row.round_type}`));
    const filteredBehavior = (behaviorRows ?? []).filter((row) => {
      const kstDate = toKSTDateStr(row.occurred_at);
      return row.child_id === child.id && kstDate >= range.fromStr! && kstDate <= range.toStr!;
    });
    const expectedFreechat = filteredBehavior.filter((row) => row.event_name === "freechat_start").length;
    const expectedPlay = filteredBehavior.filter((row) => row.event_name === "play_start").length;
    const metric = metrics.get(child.id);
    if (!metric || metric.missionCount !== attempts.size || metric.completedMissionCount !== completed.size || metric.freechatCount !== expectedFreechat || metric.playCount !== expectedPlay) {
      throw new Error(`${target}:${child.name}: metric mismatch`);
    }
    return {
      name: child.name,
      period: `${range.fromStr}~${range.toStr}`,
      missionAttempts: metric.missionCount,
      completedMissions: metric.completedMissionCount,
      incompleteMissions: metric.incompleteMissionCount,
      eventProgress: `${eventByChild.get(child.id) ?? 0}/60`,
      freechat: metric.freechatCount,
      play: metric.playCount,
    };
  });
  if (target === "production") {
    assert.equal(results.length, productionReferenceSnapshot.size);
    for (const result of results) {
      const reference = productionReferenceSnapshot.get(result.name);
      assert.ok(reference, `unexpected production child: ${result.name}`);
      assert.equal(result.incompleteMissions, result.missionAttempts - result.completedMissions);
      Object.assign(result, {
        requestReference: reference,
        changedSinceRequest:
          result.missionAttempts !== reference.attempts ||
          result.completedMissions !== reference.completed ||
          result.eventProgress !== reference.event,
      });
    }
  }
  console.log(JSON.stringify({ target, results }, null, 2));
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
