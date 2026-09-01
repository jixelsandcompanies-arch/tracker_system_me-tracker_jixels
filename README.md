# Jixels Customer Tracking App

New JavaScript React Native customer app for Jixels Technologies. It displays a real interactive map with a custom motorcycle marker, tracker status, map controls, device location, and route history.

## Run locally

1. Copy `.env.example` to `.env` and enter the Supabase Edge Function URL.
2. Run `npm install`.
3. Run `npm run android` or `npm run ios`.

## Deploy the web app to Vercel

This project is an Expo mobile app with a single-page web export. Vercel serves
the generated `dist` folder; it does not host the tracker API.

1. Import the repository in Vercel and set the project root directory to this
   folder (the one containing `package.json` and `vercel.json`).
2. Add these environment variables in **Settings → Environment Variables**:
   `EXPO_PUBLIC_JIXELS_API_URL` and `EXPO_PUBLIC_EAS_PROJECT_ID`. The API URL
   must be an HTTPS URL. The web map uses Leaflet with OpenStreetMap tiles and
   does not need a Google Maps key.
3. Redeploy. Vercel will run `npm install`, export the Expo web app into
   `dist`, and serve `dist/index.html` for every web route.

For local web testing, run `npm install` followed by `npm run build`.

## Supabase setup

1. Create a Supabase project, then open its **SQL Editor** and run
   `supabase/migrations/20260831_0001_tracker_schema.sql`.
2. Install the Supabase CLI, run `supabase login`, link the project with
   `supabase link --project-ref <your-project-ref>`, then deploy the API with
   `supabase functions deploy api`.
3. Set `EXPO_PUBLIC_JIXELS_API_URL` to
   `https://<your-project-ref>.supabase.co/functions/v1/api` in Vercel and
   EAS. Do not put a Supabase secret or service-role key in Vercel public
   variables or in the app.

The migration enables Row Level Security. The Edge Function uses Supabase Auth
for registration and login, returns owned vehicles and locations, and serves
route history. Connect your tracker provider to insert validated locations into
`tracker_locations`; implement the M-Pesa provider callback before accepting
real payments.

## Environment values

Set these in Vercel for **Production**, **Preview**, and **Development**:

```
EXPO_PUBLIC_JIXELS_API_URL=https://<your-project-ref>.supabase.co/functions/v1/api
EXPO_PUBLIC_EAS_PROJECT_ID=<your-expo-project-id>
EXPO_PUBLIC_DEMO_MODE=false
```

`EXPO_PUBLIC_EAS_PROJECT_ID` is a public Expo/EAS project identifier. Find it
in the Expo project dashboard or by running `npx eas-cli@latest project:info`
after signing in. All `EXPO_PUBLIC_`
values are included in the browser/mobile app, so they must never contain
passwords, service-role keys, M-Pesa secrets, or tracker-provider credentials.

For installable builds, sign in to the Expo account that owns this project and
run `npx eas-cli@latest build --platform android --profile preview` for an
installable APK, or use `--profile production` for the Android Play Store build
and iOS build. The existing `eas.json` configures these profiles.

Set `EXPO_PUBLIC_DEMO_MODE=true` while developing the interface. Production and preview EAS profiles force it to `false`. Never ship a production build with demo mode enabled.

The existing Live Tracking interface is intentionally stable. `src/demoData.js` supports local UI development; `src/services/tracking.js` supplies the same interface with authenticated backend data in production.

## Backend contract

- `POST /v1/auth/register`
- `POST /v1/auth/login` → `{ accessToken, expiresAt?, user }` or `{ session: { accessToken, expiresAt?, user } }`
- `POST /v1/auth/request-password-reset`
- `POST /v1/auth/verify-admin-otp`
- `POST /v1/auth/request-admin-otp`
- `GET /v1/auth/account-status?email=...`
- `GET /v1/customer/overview`
- `PATCH /v1/customer/profile`
- `GET /v1/customer/payments`
- `POST /v1/customer/payments/mpesa` with an `Idempotency-Key` header
- `GET /v1/customer/alerts`
- `POST /v1/customer/alerts/read`
- `DELETE /v1/customer/alerts`
- `POST /v1/customer/reports`
- `GET /v1/customer/motorcycles/:id/location`
- `GET /v1/customer/motorcycles/:id/route?range=today`
- Socket.IO event `tracker:subscribe` with `{ motorcycleId }`
- Socket.IO event `tracker:location` for authorized location updates

The backend—not this app—must hold Tramigo credentials, validate the customer token, confirm motorcycle ownership, apply stale/offline thresholds, and downsample route history.

The backend must also enforce approval state, password hashing, the two-attempt login lock policy, OTP expiry and single use, ownership checks on every customer resource, M-Pesa callback validation, idempotency, payment/balance calculations, push-token registration, audit logs, and server-side rate limiting. Client validation is only a usability feature and is never a security boundary.

Live tracking prefers Socket.IO. If the socket cannot connect, the app falls back to a battery-friendly 30-second poll rather than requesting a location every second.

## Production checks

Run `npm run check` during development. In CI or with `NODE_ENV=production`, it also requires the HTTPS API URL and EAS project ID, and rejects demo mode.

Run `npm run export:android` to verify that Metro can create the Android production bundle. Native APK/AAB and iOS IPA builds are configured through `eas.json`.
