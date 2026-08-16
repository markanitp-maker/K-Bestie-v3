const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const supabaseKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error(error);
    return;
  }
  
  const testi = users.users.find(u => u.email === 'testi02@kbestie.local');
  if (testi) {
    const pwd = process.env.QA_TEST_PASSWORD;
    const { data, error: updateError } = await supabase.auth.admin.updateUserById(testi.id, { password: pwd });
    if (updateError) {
      console.error('Update failed:', updateError);
    } else {
      console.log('Successfully updated password for testi02 to', pwd);
    }
  } else {
    console.log('testi02 not found');
  }
}

main();
