import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { fetchQuizLeaderboard } from "@/lib/events/quizLeaderboardClient";
import { isAttendanceRouletteResult, kstDateKey } from "@/lib/events/attendanceRoulette";

export const runtime = "nodejs";

type LatestSpin = {
  id: string;
  child_id: string;
  result_code: string;
  key_reward: number;
  source: string;
  used_manual_override: boolean;
  settled_at: string;
};

export async function GET(_req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const service = createServiceClient();
  const today = kstDateKey();
  const period = today.slice(0, 7);
  const [childrenRes, daysRes, spinsRes, latestSpinsRes, overridesRes, keysRes, auditRes, leaderboardRes] = await Promise.all([
    service.from("child_profiles").select("id, name, member_id").order("name"),
    service.from("attendance_roulette_days").select("child_id, base_spin_used, retry_credits_granted, retry_credits_used").eq("attendance_date", today),
    service.from("attendance_roulette_spins").select("id, child_id, result_code, key_reward, source, used_manual_override, settled_at").eq("attendance_date", today).order("settled_at", { ascending: false }),
    service.rpc("get_attendance_roulette_latest_spins"),
    service.from("attendance_roulette_overrides").select("id, child_id, result_code, status, created_at, updated_at, consumed_at, cancelled_at, admin_note, created_by_email").eq("status", "PENDING"),
    service.from("gold_key_ledger").select("child_id").eq("consumed", false).gt("expires_at", new Date().toISOString()),
    service.from("attendance_roulette_audit_log").select("id, action, child_id, spin_id, override_id, actor_user_id, actor_email, before_state, after_state, created_at").order("created_at", { ascending: false }).limit(100),
    fetchQuizLeaderboard(period),
  ]);

  const firstError = [childrenRes, daysRes, spinsRes, latestSpinsRes, overridesRes, keysRes, auditRes].find((result) => result.error)?.error;
  if (firstError) {
    console.error("[admin/attendance-roulette] query failed", firstError.code);
    return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
  }

  const children = childrenRes.data ?? [];
  const memberIds = children.map((child) => child.member_id).filter(Boolean) as string[];
  const usernameByMemberId = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: familyMembers, error: familyMembersError } = await service.from("family_members").select("id, user_id").in("id", memberIds);
    if (familyMembersError) {
      console.error("[admin/attendance-roulette] family member lookup failed", familyMembersError.code);
      return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
    }
    const userIds = (familyMembers ?? []).map((member) => member.user_id).filter(Boolean) as string[];
    if (userIds.length > 0) {
      const { data: accounts, error: accountsError } = await service.from("member_accounts").select("id, username").in("id", userIds);
      if (accountsError) {
        console.error("[admin/attendance-roulette] account lookup failed", accountsError.code);
        return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
      }
      const usernameByUserId = new Map((accounts ?? []).map((account) => [account.id, account.username]));
      for (const member of familyMembers ?? []) {
        if (member.user_id) usernameByMemberId.set(member.id, usernameByUserId.get(member.user_id) ?? "");
      }
    }
  }

  const dayByChild = new Map((daysRes.data ?? []).map((day) => [day.child_id, day]));
  const pendingByChild = new Map((overridesRes.data ?? []).map((override) => [override.child_id, override]));
  const latestSpins = (latestSpinsRes.data ?? []) as LatestSpin[];
  const recentSpinByChild = new Map<string, LatestSpin>(latestSpins.map((spin) => [spin.child_id, spin]));
  const balanceByChild = new Map<string, number>();
  for (const key of keysRes.data ?? []) balanceByChild.set(key.child_id, (balanceByChild.get(key.child_id) ?? 0) + 1);

  const leaderboardEntries = leaderboardRes.ok ? leaderboardRes.data.entries.filter((entry) => !entry.isSeedUser) : [];
  const leaderByChild = new Map(leaderboardEntries.map((entry) => [entry.childId, entry]));
  const firstScore = leaderboardEntries[0]?.score ?? 0;
  const resultCounts = Object.fromEntries(["LOSE", "RETRY", "KEY_1", "KEY_3", "KEY_5", "KEY_7", "KEY_9"].map((code) => [code, 0]));
  for (const spin of spinsRes.data ?? []) resultCounts[spin.result_code] = (resultCounts[spin.result_code] ?? 0) + 1;

  const rows = children.map((child) => {
    const day = dayByChild.get(child.id);
    const leader = leaderByChild.get(child.id);
    return {
      childId: child.id,
      name: child.name,
      username: child.member_id ? usernameByMemberId.get(child.member_id) ?? "" : "",
      rank: leader?.rank ?? null,
      score: leader?.score ?? 0,
      gapFromFirst: Math.max(0, firstScore - (leader?.score ?? 0)),
      balance: balanceByChild.get(child.id) ?? 0,
      todayStatus: !day?.base_spin_used ? "NOT_STARTED" : (day.retry_credits_granted - day.retry_credits_used) > 0 ? "RETRY_AVAILABLE" : "COMPLETED",
      recentResult: recentSpinByChild.get(child.id)?.result_code ?? null,
      recentResultAt: recentSpinByChild.get(child.id)?.settled_at ?? null,
      pendingOverride: pendingByChild.get(child.id) ?? null,
    };
  });

  return NextResponse.json({
    attendanceDate: today,
    summary: {
      targetChildren: children.length,
      participatedChildren: daysRes.data?.filter((day) => day.base_spin_used).length ?? 0,
      notParticipatedChildren: children.length - (daysRes.data?.filter((day) => day.base_spin_used).length ?? 0),
      totalKeysGranted: (spinsRes.data ?? []).reduce((sum, spin) => sum + spin.key_reward, 0),
      resultCounts,
    },
    children: rows,
    history: (auditRes.data ?? []).map((row) => ({ ...row, childName: children.find((child) => child.id === row.child_id)?.name ?? "알 수 없음" })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const { denied, actor } = await requireAdminActor("attendance_roulette_override");
  if (denied) return denied;
  let body: { childId?: string; resultCode?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.childId || !isAttendanceRouletteResult(body.resultCode)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (body.note && body.note.trim().length > 500) {
    return NextResponse.json({ error: "note_too_long" }, { status: 400 });
  }
  const service = createServiceClient();
  const { data, error } = await service.rpc("set_attendance_roulette_override", {
    p_child_id: body.childId,
    p_result_code: body.resultCode,
    p_admin_id: actor.id,
    p_admin_email: actor.email,
    p_admin_note: body.note?.trim() || null,
  });
  if (error) return NextResponse.json({ error: "override_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, overrideId: data });
}

export async function DELETE(req: NextRequest) {
  const { denied, actor } = await requireAdminActor("attendance_roulette_override_cancel");
  if (denied) return denied;
  let body: { childId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.childId) return NextResponse.json({ error: "childId required" }, { status: 400 });
  const service = createServiceClient();
  const { data, error } = await service.rpc("cancel_attendance_roulette_override", {
    p_child_id: body.childId,
    p_admin_id: actor.id,
    p_admin_email: actor.email,
  });
  if (error) return NextResponse.json({ error: "cancel_failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "pending_override_not_found" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
