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

INSERT INTO play_registry (
  play_id, display_name, description, icon,
  keys_cost, is_visible, is_active, sort_order, resume_ttl_hours
)
VALUES (
  'hairstyle', '헤어스타일', '새로운 머리 모양, 오늘은 어떻게 해볼까?', '💇',
  3, true, true, 15, 6
)
ON CONFLICT (play_id) DO UPDATE
SET display_name     = EXCLUDED.display_name,
    description      = EXCLUDED.description,
    icon             = EXCLUDED.icon,
    keys_cost        = EXCLUDED.keys_cost,
    is_visible       = EXCLUDED.is_visible,
    is_active        = EXCLUDED.is_active,
    sort_order       = EXCLUDED.sort_order,
    resume_ttl_hours = EXCLUDED.resume_ttl_hours,
    updated_at       = now();
