-- Atomic indexing: old workers cannot replace chunks for newer edits.
alter table public.notes add column if not exists category_locked boolean not null default false;

create or replace function public.finish_note_processing(
  p_note_id uuid, p_claim_time timestamptz, p_chunks jsonb,
  p_category text, p_tags text[]
) returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare current_note public.notes%rowtype;
begin
  select * into current_note from public.notes where id = p_note_id for update;
  if not found or current_note.updated_at is distinct from p_claim_time
     or current_note.processing_status <> 'processing' then return false; end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'Expected non-empty chunks';
  end if;
  delete from public.note_chunks where note_id = p_note_id;
  insert into public.note_chunks(note_id, chunk_index, chunk_text, embedding)
    select p_note_id, (item->>'chunk_index')::integer, item->>'chunk_text',
           (item->>'embedding')::vector
    from jsonb_array_elements(p_chunks) as item;
  update public.notes set
    category = case when category_locked then category else p_category end,
    tags = case when category_locked then tags else p_tags end,
    processing_status = 'done', last_error = null
  where id = p_note_id;
  return true;
end;
$$;
revoke all on function public.finish_note_processing(uuid, timestamptz, jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.finish_note_processing(uuid, timestamptz, jsonb, text, text[]) to service_role;
