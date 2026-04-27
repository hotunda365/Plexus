ALTER TABLE IF EXISTS public.px_messages
  ADD COLUMN IF NOT EXISTS wa_media_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_caption TEXT,
  ADD COLUMN IF NOT EXISTS wa_media_filename TEXT;

CREATE INDEX IF NOT EXISTS idx_px_messages_wa_media_id
  ON public.px_messages (wa_media_id);
