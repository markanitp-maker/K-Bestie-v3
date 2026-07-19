import { PGlite } from '@electric-sql/pglite';
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const db = new PGlite();
  const reports = [];

  try {
    // 1. Auth stubs
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      BEGIN
        RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      BEGIN
        RETURN NULLIF(current_setting('request.jwt.claim.role', true), '');
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // 2. Base Schema
    const schemaFile = await fs.readFile('.omc/state/local-db-test/production-base-schema-columns.txt', 'utf-8');
    const parts = schemaFile.split('=== PRIMARY KEYS ===');
    const tableSections = parts[0].split('===').map(s => s.trim()).filter(s => s);
    
    const pks = JSON.parse(parts[1].trim());

    for (let i = 0; i < tableSections.length; i += 2) {
      const tableName = tableSections[i];
      const cols = JSON.parse(tableSections[i+1]);
      
      const colDefs = cols.map(c => {
        let def = `"${c.column_name}" ${c.data_type === 'ARRAY' ? 'text[]' : c.data_type}`;
        if (c.is_nullable === 'NO') def += ' NOT NULL';
        if (c.column_default) def += ` DEFAULT ${c.column_default}`;
        return def;
      });

      const pk = pks.find(p => p.table_name === tableName);
      if (pk) {
        colDefs.push(`PRIMARY KEY ("${pk.column_name}")`);
      }

      await db.query(`CREATE TABLE public."${tableName}" (\n  ${colDefs.join(',\n  ')}\n);`);
    }

    // Add explicit FKs requested
    await db.exec(`
      ALTER TABLE public.family_members ADD CONSTRAINT fk_family FOREIGN KEY (family_id) REFERENCES public.families(id);
      ALTER TABLE public.child_profiles ADD CONSTRAINT fk_family FOREIGN KEY (family_id) REFERENCES public.families(id);
    `);

    // Ensure daily_reports exists just in case
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.daily_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid,
        mood_score integer,
        emotion_tags text[],
        emotion_level integer
      );
      CREATE TABLE IF NOT EXISTS public.admin_roles (
        id uuid PRIMARY KEY,
        email text
      );
    `);

    // Create required roles
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    `);

    // 3. Migrations
    const migrations = [
      "20260725000000_daily_reports_eight_fields.sql",
      "20260725100000_plan_retention_extension.sql",
      "20260725100000_safety_events_alpha_allowlist.sql",
      "20260725110000_admin_audit_log_action_check_restore.sql",
      "20260725200000_parent_questions_lifecycle.sql",
      "20260725300000_goldkey_reserve_confirm_restore.sql",
      "20260725310000_goldkey_reserve_restart_fix.sql",
      "20260725500000_batch_schedule_kst_adjust.sql",
      "20260725600000_account_lifecycle_notifications.sql",
      "20260725700000_parent_questions_answer_summary.sql",
      "20260726100000_account_lifecycle_outbox.sql",
      "20260726200000_insight_extension_purchases.sql",
      "20260726210000_purchase_insight_extension_auth_fix.sql",
      "20260726220000_insight_retention_extensions_rls.sql",
      "20260726230000_purchase_insight_extension_auth_fix_null.sql"
    ];

    const migrationResults = [];
    let rlsProof1 = null;
    let rlsProof2 = null;

    for (const mig of migrations) {
      const sqlPath = path.join('supabase/migrations', mig);
      let sql = await fs.readFile(sqlPath, 'utf-8');
      
      // Remove cron statements manually as pglite doesn't support them
      if (mig === '20260725500000_batch_schedule_kst_adjust.sql') {
        sql = sql.replace(/SELECT\s+cron\..+;/g, '-- cron removed');
      }

      try {
        await db.exec(sql); // Use exec for multiple statements
        console.log(`[PASS] ${mig}`);
        migrationResults.push({ file: mig, status: 'PASS', error: null });
      } catch (err) {
        console.error(`[FAIL] ${mig}: ${err.message}`);
        migrationResults.push({ file: mig, status: 'FAIL', error: err.message });
      }

      // Step 2: Proof for plan_retention_extension.sql
      if (mig === "20260725100000_plan_retention_extension.sql") {
        try {
          const res = await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'insight_retention_extensions';`);
          rlsProof1 = res.rows[0]?.relrowsecurity;
        } catch(e) {}
      }
      if (mig === "20260726220000_insight_retention_extensions_rls.sql") {
        try {
          const res = await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'insight_retention_extensions';`);
          rlsProof2 = res.rows[0]?.relrowsecurity;
        } catch(e) {}
      }
    }

    // Step 3: Seed data
    const famA_id = 'a0000000-0000-0000-0000-000000000000';
    const famB_id = 'b0000000-0000-0000-0000-000000000000';
    
    const famA_user_id = 'a1111111-0000-0000-0000-000000000000';
    const famB_user_id = 'b1111111-0000-0000-0000-000000000000';
    const admin_user_id = 'c1111111-0000-0000-0000-000000000000';
    const admin_user_id2 = 'c2222222-0000-0000-0000-000000000000';

    const childA_id = 'a2222222-0000-0000-0000-000000000000';
    const childB_id = 'b2222222-0000-0000-0000-000000000000';
    const childC_id = 'c3333333-0000-0000-0000-000000000000';

    await db.exec(`
      INSERT INTO public.families (id, name) VALUES 
        ('${famA_id}', 'Family A'), 
        ('${famB_id}', 'Family B');
        
      INSERT INTO public.parents (id, email, name) VALUES 
        ('${famA_user_id}', 'a@example.com', 'Parent A'),
        ('${famB_user_id}', 'b@example.com', 'Parent B'),
        ('${admin_user_id}', 'admin@example.com', 'Admin 1'),
        ('${admin_user_id2}', 'admin2@example.com', 'Admin 2');

      INSERT INTO public.family_members (family_id, user_id, role) VALUES 
        ('${famA_id}', '${famA_user_id}', 'owner_parent'),
        ('${famB_id}', '${famB_user_id}', 'owner_parent');

      INSERT INTO public.child_profiles (id, family_id, name, grade, interests, live_voice_name) VALUES 
        ('${childA_id}', '${famA_id}', 'alpha-test-child-1', '1', '{}', 'Achernar'),
        ('${childB_id}', '${famB_id}', 'beta-test-child-1', '1', '{}', 'Achernar'),
        ('${childC_id}', '${famA_id}', 'alpha-test-child-2', '1', '{}', 'Achernar');
    `);

    // Add allowlist entries
    await db.exec(`
      INSERT INTO public.alpha_safety_text_allowlist (child_id, admin_user_id, env) VALUES 
        ('${childA_id}', '${admin_user_id}', 'alpha'),
        ('${childC_id}', '${admin_user_id}', 'alpha');
    `);

    // Add safety events
    const safetyEventA_id = 'a3333333-0000-0000-0000-000000000000';
    const safetyEventB_id = 'b3333333-0000-0000-0000-000000000000';
    const sessionA = 'a4444444-0000-0000-0000-000000000000';
    const sessionB = 'b4444444-0000-0000-0000-000000000000';
    
    await db.exec(`
      INSERT INTO public.chat_sessions (id, child_id) VALUES ('${sessionA}', '${childA_id}'), ('${sessionB}', '${childB_id}');
      INSERT INTO public.safety_events (id, session_id, child_id, subcategory, child_text) VALUES 
        ('${safetyEventA_id}', '${sessionA}', '${childA_id}', 'test', 'text_a'),
        ('${safetyEventB_id}', '${sessionB}', '${childB_id}', 'test', 'text_b');
    `);

    // Insert test rows for insight_retention_extensions to test RLS
    await db.exec(`
      INSERT INTO public.insight_retention_extensions (family_id, extension_years_purchased) VALUES 
        ('${famA_id}', 1),
        ('${famB_id}', 1);
    `);

    // Step 4: Integration tests
    const testResults = [];

    async function runTest(name, fn) {
      try {
        const pass = await fn();
        testResults.push({ name, status: pass ? 'PASS' : 'FAIL', message: pass ? 'Expected outcome matched' : 'Unexpected outcome' });
      } catch (err) {
        testResults.push({ name, status: 'FAIL', message: err.message });
      }
    }

    // 1. Anon access
    await runTest('1. Anon access blocked', async () => {
      await db.exec(`RESET "request.jwt.claim.sub"; RESET "request.jwt.claim.role"; SET ROLE anon;`);
      let allPassed = true;
      const tables = ['insight_retention_extensions', 'parent_question_quota', 'account_lifecycle_notifications', 'gold_key_reservations', 'insight_extension_purchases', 'alpha_safety_text_allowlist'];
      for (const t of tables) {
        try {
          const res = await db.query(`SELECT * FROM public.${t}`);
          if (res.rows.length > 0) allPassed = false;
        } catch (e) {
          if (!e.message.includes('permission denied')) allPassed = false;
        }
      }
      return allPassed;
    });

    // 2. Auth: B tries to read A's insight
    await runTest('2. B cannot read A insight', async () => {
      await db.exec(`SET ROLE authenticated; SET "request.jwt.claim.sub" TO '${famB_user_id}';`);
      try {
        const res = await db.query(`SELECT * FROM public.insight_retention_extensions WHERE family_id = '${famA_id}'`);
        return res.rows.length === 0;
      } catch (e) {
        return e.message.includes('permission denied') || e.message.includes('row-level security');
      }
    });

    // 3. Auth: B reads B's insight
    await runTest('3. B can read B insight', async () => {
      await db.exec(`SET ROLE authenticated; SET "request.jwt.claim.sub" TO '${famB_user_id}';`);
      const res = await db.query(`SELECT * FROM public.insight_retention_extensions WHERE family_id = '${famB_id}'`);
      return res.rows.length === 1;
    });

    // 4. IDOR in purchase_insight_extension
    await runTest('4. IDOR purchase_insight_extension', async () => {
      // First, check B trying to purchase for A
      await db.exec(`SET ROLE authenticated; SET "request.jwt.claim.sub" TO '${famB_user_id}'; SET "request.jwt.claim.role" TO 'authenticated';`);
      let bFailed = false;
      try {
        await db.query(`SELECT public.purchase_insight_extension('${famA_id}', 1)`);
        console.log("[Test 4] B purchase for A success (unexpected!)");
      } catch (e) {
        console.log("[Test 4] B purchase for A error (expected):", e.message);
        bFailed = true; // Expected to fail
      }
      
      // Then check A trying to purchase for A
      await db.exec(`SET ROLE authenticated; SET "request.jwt.claim.sub" TO '${famA_user_id}'; SET "request.jwt.claim.role" TO 'authenticated';`);
      let aPassed = false;
      try {
        await db.query(`SELECT public.purchase_insight_extension('${famA_id}', 1)`);
        console.log("[Test 4] A purchase for A success (expected)");
        aPassed = true; // Expected to pass
      } catch (e) {
        console.log("[Test 4] A purchase for A error (unexpected!):", e.message);
      }
      
      return bFailed && aPassed;
    });

    // 5. get_safety_event_child_text: admin reads unallowed child (B)
    await runTest('5. get_safety_event_child_text unallowed child', async () => {
      await db.exec(`SET ROLE service_role;`);
      const res = await db.query(`SELECT public.get_safety_event_child_text('${safetyEventB_id}', '${admin_user_id}', 'alpha') AS txt`);
      return res.rows[0].txt === null;
    });

    // 6. get_safety_event_child_text: allowed admin reads allowed child (A)
    await runTest('6. get_safety_event_child_text allowed', async () => {
      await db.exec(`SET ROLE service_role;`);
      const res = await db.query(`SELECT public.get_safety_event_child_text('${safetyEventA_id}', '${admin_user_id}', 'alpha') AS txt`);
      return res.rows[0].txt === 'text_a';
    });

    // 7. get_safety_event_child_text: unallowed admin reads allowed child (A)
    await runTest('7. get_safety_event_child_text unallowed admin', async () => {
      await db.exec(`SET ROLE service_role;`);
      const res = await db.query(`SELECT public.get_safety_event_child_text('${safetyEventA_id}', '${admin_user_id2}', 'alpha') AS txt`);
      return res.rows[0].txt === null;
    });

    // 8. safety_events_admin_view child_text exclusion
    await runTest('8. safety_events_admin_view struct', async () => {
      await db.query(`SET ROLE postgres;`); // revert to superuser to check metadata
      const res = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'safety_events_admin_view' AND column_name = 'child_text'
      `);
      return res.rows.length === 0;
    });

    const reportObj = { migrationResults, rlsProof1, rlsProof2, testResults };
    await fs.writeFile('tests/results.json', JSON.stringify(reportObj, null, 2));
    console.log("TEST FINISHED");
  } catch (e) {
    console.error("FATAL ERROR", e);
  }
}

main();
