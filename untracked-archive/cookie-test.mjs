import { createServerClient } from '@supabase/ssr';

let cookiesStore = {};
const client = createServerClient('https://mkrsaaedxqrcrktapaus.supabase.co', 'dummy', {
    cookies: {
        getAll() { return Object.entries(cookiesStore).map(([name, value]) => ({ name, value })); },
        setAll(cookies) {
            cookies.forEach(c => { cookiesStore[c.name] = c.value; });
        }
    }
});

await client.auth.setSession({
    access_token: 'dummy_access',
    refresh_token: 'dummy_refresh'
});

console.log(JSON.stringify(cookiesStore, null, 2));
