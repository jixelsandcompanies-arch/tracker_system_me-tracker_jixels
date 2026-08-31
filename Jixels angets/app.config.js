export default {
  expo: {
    owner: "jixels-2026",
    name: "Jixels Agent Trackings",
    slug: "jixels-agent-trackings",
    version: "1.0.0",
    scheme: "jixelsagenttrackings",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/jixels-agent-icon.png",
    splash: {
      image: "./assets/jixels-agent-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0D467D"
    },
    android: {
      package: "com.jixelstechnologies.agent",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/jixels-agent-icon.png",
        backgroundColor: "#FFFFFF"
      },
      permissions: ["CAMERA", "POST_NOTIFICATIONS"]
    },
    ios: {
      bundleIdentifier: "com.jixelstechnologies.agent",
      buildNumber: "1",
      supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription: "Jixels Agent Trackings uses the camera to capture customer KYC and installation photos.",
        NSPhotoLibraryUsageDescription: "Jixels Agent Trackings can attach customer KYC and installation photos from your library."
      }
    },
    plugins: [
      "expo-secure-store",
      "expo-notifications",
      "expo-font",
      [
        "expo-image-picker",
        {
          "photosPermission": "Allow Jixels Agent Trackings to attach customer KYC and installation photos.",
          "cameraPermission": "Allow Jixels Agent Trackings to capture customer KYC and installation photos.",
          "microphonePermission": false
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "Allow Jixels Agent Trackings to capture installation location for tracker setup."
        }
      ]
    ],
    extra: {
      eas: { projectId: process.env.EXPO_PUBLIC_AGENT_EAS_PROJECT_ID || "d39d37aa-156b-4bfd-b74d-c2fb8aed6bb6" }
    }
  }
};
