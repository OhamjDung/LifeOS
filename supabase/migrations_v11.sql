-- Run in Supabase SQL Editor after migrations_v10.sql
--
-- 1. notes.last_error — written by fn-embed-note's failure path and by
--    finish_note_processing (v10), but the column never existed, so both writes
--    were failing and retry_count never advanced.
alter table public.notes add column if not exists last_error text;

-- 2. Embedding dimensions. note_chunks.embedding was vector(1536) from the
--    text-embedding-3-small era; every Jina (jina-embeddings-v3) vector is 1024.
--    Since the Jina switch every chunk insert silently failed and notes were
--    marked 'done' with zero chunks, so semantic search has been empty for new
--    notes. The 7 surviving 1536-d rows are from the old model and can't be
--    compared with 1024-d queries, so they go too.
delete from public.note_chunks;
drop index if exists public.note_chunks_hnsw;
alter table public.note_chunks alter column embedding type vector(1024);
create index note_chunks_hnsw on public.note_chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- 3. Re-queue every note so fn-embed-note rebuilds chunks with Jina.
--    Manual categories are preserved by category_locked (v10).
update public.notes
set processing_status = 'pending', retry_count = 0, last_error = null
where processing_status in ('done', 'failed', 'processing');
