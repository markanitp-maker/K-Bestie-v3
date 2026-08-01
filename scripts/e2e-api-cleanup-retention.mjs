import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const API_BASE = "http://127.0.0.1:3000/api/admin/reporting";

const adminEmail = process.env.ADMIN_EMAILS?.split(",")[0] || "markanitp@gmail.com";
const adminPassword = process.env.QA_TEST_PASSWORD || "QaDev1c65f921aea7!";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let authCookies = [];

async function getAuthCookie() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (error) {
    throw new Error(`Sign in failed: ${error.message}`);
  }

  // To simulate @supabase/ssr, we can use an array of cookies.
  // Actually, we can just fetch from a dummy route but let's try the full session.
  const projectRef = SUPABASE_URL.match(/:\/\/([^.]+)\.supabase/)?.[1] || "";
  const cookieName = `sb-${projectRef}-auth-token`;
  
  // Try passing the entire session stringified
  const val = encodeURIComponent(JSON.stringify(data.session));
  
  // If it's too large, we must chunk it. Let's just create chunks blindly.
  // Max chunk size is around 3000
  const chunks = [];
  for (let i = 0; i < val.length; i += 3000) {
    chunks.push(val.substring(i, i + 3000));
  }
  
  if (chunks.length === 1) {
    authCookies.push(`${cookieName}=${chunks[0]}`);
  } else {
    for (let i = 0; i < chunks.length; i++) {
      authCookies.push(`${cookieName}.${i}=${chunks[i]}`);
    }
  }
}

async function apiFetch(path, method = "GET", body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Cookie": authCookies.join("; "),
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch(e) {
    return { status: res.status, data: text };
  }
}

async function verifyAdminAPI() {
  await getAuthCookie();
  const bDate = "2026-08-01";
  const c1Id = crypto.randomUUID();

  let res = await apiFetch("/run", "POST", {
    action: "collect",
    target: { child_id: c1Id },
    businessDate: bDate
  });
  console.log("Response:", res);
}

verifyAdminAPI().catch(console.error);
