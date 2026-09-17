-- Run in Supabase SQL Editor (or via MCP execute_sql). Wrapped in begin/rollback: leaves no rows behind.
-- Passes silently; any failed assertion raises.
begin;
do $$
declare uid uuid; nid uuid; stamp timestamptz := clock_timestamp(); ok boolean;
begin
  select id into uid from auth.users limit 1;
  if uid is null then raise exception 'Test requires an existing user'; end if;
  insert into public.notes(user_id, content, processing_status, updated_at, category, category_locked)
    values(uid, 'Transactional regression fixture', 'processing', stamp, 'Personal', true) returning id into nid;
  select public.finish_note_processing(nid, stamp - interval '1 second',
    jsonb_build_array(jsonb_build_object('chunk_index',0,'chunk_text','old','embedding',
      '[' || array_to_string(array_fill(0.01::float4, array[1024]), ',') || ']')), 'Work', array['test']) into ok;
  if ok then raise exception 'Stale claim accepted'; end if;
  begin
    perform public.finish_note_processing(nid, stamp,
      '[{"chunk_index":0,"chunk_text":"invalid","embedding":"not-a-vector"}]', 'Work', array['test']);
    raise exception 'Invalid embedding accepted';
  exception when data_exception then null;
  end;
  if (select processing_status from public.notes where id = nid) <> 'processing' then raise exception 'Failed transaction changed status'; end if;
  if exists(select 1 from public.note_chunks where note_id = nid) then raise exception 'Failed transaction left partial chunks'; end if;
  if has_function_privilege('authenticated', 'public.finish_note_processing(uuid,timestamptz,jsonb,text,text[])', 'execute') then raise exception 'Unexpected client access'; end if;
  -- happy path: valid 1024-d chunk with a fresh claim lands and a locked category survives
  select public.finish_note_processing(nid, stamp,
    jsonb_build_array(jsonb_build_object('chunk_index',0,'chunk_text','ok','embedding',
      '[' || array_to_string(array_fill(0.01::float4, array[1024]), ',') || ']')), 'Work', array['test']) into ok;
  if not ok then raise exception 'Fresh claim rejected'; end if;
  if (select category from public.notes where id = nid) <> 'Personal' then raise exception 'Locked category overwritten'; end if;
  if (select count(*) from public.note_chunks where note_id = nid) <> 1 then raise exception 'Chunk not written'; end if;
end $$;
rollback;
