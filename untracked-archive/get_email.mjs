import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_DEV_URL, process.env.SUPABASE_DEV_SERVICE_ROLE_KEY);
const { data, error } = await sb.from('users').select('id, email, username').eq('username', 'testp02');
console.log('Error:', error);
console.log('Data:', data);
