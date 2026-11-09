-- Adds the flat's members. Run AFTER schema.sql, in Supabase → SQL Editor.
--
-- 1. Edit the names and usernames below (usernames: lowercase letters, numbers, _ or .).
-- 2. Exactly one person should be the admin (true). The admin can only add/edit/remove
--    members. Expenses and payments can be changed ONLY by the person who added them.
-- 3. Then create a login for each username in Supabase → Authentication → Users →
--    "Add user" → "Create new user":
--        Email:    <username>@flat6.app      (e.g. ali@flat6.app; no email is ever sent)
--        Password: choose one and give it to that person
--        Tick "Auto Confirm User".
-- 4. Each person logs in to the app with their username (e.g. "ali") and password.

insert into public.members (name, username, is_admin) values
  ('Asjad',   'asjad',  true),
  ('Yasir',    'yasir',    false),
  ('Kaleem', 'kaleem',  false),
  ('Usman', 'usman',  false),
  ('Tayab', 'tayab',  false),
  ('Shah',        'shah',   false),
  ('Tahir',       'tahir',  false);
