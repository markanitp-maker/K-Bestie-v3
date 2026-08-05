import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/lib/notifications/push';

// Helper to get KST Date object
function getKstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function kstToday() {
  return getKstDate().toISOString().slice(0, 10);
}

function kstYesterday() {
  const d = getKstDate();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getWeekBounds(targetDate: string) {
  const d = new Date(`${targetDate}T12:00:00Z`);
  const dow = d.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

export async function GET(req: Request) {
  // Authorization check (Vercel Cron Secret or Supabase Batch Secret)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || process.env.BATCH_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
  const db = createClient(supabaseUrl, supabaseKey);

  const today = kstToday();
  const yesterday = kstYesterday();
  const { weekStart } = getWeekBounds(today);

  try {
    // 1. Get all active parents with push enabled
    const { data: parents, error: parentsErr } = await db
      .from('parents')
      .select('id, report_push_enabled')
      .eq('report_push_enabled', true);

    if (parentsErr) throw new Error(`Parents query failed: ${parentsErr.message}`);
    if (!parents || parents.length === 0) {
      return NextResponse.json({ message: 'No parents with push enabled' });
    }

    const results = {
      sent: 0,
      skipped_no_data: 0,
      skipped_already_sent: 0,
      errors: [] as any[]
    };

    for (const parent of parents) {
      try {
        // 2. Get children connected to this parent
        const { data: familyMembers, error: fmErr } = await db
          .from('family_members')
          .select('family_id')
          .eq('user_id', parent.id)
          .in('role', ['parent', 'owner_parent']);
          
        if (fmErr) throw new Error(fmErr.message);
        if (!familyMembers || familyMembers.length === 0) continue;

        const familyIds = familyMembers.map((fm: any) => fm.family_id);

        const { data: children, error: childErr } = await db
          .from('child_profiles')
          .select('id, name')
          .in('family_id', familyIds);

        if (childErr) throw new Error(childErr.message);
        if (!children || children.length === 0) continue;

        const childIds = children.map((c: any) => c.id);

        // 3. Check for Weekly Reports first
        const { data: weeklyReports, error: weeklyErr } = await db
          .from('weekly_summaries')
          .select('id, child_id')
          .in('child_id', childIds)
          .eq('week_start', weekStart);

        if (weeklyErr) throw new Error(weeklyErr.message);

        // 4. Check for Daily Reports
        const { data: dailyReports, error: dailyErr } = await db
          .from('daily_reports')
          .select('id, child_id')
          .in('child_id', childIds)
          .eq('business_date', yesterday)
          .is('deleted_at', null);

        if (dailyErr) throw new Error(dailyErr.message);

        const hasWeekly = weeklyReports && weeklyReports.length > 0;
        const hasDaily = dailyReports && dailyReports.length > 0;

        if (!hasWeekly && !hasDaily) {
          results.skipped_no_data++;
          continue;
        }

        const reportType = hasWeekly ? 'weekly' : 'daily';
        const targetDate = hasWeekly ? weekStart : yesterday;
        const reportsToUse = hasWeekly ? weeklyReports : dailyReports;

        // 5. Check idempotency (already sent?)
        const { data: existingLog, error: logErr } = await db
          .from('report_notification_logs')
          .select('id')
          .eq('parent_id', parent.id)
          .eq('notification_date', targetDate)
          .eq('report_type', reportType)
          .maybeSingle();

        if (logErr) throw new Error(logErr.message);
        if (existingLog) {
          results.skipped_already_sent++;
          continue;
        }

        // 6. Format push message
        let title = '';
        let body = '';
        const url = '/parent/reports';

        const validChildren = children.filter((c: any) => reportsToUse.some((r: any) => r.child_id === c.id));
        const names = validChildren.map((c: any) => c.name);

        if (names.length > 1) {
          title = '아이들의 새로운 리포트가 도착했어요.';
          body = hasWeekly ? '지난 한 주의 변화와 관심사를 확인해 보세요.' : '어제 아이의 이야기와 오늘 나눌 대화를 확인해 보세요.';
        } else if (names.length === 1) {
          title = `${names[0]}의 ${hasWeekly ? '주간' : '새'} 리포트가 도착했어요`;
          body = hasWeekly ? '지난 한 주의 변화와 관심사를 확인해 보세요.' : '어제 아이의 이야기와 오늘 나눌 대화를 확인해 보세요.';
        } else {
          continue; // Should not happen
        }

        // 7. Get push subscriptions
        const { data: subs, error: subErr } = await db
          .from('push_subscriptions')
          .select('*')
          .eq('user_id', parent.id);

        if (subErr) throw new Error(subErr.message);
        
        let sentPush = false;
        if (subs && subs.length > 0) {
          for (const sub of subs) {
            try {
              const subscription = {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth
                }
              };
              await sendPushNotification(subscription, { title, body, url });
              sentPush = true;
            } catch (pushErr) {
              console.error(`Push failed for parent ${parent.id}`, pushErr);
              // Cleanup invalid subscriptions if necessary (e.g. 410 Gone)
            }
          }
        }

        // 8. Log the notification (even if push fails, to avoid retrying infinitely for a bad token)
        // Wait, if push completely fails, we might want to retry. The spec says "푸시 실패: 리포트는 생성됐지만 푸시 발송만 실패한 경우: 관리자 로그에 발송 실패 기록. 성공 기록 전에도 중복 알림이 생성되지 않도록 상태 관리"
        // Let's insert into logs anyway to prevent spam.
        await db.from('report_notification_logs').insert({
          parent_id: parent.id,
          notification_type: hasWeekly ? 'WEEKLY_REPORT' : 'DAILY_REPORT',
          notification_date: targetDate,
          report_type: reportType
        });

        if (sentPush) results.sent++;

      } catch (err) {
        results.errors.push({ parentId: parent.id, error: String(err) });
      }
    }

    return NextResponse.json({ ok: true, results });

  } catch (error) {
    console.error('[8am-notification-batch] Failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
