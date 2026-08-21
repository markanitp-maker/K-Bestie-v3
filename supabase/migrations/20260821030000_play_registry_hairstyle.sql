-- hairstyle(헤어스타일) 놀이를 play_registry 에 등록한다.
--
-- 이 행이 없으면 티켓 발급이 FK 위반으로 실패한다
-- (`play_execution_tickets.play_id` → `play_registry(play_id)`).
-- 그래서 카드만 켜고 이 행을 빠뜨리면 아이에게 눌러도 안 되는 버튼이 보인다.
--
-- keys_cost=3, resume_ttl_hours=6 은 2026-08-21 대표 확정값이다. 임의로 바꾸지 마라.
-- keys_cost 는 차감의 단일 출처다 — 놀이 카드의 `keys: 3` 은 화면 표시용일 뿐이다.
--
-- sort_order 는 comic_book(5)과 mbti(10) 사이를 피해 뒤에 둔다.
--
-- 등록만 하고 켜지는 않는다(is_visible/is_active = false). 티켓 발급이 FK 위반으로
-- 실패하지 않도록 행은 먼저 만들되, 노출 시점은 사람이 정한다.

INSERT INTO play_registry (
  play_id, display_name, description, icon,
  keys_cost, is_visible, is_active, sort_order, resume_ttl_hours
)
VALUES (
  'hairstyle', '헤어스타일', '새로운 머리 모양, 오늘은 어떻게 해볼까?', '💇',
  3, false, false, 15, 6
)
ON CONFLICT (play_id) DO UPDATE
SET display_name     = EXCLUDED.display_name,
    description      = EXCLUDED.description,
    icon             = EXCLUDED.icon,
    keys_cost        = EXCLUDED.keys_cost,
    sort_order       = EXCLUDED.sort_order,
    resume_ttl_hours = EXCLUDED.resume_ttl_hours,
    updated_at       = now();
-- is_visible/is_active 는 ON CONFLICT 에서 덮어쓰지 않는다 — comic_book 정본
-- (20260820180000...sql:48-56)과 같은 정책이다. 운영자가 문제를 보고 수동으로 끈 뒤
-- 이 마이그레이션이 재실행되면 놀이가 저절로 다시 켜져 아이 화면에 노출된다.
-- 최초 INSERT 도 같은 이유로 꺼진 채 들어간다. 공개는 별도 조치로 한다.
