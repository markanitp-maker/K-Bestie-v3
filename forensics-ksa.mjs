import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_DEV_URL"), get("SUPABASE_DEV_SERVICE_ROLE_KEY"));

const childId = "c97eb161-3d74-4b24-9d29-f94b0a6ba920"; // 김서아
const { data: sessions } = await sb.from("chat_sessions").select("*").eq("child_id", childId);
fs.writeFileSync("/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/00739e3b-4136-4ae2-9124-93ceea6d5ab9/scratchpad/ksa-sessions.json", JSON.stringify(sessions, null, 2), "utf8");
console.log("sessions:", sessions?.length);
