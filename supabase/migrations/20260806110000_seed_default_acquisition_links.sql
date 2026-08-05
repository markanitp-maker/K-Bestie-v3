-- Idempotent seed for 9 default acquisition channels (official_launch campaign)
-- Will not insert duplicates if link_id or (utm_source, utm_medium) already exists.

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'instagram_official_launch', '인스타그램', 'instagram', 'social', 'official_launch', '인스타 게시물·프로필', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'instagram_official_launch' OR (utm_source = 'instagram' AND utm_medium = 'social')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'youtube_official_launch', '유튜브', 'youtube', 'video', 'official_launch', '유튜브 영상·쇼츠', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'youtube_official_launch' OR (utm_source = 'youtube' AND utm_medium = 'video')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'blog_official_launch', '블로그', 'blog', 'content', 'official_launch', '네이버 블로그 등', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'blog_official_launch' OR (utm_source = 'blog' AND utm_medium = 'content')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'meta_ads_official_launch', 'Meta 광고', 'meta_ads', 'paid', 'official_launch', '페이스북·인스타 광고', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'meta_ads_official_launch' OR (utm_source = 'meta_ads' AND utm_medium = 'paid')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'facebook_official_launch', '페이스북', 'facebook', 'referral', 'official_launch', '페이스북 공유·그룹', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'facebook_official_launch' OR (utm_source = 'facebook' AND utm_medium = 'referral')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'kakao_official_launch', '카카오톡', 'kakao', 'referral', 'official_launch', '카카오톡 지인 공유', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'kakao_official_launch' OR (utm_source = 'kakao' AND utm_medium = 'referral')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'kakao_openchat_official_launch', '카카오톡 오픈채팅방', 'kakao_openchat', 'community', 'official_launch', '육아 오픈채팅', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'kakao_openchat_official_launch' OR (utm_source = 'kakao_openchat' AND utm_medium = 'community')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'naver_cafe_official_launch', '네이버 카페', 'naver_cafe', 'community', 'official_launch', '부모 커뮤니티', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'naver_cafe_official_launch' OR (utm_source = 'naver_cafe' AND utm_medium = 'community')
);

INSERT INTO public.acquisition_links (
    link_id, channel_name, utm_source, utm_medium, utm_campaign, purpose, destination_path, status
)
SELECT 'direct_official_launch', '직접 공유', 'direct', 'personal', 'official_launch', '대표님 직접 전달', '/signup', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1 FROM public.acquisition_links
    WHERE link_id = 'direct_official_launch' OR (utm_source = 'direct' AND utm_medium = 'personal')
);
