import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = process.argv.find((arg) => arg.startsWith("--env="))?.slice(6);
if (!envPath) throw new Error("--env is required");
dotenv.config({ path: path.resolve(envPath) });

const url = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const serviceKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Development Supabase credentials are missing");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = `N0tification!${run}`;
const users = [];
const families = [];

function userClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createUser(label) {
  const email = `qa-notification-${label}-${run}@kbestie.local`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("auth user creation failed");
  const user = { id: data.user.id, email };
  users.push(user);
  return user;
}

async function signIn(user) {
  const client = userClient();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password });
  if (error) throw error;
  return client;
}

async function createFamilyFixture(label) {
  const parent = await createUser(`${label}-parent`);
  const childUser = await createUser(`${label}-child`);
  const { data: familyResult, error: familyError } = await service.rpc("create_family_with_owner", {
    p_user_id: parent.id,
    p_name: `${label} 알림 QA`,
  });
  if (familyError || !familyResult?.[0]?.family_id) throw familyError ?? new Error("family creation failed");
  const familyId = familyResult[0].family_id;
  families.push(familyId);
  const { data: member, error: memberError } = await service.from("family_members").insert({
    family_id: familyId, user_id: childUser.id, role: "child",
  }).select("id").single();
  if (memberError) throw memberError;
  const { data: child, error: childError } = await service.from("child_profiles").insert({
    family_id: familyId, member_id: member.id, name: `${label} 아이`, grade: "4학년", interests: [],
  }).select("id").single();
  if (childError) throw childError;
  return { parent, childUser, familyId, childId: child.id };
}

async function cleanup() {
  if (users.length) await service.from("notifications").delete().in("user_id", users.map((user) => user.id));
  if (families.length) {
    await service.from("families").update({ deleted_at: new Date().toISOString() }).in("id", families);
    await service.from("families").delete().in("id", families);
  }
  for (const user of users) await service.auth.admin.deleteUser(user.id).catch(() => undefined);
  if (users.length || families.length) {
    const { count: notificationCount } = await service.from("notifications").select("id", { count: "exact", head: true }).in("user_id", users.map((user) => user.id));
    const { count: familyCount } = await service.from("families").select("id", { count: "exact", head: true }).in("id", families);
    const authResult = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const authCount = authResult.data.users.filter((user) => users.some((created) => created.id === user.id)).length;
    assert.equal(notificationCount, 0);
    assert.equal(familyCount, 0);
    assert.equal(authCount, 0);
    console.log(JSON.stringify({ cleanup: true, authUsers: authCount, families: familyCount, notifications: notificationCount }));
  }
}

try {
  const a = await createFamilyFixture("A");
  const b = await createFamilyFixture("B");
  const childA = await signIn(a.childUser);
  const childASecondDevice = await signIn(a.childUser);
  const parentA = await signIn(a.parent);
  const childB = await signIn(b.childUser);

  const rows = [
    { user_id: a.childUser.id, child_id: a.childId, role: "child", type: "event", title: "이벤트", body: "이벤트 안내", target_url: "/child/home?event=announcement", source_id: "event", idempotency_key: `qa:${run}:child:event` },
    { user_id: a.childUser.id, child_id: a.childId, role: "child", type: "mission", title: "미션", body: "미션 안내", target_url: "/child/missions", source_id: "mission", idempotency_key: `qa:${run}:child:mission` },
    { user_id: a.parent.id, child_id: a.childId, role: "parent", type: "report", title: "리포트", body: "리포트 안내", target_url: "/parent/report", source_id: "report", idempotency_key: `qa:${run}:parent:report` },
    { user_id: b.childUser.id, child_id: b.childId, role: "child", type: "system", title: "다른 아이", body: "보이면 안 됨", target_url: "/", source_id: "other", idempotency_key: `qa:${run}:other` },
  ];
  const { data: inserted, error: insertError } = await service.from("notifications").insert(rows).select("id,idempotency_key");
  if (insertError) throw insertError;
  const { error: duplicateError } = await service.from("notifications").insert(rows[0]);
  assert.equal(duplicateError?.code, "23505", "idempotency_key must reject duplicates");

  const { data: childRows, error: childRowsError } = await childA.from("notifications")
    .select("id,role,type,read_at,idempotency_key").like("idempotency_key", `qa:${run}:%`).order("created_at");
  if (childRowsError) throw childRowsError;
  assert.equal(childRows.length, 2);
  assert.deepEqual(new Set(childRows.map((row) => row.type)), new Set(["event", "mission"]));
  assert.ok(childRows.every((row) => row.role === "child" && row.read_at === null));

  const otherId = inserted.find((row) => row.idempotency_key === rows[3].idempotency_key)?.id;
  assert.ok(otherId);
  const { data: otherVisible } = await childA.from("notifications").select("id").eq("id", otherId);
  assert.equal(otherVisible.length, 0, "other child notification must be hidden");
  const { data: childBRows } = await childB.from("notifications").select("id").like("idempotency_key", `qa:${run}:%`);
  assert.equal(childBRows.length, 1);

  const { data: firstRead, error: firstReadError } = await childA.rpc("mark_notification_read_v1", { p_notification_id: childRows[0].id });
  if (firstReadError) throw firstReadError;
  assert.equal(Number(firstRead[0].unread_count), 1, "2 → 1");
  const { data: remaining, error: allReadError } = await childA.rpc("mark_all_notifications_read_v1");
  if (allReadError) throw allReadError;
  assert.equal(Number(remaining), 0, "1 → 0");

  const { count: secondDeviceUnread, error: secondDeviceError } = await childASecondDevice.from("notifications")
    .select("id", { count: "exact", head: true }).like("idempotency_key", `qa:${run}:%`).is("read_at", null);
  if (secondDeviceError) throw secondDeviceError;
  assert.equal(secondDeviceUnread, 0, "second device must observe server read state");

  const { error: directUpdateError } = await childA.from("notifications").update({ read_at: null }).eq("id", childRows[0].id);
  assert.ok(directUpdateError, "direct client update must be denied");
  const { error: crossReadError } = await childA.rpc("mark_notification_read_v1", { p_notification_id: otherId });
  assert.ok(crossReadError, "cross-child read RPC must be denied");

  const { data: parentRows, error: parentRowsError } = await parentA.from("notifications")
    .select("role,type,read_at").like("idempotency_key", `qa:${run}:%`);
  if (parentRowsError) throw parentRowsError;
  assert.equal(parentRows.length, 1);
  assert.equal(parentRows[0].role, "parent");
  assert.equal(parentRows[0].type, "report");

  const { count: exactCount } = await service.from("notifications").select("id", { count: "exact", head: true }).like("idempotency_key", `qa:${run}:%`);
  assert.equal(exactCount, 4, "retry must not create a duplicate row");

  console.log(JSON.stringify({ ok: true, unreadTransitions: [2, 1, 0], multiDeviceUnread: secondDeviceUnread, rlsIsolation: true, directUpdateDenied: true, idempotentRows: exactCount }));
} finally {
  await cleanup();
}
