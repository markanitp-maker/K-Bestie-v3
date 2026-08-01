SELECT count(*) as legacy_chat_messages_count FROM chat_messages;
SELECT count(*) as legacy_mission_count FROM chat_messages m JOIN chat_sessions s ON m.session_id = s.id WHERE s.session_type = 'mission';
SELECT count(*) as raw_daily_conversations_count FROM raw_daily_conversations;
SELECT count(*) as corrected_daily_conversations_count FROM corrected_daily_conversations;
SELECT enabled, cutover_at FROM pipeline_v3_control LIMIT 1;
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname IN ('claim_pipeline_jobs', 'collect_chat_messages_v3');
