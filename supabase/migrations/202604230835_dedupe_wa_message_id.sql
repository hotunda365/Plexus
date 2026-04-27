-- Remove historical duplicates before adding uniqueness guarantee.
DELETE FROM public.px_messages a
USING public.px_messages b
WHERE a.ctid < b.ctid
  AND a.wa_message_id IS NOT NULL
  AND a.wa_message_id = b.wa_message_id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_px_messages_wa_message_id
ON public.px_messages (wa_message_id)
WHERE wa_message_id IS NOT NULL;
