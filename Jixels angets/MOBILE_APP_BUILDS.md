# Jixels Agents Mobile App Builds

This agent portal is a React Native app powered by Expo for Android and iOS.

## Expo Go

```powershell
npm start
```

Scan the QR code with Expo Go on Android or iOS.

## Android development

```powershell
npm run android
```

The app display name is `Jixels Agent Trackings`.
The Android package is configured as `com.jixelstechnologies.agent`.

## iOS

```powershell
npm run ios
```

The iOS bundle identifier is configured as `com.jixelstechnologies.agent`.

## Google Play release

The Expo owner is configured as `jixels-2026`, the EAS project is `d39d37aa-156b-4bfd-b74d-c2fb8aed6bb6`, and the Android package is `com.jixelstechnologies.agent`.

Before building for Google Play, configure the production backend URL:

```powershell
npx eas-cli env:create production --name EXPO_PUBLIC_JIXELS_AGENT_API_URL --value https://your-agent-api.example.com --visibility plaintext --non-interactive
```

You can also use `EXPO_PUBLIC_JIXELS_API_URL` if the agent and customer apps share the same backend.

Build the Play Store Android App Bundle:

```powershell
npm run build:android:play
```

Submit the latest production build to the Google Play internal track:

```powershell
npm run submit:android:play
```

Build and submit in one command:

```powershell
npm run release:android:play
```

These scripts set `EAS_NO_VCS=1` and `EAS_PROJECT_ROOT` because this machine's Git root is above the app folder. That keeps unrelated Windows/user files out of the EAS upload.

Submission requires access to the Google Play Console app plus a Play Android service account with release permissions. Keep the service account JSON outside git and provide it only when EAS asks for it.

The latest completed production build before backend auth was enforced was:

```text
https://expo.dev/accounts/jixels-2026/projects/jixels-agent-trackings/builds/7bf59911-bc08-44ab-a24e-dc50c21c82c2
https://expo.dev/artifacts/eas/JhhLy3AscoBxJjuNJ3eqstQMTf8MeLdFptbU2urgffc.aab
```

Do not submit that old AAB if you require backend-auth-only behavior. Rebuild after setting `EXPO_PUBLIC_JIXELS_AGENT_API_URL`.
