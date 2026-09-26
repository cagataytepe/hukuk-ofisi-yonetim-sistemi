-- Least-privilege hardening only; no data is changed.
revoke delete on table public.push_notification_preferences from authenticated;
