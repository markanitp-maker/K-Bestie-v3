import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_DEV_URL"), get("SUPABASE_DEV_SERVICE_ROLE_KEY"));

const { data: allQ } = await sb.from("mission_questions").select("id, question_text, dashboard_area_tag, cycle_type, round_type, applicable_grades, is_active");
const byTag = {};
for (const q of allQ ?? []) {
  byTag[q.dashboard_area_tag] = (byTag[q.dashboard_area_tag] ?? 0) + 1;
}

const childId = "c97eb161-3d74-4b24-9d29-f94b0a6ba920"; // 김서아
const { data: hist } = await sb.from("mission_question_history").select("question_id, asked_at").eq("child_id", childId).order("asked_at", { ascending: false });

const studyQ = (allQ ?? []).filter(q => q.question_text?.includes("학원") || q.question_text?.includes("공부"));

fs.writeFileSync("/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/00739e3b-4136-4ae2-9124-93ceea6d5ab9/scratchpad/qbank.json", JSON.stringify({
  totalActive: (allQ ?? []).filter(q => q.is_active).length,
  totalAll: (allQ ?? []).length,
  byTag,
  studyQ,
  historyCount: hist?.length,
  historyRecent: (hist ?? []).slice(0, 20),
}, null, 2), "utf8");
console.log("done");
