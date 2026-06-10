-- Run in Supabase SQL Editor

-- Widget registrations: maps per-device widget UUID → user
CREATE TABLE IF NOT EXISTS widget_registrations (
  widget_id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE widget_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users_own_widget_registrations" ON widget_registrations
  FOR ALL USING (auth.uid() = user_id);


-- New columns on tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'task'
  CHECK (task_type IN ('task', 'event'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rollover_count INT NOT NULL DEFAULT 0;

-- Backfill rollover_count from existing task_rollovers rows
UPDATE tasks t
SET rollover_count = (SELECT COUNT(*) FROM task_rollovers WHERE task_id = t.id);

-- Trigger: increment rollover_count each time a rollover is logged
CREATE OR REPLACE FUNCTION increment_task_rollover_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tasks SET rollover_count = rollover_count + 1 WHERE id = NEW.task_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_increment_rollover_count ON task_rollovers;
CREATE TRIGGER trg_increment_rollover_count
  AFTER INSERT ON task_rollovers
  FOR EACH ROW EXECUTE FUNCTION increment_task_rollover_count();

-- Trigger: completing an event task updates contact's last_contacted_at
CREATE OR REPLACE FUNCTION sync_contact_from_event_task()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done'
     AND NEW.task_type = 'event'
     AND NEW.contact_id IS NOT NULL
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE contacts
    SET last_contacted_at = NOW(), updated_at = NOW()
    WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_task_contact ON tasks;
CREATE TRIGGER trg_event_task_contact
  AFTER UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_contact_from_event_task();
