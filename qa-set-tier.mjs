import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_DEV_URL"), get("SUPABASE_DEV_SERVICE_ROLE_KEY"));

const QA_CHILD_ID = "cde1b847-b1d2-4378-b337-b8cf4d532b00";
const newTier = parseInt(process.argv[2], 10);
if (!newTier) { console.error("usage: node qa-set-tier.mjs <tier>"); process.exit(1); }

const { data: before } = await sb.from("child_profiles").select("tier").eq("id", QA_CHILD_ID).maybeSingle();
console.log("tier before:", before?.tier);

const { error } = await sb.from("child_profiles").update({ tier: newTier }).eq("id", QA_CHILD_ID);
if (error) { console.error("update error:", error.message); process.exit(1); }

const { data: after } = await sb.from("child_profiles").select("tier").eq("id", QA_CHILD_ID).maybeSingle();
console.log("tier after:", after?.tier);
