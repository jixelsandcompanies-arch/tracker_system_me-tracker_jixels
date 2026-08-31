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

The Expo owner is configured as `jixels-2026`, and the Android package is `com.jixelstechnologies.agent`.

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
