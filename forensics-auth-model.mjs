import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_DEV_URL"), get("SUPABASE_DEV_SERVICE_ROLE_KEY"));

const { data: fm } = await sb.from("family_members").select("*").eq("family_id", "bc65ccf1-1e96-474c-9f12-f405d4a63fde");
const { data: ma } = await sb.from("member_accounts").select("*").eq("family_id", "bc65ccf1-1e96-474c-9f12-f405d4a63fde");
const { data: cp } = await sb.from("child_profiles").select("id, member_id, name, is_test_account").eq("family_id", "bc65ccf1-1e96-474c-9f12-f405d4a63fde");

fs.writeFileSync("/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/00739e3b-4136-4ae2-9124-93ceea6d5ab9/scratchpad/auth-model.json", JSON.stringify({ family_members: fm, member_accounts: ma, child_profiles: cp }, null, 2), "utf8");
console.log("done");
