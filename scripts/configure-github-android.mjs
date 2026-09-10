// Applied after Expo prebuild. Signing secrets remain in the runner environment.
import fs from 'node:fs';
const path = 'android/app/build.gradle';
let gradle = fs.readFileSync(path, 'utf8');
if (!gradle.includes('signingConfigs {') || !gradle.includes('signingConfig signingConfigs.debug')) throw new Error('Unexpected generated signing configuration');
gradle = gradle.replace('signingConfigs {', `signingConfigs {
        release {
            storeFile rootProject.file("release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`);
const releaseStart = gradle.indexOf('release {', gradle.indexOf('buildTypes {'));
if (releaseStart < 0) throw new Error('Missing release build type');
gradle = gradle.slice(0, releaseStart) + gradle.slice(releaseStart).replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release');
fs.writeFileSync(path, gradle);
fs.writeFileSync('android/release.keystore', Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'), { mode: 0o600 });
