import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_DEV_URL"), get("SUPABASE_DEV_SERVICE_ROLE_KEY"));

const missionId = "dd34d806-ede5-4d39-8907-fe4a09aeab1d";
const { data, error } = await sb.from("mission_questions").select("*").eq("mission_id", missionId);
fs.writeFileSync("/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/00739e3b-4136-4ae2-9124-93ceea6d5ab9/scratchpad/ksa-mission-questions.json", JSON.stringify({ error, data }, null, 2), "utf8");
console.log("done", data?.length, error?.message);
