-- Run in Supabase SQL Editor after migrations_v14.sql

-- fn-chat applies proposals stored on chat_messages with the service role, so
-- users must not be able to rewrite them. The web client only reads these two
-- tables (writes go through fn-chat); allow select + delete (clear history), not
-- insert/update.
drop policy if exists chat_threads_rls on chat_threads;
drop policy if exists chat_messages_rls on chat_messages;

create policy chat_threads_select on chat_threads for select using (auth.uid() = user_id);
create policy chat_threads_delete on chat_threads for delete using (auth.uid() = user_id);
create policy chat_messages_select on chat_messages for select using (auth.uid() = user_id);
create policy chat_messages_delete on chat_messages for delete using (auth.uid() = user_id);
