-- ===========================================================================
-- Photos and voice notes in the family chat were always refused
--
-- The baseline check messages_content_length requires non-blank content. The
-- chat_media migration (2026-08-31) made an attachment a message on its own,
-- sent with content = empty string when there is no caption, and send_message
-- accepts that, but the table check was never relaxed. Every uncaptioned
-- photo, video, voice note or document failed with 23514 and the app showed
-- "Could not send message".
--
-- New rule: content may be blank only when the row carries an attachment.
-- The upper bound moves from 2000 to 4000 to match what send_message and
-- send_direct_message already enforce, so a long text is refused with the
-- readable RPC error rather than a raw constraint violation.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

alter table public.messages drop constraint if exists messages_content_length;

alter table public.messages add constraint messages_content_length check (
  char_length(content) <= 4000
  and (char_length(btrim(content)) > 0 or media_path is not null)
);
