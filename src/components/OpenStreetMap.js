import React from "react";
import { Linking, Pressable, Text, View } from "react-native";

export default function OpenStreetMap({ coordinate, label = "Current location" }) {
  const url = coordinate
    ? `https://www.openstreetmap.org/?mlat=${coordinate.latitude}&mlon=${coordinate.longitude}#map=15/${coordinate.latitude}/${coordinate.longitude}`
    : "https://www.openstreetmap.org/";
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#e8f1fa", padding: 24 }}>
    <Text style={{ color: "#0d467d", fontSize: 18, fontWeight: "700" }}>{label}</Text>
    {coordinate && <Text style={{ color: "#334155", marginTop: 8 }}>{coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}</Text>}
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)} style={{ marginTop: 16, padding: 12, backgroundColor: "white", borderRadius: 10 }}>
      <Text style={{ color: "#1479c9", fontWeight: "700" }}>Open map</Text>
    </Pressable>
  </View>;
}
