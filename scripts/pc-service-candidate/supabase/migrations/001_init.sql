-- PC Service Fullstack Database Schema
CREATE TABLE IF NOT EXISTS app.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text NOT NULL CHECK (length(trim(phone)) >= 8),
  email text CHECK (email IS NULL OR email ~* '^[^@]+@[^@]+[.][^@]+$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_all" ON app.clients FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "clients_insert_all" ON app.clients FOR INSERT TO anon, authenticated WITH CHECK (length(trim(name)) > 0 AND length(trim(phone)) >= 8);
CREATE POLICY "clients_update_all" ON app.clients FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (length(trim(name)) > 0 AND length(trim(phone)) >= 8);
CREATE POLICY "clients_delete_all" ON app.clients FOR DELETE TO anon, authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.clients TO anon, authenticated;
