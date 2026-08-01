import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase DEV credentials");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function check() {
  const { data, error } = await db.schema('supabase_migrations').from("schema_migrations").select("version").in("version", [
    "20260721300000",
    "20260721300001",
    "20260725100000",
    "20260725100001"
  ]);
  if (error) console.error(error);
  console.log("Found in schema_migrations:");
  console.log(data);
}
check();
