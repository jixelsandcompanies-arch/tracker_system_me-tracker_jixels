# Jixels Customer Tracking App

New JavaScript React Native customer app for Jixels Technologies. It displays a real interactive map with a custom motorcycle marker, tracker status, map controls, device location, and route history.

## Run locally

1. Copy `.env.example` to `.env` and enter the Jixels API URL and Google Maps key.
2. Run `npm install`.
3. Run `npm run android` or `npm run ios`.

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

Run `npm run check` during development. In CI or with `NODE_ENV=production`, it also requires the HTTPS API URL, Google Maps key and EAS project ID, and rejects demo mode.

Run `npm run export:android` to verify that Metro can create the Android production bundle. Native APK/AAB and iOS IPA builds are configured through `eas.json`.
