ALTER TABLE IF EXISTS public.px_messages
  ADD COLUMN IF NOT EXISTS message_direction TEXT DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS wa_message_status TEXT,
  ADD COLUMN IF NOT EXISTS wa_business_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_business_display_phone TEXT,
  ADD COLUMN IF NOT EXISTS wa_from_phone TEXT,
  ADD COLUMN IF NOT EXISTS wa_to_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_px_messages_message_direction
  ON public.px_messages (message_direction);

CREATE INDEX IF NOT EXISTS idx_px_messages_wa_business_phone_number_id
  ON public.px_messages (wa_business_phone_number_id);
