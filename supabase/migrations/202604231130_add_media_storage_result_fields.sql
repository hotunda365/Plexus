ALTER TABLE IF EXISTS public.px_messages
  ADD COLUMN IF NOT EXISTS wa_media_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_storage_status TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_storage_error TEXT;

CREATE INDEX IF NOT EXISTS idx_px_messages_wa_media_storage_status
  ON public.px_messages (wa_media_storage_status);
