import dotenv from "dotenv";

dotenv.config({ path: process.env.KBESTIE_ENV_FILE ?? ".env.local", quiet: true });

const projectRef = "fetvnhhjicndmxvhrffk";
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN missing");

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Production query failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const rows = await query(`
  with wanted(name, expected_effective, expected_delta) as (values
    ('고나연',9,4), ('안예원',7,1), ('안서아',9,0), ('윤도건',9,3),
    ('윤도원',9,5), ('안서현',9,2), ('고보강',2,1)
  ), mapped as (
    select w.*, cp.id as child_id,
      count(*) over(partition by w.name) as profile_name_matches
    from wanted w join public.child_profiles cp on cp.name=w.name
  )
  select m.name, m.child_id, m.profile_name_matches,
    e.id as event_id, e.status, e.mission_completed_count as stored_count,
    count(c.id) filter(where c.counted)::int as actual_counted,
    m.expected_delta, m.expected_effective,
    count(c.id) filter(where c.counted)::int + m.expected_delta as computed_effective,
    public.mission_onboarding_reward_tier(count(c.id) filter(where c.counted)::int + m.expected_delta) as expected_reward_amount
  from mapped m
  left join public.child_mission_onboarding_events e
    on e.child_id=m.child_id and e.environment='production'
  left join public.child_mission_event_completions c on c.event_id=e.id
  group by m.name,m.child_id,m.profile_name_matches,e.id,e.status,e.mission_completed_count,
    m.expected_delta,m.expected_effective
  order by m.name;
`);

console.log(JSON.stringify(rows, null, 2));
