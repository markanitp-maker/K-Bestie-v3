import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_DEV_URL"), get("SUPABASE_DEV_SERVICE_ROLE_KEY"));

const childId = "cde1b847-b1d2-4378-b337-b8cf4d532b00";
const { data: sessions } = await sb.from("chat_sessions").select("id").eq("child_id", childId);
const ids = (sessions ?? []).map(s => s.id);
for (const id of ids) {
  await sb.from("mission_progress").delete().eq("session_id", id);
  await sb.from("chat_messages").delete().eq("session_id", id);
}
const { error } = await sb.from("chat_sessions").delete().eq("child_id", childId);
console.log("deleted sessions:", ids.length, "error:", error?.message);
