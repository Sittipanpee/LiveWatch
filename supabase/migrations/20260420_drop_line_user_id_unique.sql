-- Allow multiple app accounts to share the same LINE user ID.
-- One LINE account (e.g. a team owner) can receive alerts from N seller accounts.
alter table public.users drop constraint if exists users_line_user_id_key;
