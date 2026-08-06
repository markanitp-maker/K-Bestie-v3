ALTER TABLE child_temporal_context ALTER COLUMN source_message_id TYPE TEXT USING source_message_id::text;
