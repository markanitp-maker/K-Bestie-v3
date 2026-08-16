# pg_cron 실패가 보이지 않는 문제

- 발견: 2026-08-16 (Request 029-R1)
- 대상: Production `kbestie-weekly-batch` 및 `net.http_post`를 쓰는 모든 크론

## 무슨 일이 있었나

주간 리포트 크론이 **매주 401 Unauthorized로 실패**하고 있었는데, `cron.job_run_details`에는 계속 `succeeded`로 기록됐다. 실제 사용자 7명의 주간 리포트가 누락됐고 아무도 알아채지 못했다.

```
cron.job_run_details : 08-15 06:00  succeeded  "1 row"
실제 리포트 생성 시각 : 08-15 13:16~13:21 (수동 실행, 21건에서 중단)
```

## 원인

`net.http_post`는 **요청을 큐에 넣는 것까지만** 하고 즉시 반환한다. HTTP 응답을 기다리지 않는다.

그래서 `cron.job_run_details.status`가 뜻하는 것은 이것뿐이다.

```
succeeded = "요청을 큐에 넣는 데 성공했다"
```

호출된 Edge Function이나 API가 401·500으로 죽어도 크론 이력은 `succeeded`다.

이번 401의 직접 원인은 인증 시크릿 3곳이 서로 다른 값이었던 것이다.

| 위치 | 이름 |
|---|---|
| Supabase Edge Function 환경변수 | `BATCH_SECRET` |
| DB vault (크론이 참조) | `weekly_batch_secret` |
| 로컬 `.env.local` | `BATCH_SECRET` |

셋이 어긋나면 크론은 조용히 실패한다. 2026-08-16에 동일 값으로 통일했다.

## 실패를 확인하는 방법

`cron.job_run_details`를 믿지 말고 **실제 HTTP 응답**을 봐야 한다.

```sql
-- 최근 크론 HTTP 응답 (보관 기간 약 6시간)
select id, status_code, left(coalesce(content,''),200) as body,
       to_char(created at time zone 'Asia/Seoul','MM-DD HH24:MI') as kst
from net._http_response
order by created desc limit 20;

-- 실패만
select * from net._http_response where status_code >= 400 order by created desc;
```

`net._http_response`는 오래 보관되지 않는다(실측 약 6시간). 지난 실패를 소급 확인할 수 없으므로, **결과물 자체를 세는 것**이 가장 확실하다.

```sql
-- 주간 리포트 누락 전수 검사
with weeks as (
  select generate_series(date '2026-07-25', current_date, interval '7 days')::date as ws
), active as (
  select distinct cs.child_id, w.ws
  from weeks w
  join chat_sessions cs on cs.started_at >= w.ws and cs.started_at < w.ws + interval '7 days'
  join child_profiles cp on cp.id = cs.child_id
  where cp.guardian_consent_withdrawn_at is null
    and coalesce(cp.is_test_account,false) = false
)
select a.ws as week_start, count(*) as expected, count(w.id) as generated,
       count(*) - count(w.id) as missing
from active a
left join weekly_summaries w on w.child_id = a.child_id and w.week_start = a.ws
group by a.ws order by a.ws;
```

`missing`이 0이 아니면 크론이 실패한 것이다. 단 그 주에 아이 발화가 0건이면 배치가 정상적으로 건너뛰므로 `missing`에 남는다 — 개별 확인이 필요하다.

## 시크릿을 바꿀 때

세 곳을 **항상 함께** 바꾼다. 하나만 바꾸면 크론이 조용히 죽는다.

```bash
# 1) Edge Function
supabase secrets set BATCH_SECRET="<값>" --project-ref <ref>

# 2) DB vault (크론이 읽는 값)
select vault.update_secret(
  (select id from vault.secrets where name='weekly_batch_secret'),
  '<값>', 'weekly_batch_secret', 'weekly-batch 인증용 — BATCH_SECRET과 동일해야 한다');

# 3) 로컬 .env.local
```

바꾼 뒤 반드시 실제 호출로 200을 확인한다.

```sql
select net.http_post(
  url := 'https://<ref>.supabase.co/functions/v1/weekly-batch',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='weekly_batch_secret')),
  body := '{}'::jsonb) as id;
-- 잠시 후 net._http_response 에서 해당 id의 status_code 확인
```

## 수동 백필

`weekly-batch`는 멱등하다. 이미 있는 리포트는 `existing`으로 건너뛰고 누락자만 만든다. 전체 삭제 후 재생성은 하지 않는다.

```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/weekly-batch" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BATCH_SECRET" \
  --data-binary '{"date":"YYYY-MM-DD","forceWeekly":true}'
```

`date`는 **생성하려는 주간의 다음 토요일**을 넣는다(배치가 그 날 기준 직전 토~금 주간을 만든다).

응답의 `created` / `skipped` / `existing` / `errors` 를 확인한다. `skipped`는 그 주에 아이 발화가 없어 만들 내용이 없는 경우다.
