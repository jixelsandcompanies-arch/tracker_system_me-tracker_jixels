# Jixels Admin

An operations dashboard for Jixels fleet, customer, payment, tracker, and support workflows.

## Run locally

```bash
npm install
npm run dev
```

Run `npm run build` for a production bundle and `npm test` for sidebar-module smoke tests.

## Supabase

Copy `.env.example` to `.env.local`, provide the project URL and anon key, then run `supabase/schema.sql` in the Supabase SQL editor. Full production and tracker-heartbeat instructions are in [SETUP.md](SETUP.md).
