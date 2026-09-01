# Jixels Admin Setup

## Local preview

```bash
npm install
npm run dev
```

Supabase authentication is required for every environment. Configure it before signing in.

## Supabase production setup

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. It creates every module table, chat realtime publication, RLS policies, and the heartbeat RPC.
3. Run [`supabase/migrations/20260822_database_hardening.sql`](supabase/migrations/20260822_database_hardening.sql). It adds validation, indexes, immutable audits, heartbeat history, and stale-tracker handling.
3. Run [`supabase/migrations/20260822_screening.sql`](supabase/migrations/20260822_screening.sql) to enable screening.
4. Create admin users in Supabase Auth.
5. Add a matching row in `public.profiles` for each user.
6. Copy `.env.example` to `.env.local` and fill in the project URL and anon key.
7. Configure the deployed site URL and redirect URLs in Supabase Authentication settings.
8. In Supabase Dashboard, enable Realtime replication for `chat_messages` if it was not enabled automatically by the SQL script.
9. Set `TRACKER_INGEST_TOKEN` as an Edge Function secret and deploy `supabase/functions/tracker-heartbeat` with `supabase functions deploy tracker-heartbeat --no-verify-jwt`.
10. Deploy with `npm run build`. `netlify.toml` provides a production build target and baseline security headers for Netlify.

Only the public anon key belongs in the browser. Never put a Supabase service-role key in `.env.local` or frontend code.

## Production checklist

- Enable email verification and MFA for administrator accounts.
- Confirm every table has RLS enabled and test each role with a separate account.
- Add HTTPS, secure hosting headers, rate limiting, and server-side validation at the API boundary.
- Send tracker heartbeats as `POST /functions/v1/tracker-heartbeat` with `x-tracker-token` and `{ trackerId, latitude, longitude, batteryPercent }`.
- Keep the tracker ingest token only in the device gateway; never put it in the browser.
- Run `npm test` before deploy; it smoke-tests each sidebar module.
- Confirm exports are permission-filtered by backend queries.
- Review the audit log retention and backup policy.
