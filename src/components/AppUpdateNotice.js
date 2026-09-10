import { useEffect } from "react";
import { Alert } from "react-native";
import * as Updates from "expo-updates";

export function AppUpdateNotice() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (!Updates.isEnabled || !isUpdatePending) return;
    Alert.alert("App update ready", "The latest Jixels update has downloaded. Restart the app to apply it.", [
      { text: "Later", style: "cancel" },
      { text: "Restart", onPress: () => Updates.reloadAsync().catch(() => Alert.alert("Restart required", "Close and reopen the app to apply the update.")) },
    ]);
  }, [isUpdatePending]);
  return null;
}
