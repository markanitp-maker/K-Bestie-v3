import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_DEV_URL, process.env.SUPABASE_DEV_SERVICE_ROLE_KEY);
const { data, error } = await sb.auth.admin.listUsers();
if (error) console.log(error);
const user = data?.users.find(u => u.email?.includes('testp02') || u.user_metadata?.username === 'testp02');
console.log('User:', user?.email, user?.user_metadata);
