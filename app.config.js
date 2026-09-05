export default {
  expo: {
    name: "Jixels Customer Trackings",
    slug: "jixels-customer-trackings",
    version: "1.0.0",
    scheme: "jixelscustomertrackings",

    orientation: "portrait",
    platforms: ["android", "ios"],
    userInterfaceStyle: "automatic",

    icon: "./assets/jixels-app-icon.png",

    splash: {
      image: "./assets/jixels-app-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0D467D",
    },

    android: {
      package: "com.jixelstechnologies.customer",
      versionCode: 1,

      adaptiveIcon: {
        foregroundImage: "./assets/jixels-app-icon.png",
        backgroundColor: "#FFFFFF",
      },

      permissions: [
        "CAMERA",
        "POST_NOTIFICATIONS",
      ],
    },

    ios: {
      bundleIdentifier: "com.jixelstechnologies.customer",
      buildNumber: "1",
      supportsTablet: true,

      infoPlist: {
        NSCameraUsageDescription:
          "Jixels Agent Trackings uses the camera to capture customer KYC and installation photos.",

        NSPhotoLibraryUsageDescription:
          "Jixels Agent Trackings can attach customer KYC and installation photos from your library.",
      },
    },

    plugins: [
      "expo-secure-store",
      "expo-notifications",

      [
        "expo-image-picker",
        {
          photosPermission:
            "Allow Jixels Customer Trackings to attach account and vehicle photos.",

          cameraPermission:
            "Allow Jixels Customer Trackings to capture account and vehicle photos.",

          microphonePermission: false,
        },
      ],

      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Allow Jixels Customer Trackings to access your location for vehicle tracking.",
        },
      ],
    ],

    extra: {
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "000c3287-aab6-4be1-858a-3ddf2c670c49",
      },
    },
  },
};
