ALTER TABLE IF EXISTS public.px_messages
  ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_message_type TEXT,
  ADD COLUMN IF NOT EXISTS wa_message_timestamp TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_px_messages_wa_message_id ON public.px_messages (wa_message_id);
