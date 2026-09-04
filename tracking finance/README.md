# Jixels Finance

Start the site from this folder with `node server.js`, then open `http://localhost:5500`.

The portal is connected to the shared Supabase backend:

- Finance registration calls `/functions/v1/api/v1/finance/auth/register`.
- Finance login uses Supabase Auth, then checks the signed-in user's `profiles` row for a finance/admin role and an active or approved status.
- Finance records sync to `finance_accounts`, `finance_payments`, `finance_agents`, `finance_alerts`, `finance_audit_logs`, and `finance_settings`.

Only the publishable Supabase key is embedded in the browser app. Never add a service-role key or payment/tracker secret here.
