import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Animated,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
import { ApiError } from "./src/services/api";
import { authApi } from "./src/services/auth";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

const colors = {
  ink: "#10243B",
  muted: "#64748B",
  line: "#DCE6F2",
  white: "#FFFFFF",
  surface: "#F4F8FC",
  blue: "#0969DA",
  blueDark: "#0D467D",
  bluePale: "#EAF5FF",
  green: "#15845F",
  greenPale: "#EAF9F2",
  orange: "#F59E0B",
  orangePale: "#FFF7E8",
  red: "#DC3B2A",
  redPale: "#FDECEC"
};

const initialCustomers = [];
const trackerStock = [];
const COMMISSION_RATE = 0.2;

const screens = [
  { key: "dashboard", label: "Home", icon: "grid-outline" },
  { key: "customers", label: "Customers", icon: "people-outline" },
  { key: "onboard", label: "New customer", icon: "person-add-outline" },
  { key: "payments", label: "Commissions", icon: "cash-outline" },
  { key: "alerts", label: "Alerts", icon: "notifications-outline" }
];

const moreScreens = [
  { key: "trackers", label: "Trackers", icon: "radio-outline" },
  { key: "reports", label: "Reports", icon: "document-text-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
  { key: "profile", label: "Profile", icon: "person-circle-outline" }
];

const allScreens = [...screens, ...moreScreens];
const DRAWER_WIDTH = 238;
const GPS_LAUNCH_SECONDS = 7;
const reportPeriods = [
  { key: "daily", label: "Daily", icon: "today-outline" },
  { key: "weekly", label: "Weekly", icon: "calendar-outline" },
  { key: "monthly", label: "Monthly", icon: "calendar-number-outline" },
  { key: "yearly", label: "Yearly", icon: "bar-chart-outline" }
];

function money(value) {
  return `KES ${Number(value || 0).toLocaleString()}`;
}

function normalizeAssignedVehicle(record = {}) {
  const id = record.id || record.productId || record.vehicleId || record.identifier || record.registration || record.plate;
  if (!id) return null;
  const registration = String(record.registration || record.plate || record.identifier || record.tracker_number || id).toUpperCase();
  const tracker = String(record.tracker || record.trackerNumber || record.tracker_number || record.trackerId || "Pending").toUpperCase();
  const payableAmount = Number(record.payableAmount ?? record.payable_amount ?? record.totalPayable ?? record.total ?? record.price ?? 0);
  return {
    id: String(id),
    registration,
    model: record.model || record.product_type || record.productType || "Assigned bike",
    tracker,
    payableAmount: Number.isFinite(payableAmount) ? payableAmount : 0,
    status: record.status || record.assignmentStatus || "assigned",
    assignedAgentId: record.assigned_agent_id || record.assignedAgentId || record.agentId || null
  };
}

function normalizeAssignedVehicles(agent = {}) {
  const source = agent.assignedVehicles || agent.assignedBikes || agent.vehicles || agent.bikes || agent.session?.user?.assignedVehicles || [];
  if (!Array.isArray(source)) return [];
  const agentIds = new Set([agent.id, agent.code, agent.agentCode, agent.session?.user?.id, agent.session?.user?.agentCode].filter(Boolean).map(String));
  return source
    .map(normalizeAssignedVehicle)
    .filter(Boolean)
    .filter(vehicle => {
      const status = String(vehicle.status || "").toLowerCase();
      if (["available", "stock", "unassigned"].includes(status)) return false;
      if (!vehicle.assignedAgentId) return true;
      return agentIds.has(String(vehicle.assignedAgentId));
    });
}

function customerBalance(customer) {
  if (customer.balance != null) return Number(customer.balance) || 0;
  return Math.max(0, Number(customer.payableAmount || 0) - Number(customer.amount || 0));
}

function customerPaymentComplete(customer) {
  return ["Paid", "Deposit Paid"].includes(customer.payment);
}

function customerSaleStatus(customer) {
  return customer.install === "Complete" && customerPaymentComplete(customer) ? "Complete" : "Pending";
}

function displayNameFromEmail(email) {
  const localPart = email.split("@")[0] || "agent";
  return localPart.replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeAgentSession(session, fallbackEmail) {
  const user = session?.user || {};
  return {
    id: user.id || user.agentCode || user.code || "",
    name: user.name || user.fullName || user.full_name || displayNameFromEmail(fallbackEmail),
    email: user.email || fallbackEmail,
    phone: user.phone || user.phoneNumber || "",
    role: user.role || "Field Agent",
    code: user.code || user.agentCode || user.id || "Signed in",
    accessToken: session?.accessToken,
    session
  };
}

function tap() {
  Haptics.selectionAsync().catch(() => {});
}

function pullRefresh(onRefresh, refreshing = false) {
  return onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.blue]} tintColor={colors.blue} progressBackgroundColor={colors.white} /> : undefined;
}

function statusColors(value = "") {
  const lower = value.toLowerCase();
  if (["paid", "deposit paid", "approved", "complete", "online", "ready", "available", "earned"].includes(lower)) return [colors.green, colors.greenPale];
  if (["pending", "assigned", "submitted", "processing"].includes(lower)) return [colors.orange, colors.orangePale];
  return [colors.red, colors.redPale];
}

function Pill({ value }) {
  const [text, bg] = statusColors(value);
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color: text }]}>{value}</Text></View>;
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType }) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isSecure = Boolean(secureTextEntry);
  return <View style={styles.fieldWrap}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.inputShell}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor="#94A3B8"
        secureTextEntry={isSecure && !passwordVisible}
        keyboardType={keyboardType}
        autoCapitalize="none"
        style={styles.input}
      />
      {isSecure && <Pressable accessibilityRole="button" accessibilityLabel={passwordVisible ? "Hide password" : "Show password"} onPress={() => setPasswordVisible(visible => !visible)} style={styles.passwordToggle}>
        <Ionicons name={passwordVisible ? "eye-off-outline" : "eye-outline"} size={18} color={colors.muted} />
      </Pressable>}
    </View>
  </View>;
}

function SkeletonBlock({ style, shimmer }) {
  return <View style={[styles.skeleton, style]}>
    <Animated.View
      pointerEvents="none"
      style={[styles.skeletonShine, {
        transform: [
          { translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-120, 430] }) },
          { skewX: "-16deg" }
        ]
      }]}
    />
  </View>;
}

function ActivitySkeleton({ screen = "dashboard" }) {
  const shimmer = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    shimmer.setValue(0);
    const animation = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1200, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [shimmer]);

  if (screen === "auth") {
    return <View style={styles.authSkeleton}>
      <SkeletonBlock shimmer={shimmer} style={styles.skeletonAuthCard} />
      <SkeletonBlock shimmer={shimmer} style={styles.skeletonLabel} />
      {[1, 2].map(item => <View key={item}>
        <SkeletonBlock shimmer={shimmer} style={styles.skeletonSmallLabel} />
        <SkeletonBlock shimmer={shimmer} style={styles.skeletonInput} />
      </View>)}
      <SkeletonBlock shimmer={shimmer} style={styles.skeletonSubmit} />
      <SkeletonBlock shimmer={shimmer} style={styles.skeletonAuthFooter} />
    </View>;
  }

  return <View style={styles.skeletonPage}>
    <SkeletonBlock shimmer={shimmer} style={styles.skeletonHero} />
    <View style={styles.skeletonGrid}>
      {[1, 2, 3, 4].map(item => <SkeletonBlock key={item} shimmer={shimmer} style={styles.skeletonStat} />)}
    </View>
    <SkeletonBlock shimmer={shimmer} style={styles.skeletonTitle} />
    {[1, 2, 3].map(item => <SkeletonBlock key={item} shimmer={shimmer} style={styles.skeletonRow} />)}
  </View>;
}

function Splash({ label = "Loading Jixels Agents" }) {
  return <View style={styles.splash}>
    <StatusBar style="light" />
    <View style={styles.splashCard}>
      <Image source={require("./assets/jixels-logo.png")} resizeMode="contain" style={styles.splashLogo} />
      <ActivityIndicator color={colors.white} size="large" />
      <Text style={styles.splashTitle}>{label}</Text>
      <Text style={styles.splashText}>Preparing field records, KYC checks, tracker installs, payments and alerts.</Text>
    </View>
  </View>;
}

function AgentLaunch({ name, returning = false, waiting = false, onComplete }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const vehicle = useRef(new Animated.Value(0)).current;
  const dots = useRef(new Animated.Value(0)).current;
  const [seconds, setSeconds] = useState(GPS_LAUNCH_SECONDS);

  useEffect(() => {
    const pulseLoop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }));
    const vehicleLoop = Animated.loop(Animated.sequence([
      Animated.timing(vehicle, { toValue: 1, duration: 1800, useNativeDriver: true }),
      Animated.timing(vehicle, { toValue: 0, duration: 1800, useNativeDriver: true })
    ]));
    const dotLoop = Animated.loop(Animated.timing(dots, { toValue: 3, duration: 1200, useNativeDriver: true }));
    pulseLoop.start();
    vehicleLoop.start();
    dotLoop.start();
    const countdown = waiting ? null : setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    const timer = waiting ? null : setTimeout(onComplete, GPS_LAUNCH_SECONDS * 1000);
    return () => {
      pulseLoop.stop();
      vehicleLoop.stop();
      dotLoop.stop();
      if (countdown) clearInterval(countdown);
      if (timer) clearTimeout(timer);
    };
  }, [dots, onComplete, pulse, vehicle]);

  const dotStyle = index => {
    const center = .25 + index;
    return {
      opacity: dots.interpolate({ inputRange: [0, center - .2, center, center + .45, 3], outputRange: [.25, .25, 1, .25, .25], extrapolate: "clamp" }),
      transform: [{ translateY: dots.interpolate({ inputRange: [0, center - .2, center, center + .45, 3], outputRange: [0, 0, -6, 0, 0], extrapolate: "clamp" }) }]
    };
  };

  return <View style={styles.agentLaunch}>
    <StatusBar style="light" />
    <View style={styles.agentLaunchActivity}>
      <View style={styles.agentLaunchStage}>
        <Animated.View style={[styles.agentLaunchRing, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.65, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [.7, 1.55] }) }] }]} />
        <View style={styles.agentLaunchCore}><Ionicons name="location" size={42} color={colors.white} /></View>
        <View style={styles.agentLaunchRoad} />
        <Animated.View style={[styles.agentLaunchVehicle, styles.agentLaunchCar, { transform: [{ translateX: vehicle.interpolate({ inputRange: [0, 1], outputRange: [-70, 180] }) }] }]}><Ionicons name="car-sport" size={25} color={colors.white} /></Animated.View>
        <Animated.View style={[styles.agentLaunchVehicle, styles.agentLaunchBike, { transform: [{ translateX: vehicle.interpolate({ inputRange: [0, 1], outputRange: [135, -135] }) }] }]}><MaterialCommunityIcons name="motorbike" size={27} color={colors.white} /></Animated.View>
        <Animated.View style={[styles.agentLaunchVehicle, styles.agentLaunchTukTuk, { transform: [{ translateX: vehicle.interpolate({ inputRange: [0, 1], outputRange: [-180, 70] }) }] }]}><MaterialCommunityIcons name="rickshaw" size={25} color={colors.white} /></Animated.View>
      </View>
      <Text style={styles.agentLaunchWelcome}>{returning ? "Welcome back" : "Welcome"}, {name || "Agent"}</Text>
      <Text style={styles.agentLaunchTitle}>Connecting to agent workspace</Text>
      <Text style={styles.agentLaunchText}>{waiting ? "Checking your approved account and preparing secure field access." : `Please wait while we securely prepare your field records. You will be redirected to the app in ${seconds} second${seconds === 1 ? "" : "s"}.`}</Text>
      <View style={styles.agentLaunchDots}>{[0, 1, 2].map(index => <Animated.View key={index} style={[styles.agentLaunchDot, dotStyle(index)]} />)}</View>
    </View>
  </View>;
}

function LaunchSkeleton({ onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 850);
    return () => clearTimeout(timer);
  }, [onComplete]);
  return <View style={styles.appSkeletonPage}>
    <StatusBar style="light" />
    <ActivitySkeleton screen="dashboard" />
  </View>;
}

function agentAccessMessage(error) {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : "Check your connection and try again.";
  if (error.code === "ACCOUNT_PENDING_APPROVAL") return "Your registration was received and is waiting for administrator approval. You cannot access the agent workspace until Admin approves it.";
  if (error.code === "ACCOUNT_INACTIVE") return "This agent account is unavailable. Contact Jixels Admin before trying to sign in again.";
  if (error.code === "PORTAL_ACCESS_DENIED") return "This account does not have permission to use the Agent app. Register an agent account or contact Jixels Admin.";
  if (error.code === "PROFILE_UNAVAILABLE") return "Your account exists but is still being prepared. Wait a moment, then try again. If this continues, contact Jixels Admin.";
  if (error.code === "INVALID_CREDENTIALS") return "No active agent account was found with these details, or the password is incorrect. Use Register only if you have not created an agent account yet.";
  return error.message || "Check your connection and try again.";
}

function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const cleanEmail = email.trim().toLowerCase();
    if (resettingPassword) {
      if (!cleanEmail.includes("@")) return Alert.alert("Enter your email", "Enter the email address registered to your agent account.");
      setBusy(true);
      try {
        await authApi.requestPasswordReset(cleanEmail);
        setBusy(false);
        setResettingPassword(false);
        Alert.alert("Request received", "If the email belongs to an approved agent account, reset instructions will be sent by Jixels admin.");
      } catch (error) {
        setBusy(false);
        Alert.alert("Reset unavailable", error instanceof ApiError || error instanceof Error ? error.message : "Check your connection and try again.");
      }
      return;
    }
    if (mode === "register") {
      if (!name.trim() || !cleanEmail || !phone.trim() || !password.trim()) return Alert.alert("Missing details", "Complete your name, email, phone and password.");
      if (!cleanEmail.includes("@")) return Alert.alert("Check email", "Enter a valid agent email address.");
      if (password.length < 8) return Alert.alert("Password too short", "Use at least 8 characters.");
      if (password !== confirm) return Alert.alert("Check password", "Passwords do not match.");
      setBusy(true);
      try {
        await authApi.register({ name: name.trim(), email: cleanEmail, phone: phone.trim(), password });
        setBusy(false);
        setMode("login");
        Alert.alert("Registration received", "Your agent account is pending. It now appears in Admin under Staff Accounts. Jixels Admin must approve it before you can sign in.");
      } catch (error) {
        setBusy(false);
        Alert.alert("Registration unavailable", error instanceof ApiError || error instanceof Error ? error.message : "Check your connection and try again.");
      }
      return;
    }
    if (!cleanEmail || !password.trim()) return Alert.alert("Missing details", "Enter your agent email and password.");
    if (!cleanEmail.includes("@")) return Alert.alert("Check email", "Enter a valid agent email address.");
    if (password.length < 8) return Alert.alert("Password too short", "Use at least 8 characters.");
    setBusy(true);
    try {
      const session = await authApi.login(cleanEmail, password);
      setBusy(false);
      onLogin({ ...normalizeAgentSession(session, cleanEmail), loginPassword: password });
    } catch (error) {
      setBusy(false);
      Alert.alert("Agent access unavailable", agentAccessMessage(error));
    }
  }

  if (busy && mode === "login" && !resettingPassword) return <AgentLaunch name={name} returning waiting onComplete={() => {}} />;

  return <KeyboardAvoidingView
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
    style={styles.auth}
  >
    <StatusBar style="light" />
    <View style={styles.authHero}>
      <Image source={require("./assets/jixels-logo.png")} resizeMode="contain" style={styles.authLogo} />
      <Text style={styles.authTitle}>Jixels Agent Trackings</Text>
      <Text style={styles.authText}>{resettingPassword ? "Enter your approved agent email and Jixels admin will send secure recovery instructions." : mode === "login" ? "Sign in to manage customer onboarding, tracker installation, KYC checks and payment follow-up." : "Create an agent profile for review before field access is opened."}</Text>
    </View>
    <View style={styles.authCard}>
      <Text style={styles.eyebrow}>AGENT APP</Text>
      <Text style={styles.cardTitle}>{resettingPassword ? "Reset password" : mode === "login" ? "Welcome back" : "Register agent"}</Text>
      {!resettingPassword && <View style={styles.authTabs}>
        <Pressable onPress={() => setMode("login")} style={[styles.authTab, mode === "login" && styles.authTabActive]}><Text style={[styles.authTabText, mode === "login" && styles.authTabTextActive]}>Login</Text></Pressable>
        <Pressable onPress={() => setMode("register")} style={[styles.authTab, mode === "register" && styles.authTabActive]}><Text style={[styles.authTabText, mode === "register" && styles.authTabTextActive]}>Register</Text></Pressable>
      </View>}
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.authForm}>
        {resettingPassword ? <>
          <View style={styles.resetIcon}><Ionicons name="key-outline" color={colors.blue} size={26} /></View>
          <Text style={styles.resetCopy}>Recovery is handled through approved Jixels admin records.</Text>
          <Field label="Registered email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
        </> : <>
          {mode === "register" && <Field label="Full name" value={name} onChangeText={setName} />}
          <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
          {mode === "register" && <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />}
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {mode === "register" && <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />}
          {mode === "login" && <Pressable onPress={() => setResettingPassword(true)}><Text style={styles.forgotText}>Forgot password?</Text></Pressable>}
        </>}
        <Pressable onPress={submit} disabled={busy} style={styles.primaryButton}>
          {busy ? <ActivityIndicator color={colors.white} /> : <>
            <Text style={styles.primaryText}>{resettingPassword ? "Send reset instructions" : mode === "login" ? "Sign in securely" : "Submit registration"}</Text>
            <Ionicons name={resettingPassword ? "mail-outline" : "arrow-forward"} color={colors.white} size={18} />
          </>}
        </Pressable>
        {resettingPassword && <Pressable onPress={() => setResettingPassword(false)} style={styles.backToLogin}>
          <Ionicons name="arrow-back" color={colors.blue} size={16} />
          <Text style={styles.backToLoginText}>Back to login</Text>
        </Pressable>}
      </ScrollView>
    </View>
  </KeyboardAvoidingView>;
}

function Drawer({ active, unread, onSelect, onLogout, onClose }) {
  return <View style={styles.drawer}>
    <View style={styles.drawerTop}>
      <Pressable accessibilityLabel="Close menu" onPress={onClose} style={styles.drawerToggle}>
        <Ionicons name="menu" size={23} color={colors.white} />
      </Pressable>
      <Image source={require("./assets/jixels-logo.png")} resizeMode="contain" style={styles.drawerLogo} />
    </View>
    <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerMenu} showsVerticalScrollIndicator={false}>
      {allScreens.map(item => <Pressable accessibilityLabel={item.label} android_ripple={{ color: "rgba(255,255,255,.14)" }} key={item.key} onPress={() => onSelect(item.key)} style={[styles.drawerItem, active === item.key && styles.drawerItemActive]}>
        <View>
          <Ionicons name={item.icon} color={active === item.key ? colors.white : "#AFC6E0"} size={22} />
          {item.key === "alerts" && unread > 0 && <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{unread}</Text></View>}
        </View>
        <Text numberOfLines={1} style={[styles.drawerLabel, active === item.key && styles.drawerLabelActive]}>{item.label}</Text>
      </Pressable>)}
    </ScrollView>
    <Pressable accessibilityLabel="Sign out" android_ripple={{ color: "rgba(249,168,168,.14)" }} onPress={onLogout} style={styles.drawerLogout}>
      <Ionicons name="log-out-outline" color="#F9A8A8" size={22} />
      <Text style={styles.drawerLogoutText}>Sign out</Text>
    </Pressable>
  </View>;
}

function PageHeader({ title, subtitle, unread, expanded, onToggle, onAlerts, darkMode = false }) {
  return <View style={[styles.pageHeader, darkMode && styles.darkHeader]}>
    <Pressable accessibilityLabel={expanded ? "Close menu" : "Open menu"} android_ripple={{ color: "rgba(9,105,218,.14)", borderless: true }} onPress={() => { tap(); onToggle(); }} style={styles.headerMenu}>
      <Ionicons name="menu" color={colors.blueDark} size={23} />
    </Pressable>
    <View style={styles.headerTitleWrap}>
      <Text numberOfLines={1} style={[styles.pageTitle, darkMode && styles.darkText]}>{title}</Text>
      <Text numberOfLines={1} style={styles.pageSubtitle}>{subtitle}</Text>
    </View>
    <Pressable accessibilityLabel="Open alerts" android_ripple={{ color: "rgba(9,105,218,.14)", borderless: true }} onPress={() => { tap(); onAlerts(); }} style={styles.headerBell}>
      <Ionicons name="notifications-outline" color={colors.blueDark} size={21} />
      {unread > 0 && <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{unread}</Text></View>}
    </Pressable>
  </View>;
}

function Header({ title, subtitle, agent, isOnline, onRefresh }) {
  return <View style={styles.header}>
    <View style={styles.avatar}><Text style={styles.avatarText}>{agent.name.slice(0, 2).toUpperCase()}</Text></View>
    <View style={styles.headerTitle}>
      <Text numberOfLines={1} style={styles.headerName}>{title}</Text>
      <Text numberOfLines={1} style={styles.headerSub}>{subtitle}</Text>
    </View>
    <Pressable onPress={onRefresh} style={styles.headerButton}>
      <Ionicons name={isOnline ? "cloud-done-outline" : "cloud-offline-outline"} color={isOnline ? colors.green : colors.orange} size={22} />
    </Pressable>
  </View>;
}

function StatGrid({ stats, compact, darkMode = false }) {
  return <View style={styles.statGrid}>
    {stats.map(item => <View key={item.label} style={[styles.statCard, compact && styles.statCardCompact, darkMode && styles.darkCard]}>
      <View style={styles.statIcon}>{item.icon}</View>
      <Text style={[styles.statValue, darkMode && styles.darkText]}>{item.value}</Text>
      <Text style={styles.statLabel}>{item.label}</Text>
    </View>)}
  </View>;
}

function QuickMenu({ active, navigate }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickMenu}>
    {[...screens, ...moreScreens].map(item => <Pressable key={item.key} onPress={() => { tap(); navigate(item.key); }} style={[styles.quickChip, active === item.key && styles.quickChipActive]}>
      <Ionicons name={item.icon} color={active === item.key ? colors.white : colors.blueDark} size={16} />
      <Text style={[styles.quickText, active === item.key && styles.quickTextActive]}>{item.label}</Text>
    </Pressable>)}
  </ScrollView>;
}

function Dashboard({ customers, navigate, isOnline, compact, onRefresh, refreshing, darkMode = false }) {
  const paid = customers.filter(c => c.payment === "Paid");
  const pendingInstall = customers.filter(c => c.install !== "Complete").length;
  const soldTrackers = customers.filter(customer => Boolean(customer.vehicleId) && customer.tracker !== "Pending").length;
  const alerts = customers.filter(c => c.payment !== "Paid" || c.install !== "Complete").length;
  const selectedOperation = pendingInstall > 0 ? {
    title: "Install tracker",
    subtitle: `${pendingInstall} customer${pendingInstall === 1 ? "" : "s"} waiting for installation`,
    icon: "radio",
    color: colors.green,
    onPress: () => navigate("trackers")
  } : {
    title: "New customer",
    subtitle: "Create KYC, bike and tracker records",
    icon: "person-add",
    color: colors.blue,
    onPress: () => navigate("onboard")
  };
  const stats = [
    { label: "Customers", value: customers.length, icon: <Ionicons name="people" color={colors.blue} size={22} /> },
    { label: "Sold trackers", value: soldTrackers, icon: <MaterialCommunityIcons name="tag-check-outline" color={colors.orange} size={22} /> },
    { label: "Commissions earned", value: money(paid.reduce((sum, c) => sum + (c.commission || 0), 0)), icon: <Ionicons name="wallet" color={colors.green} size={22} /> },
    { label: "Alerts", value: alerts, icon: <Ionicons name="notifications" color={colors.red} size={22} /> }
  ];
  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)}>
    <View style={styles.hero}>
      <View style={styles.heroIcon}><MaterialCommunityIcons name="motorbike" color={colors.white} size={32} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.heroSmall}>JIXELS AGENT APP</Text>
        <Text style={styles.heroTitle}>Field operations in one secure workspace.</Text>
        <Text style={styles.heroText}>Onboard customers, capture KYC, install trackers and follow payments with clear daily records.</Text>
      </View>
    </View>
    <StatGrid stats={stats} compact={compact} darkMode={darkMode} />
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Select operations</Text>
      <Pressable onPress={() => navigate("customers")}><Text style={styles.sectionAction}>Customers</Text></Pressable>
    </View>
    <View style={[styles.selectedOperationCard, darkMode && styles.darkCard]}>
      <View style={styles.selectedOperationTop}>
        <View style={[styles.selectedOperationIcon, { backgroundColor: `${selectedOperation.color}16` }]}>
          <Ionicons name={selectedOperation.icon} color={selectedOperation.color} size={24} />
        </View>
        <View style={styles.listBody}>
          <Text style={[styles.selectedOperationTitle, darkMode && styles.darkText]}>{selectedOperation.title}</Text>
          <Text style={styles.selectedOperationSub}>{selectedOperation.subtitle}</Text>
        </View>
        <Pill value={isOnline ? "Online" : "Pending"} />
      </View>
      <View style={styles.operationCardActions}>
        <Pressable onPress={() => navigate("onboard")} style={styles.outlineAction}><Ionicons name="person-add-outline" color={colors.blue} size={18} /><Text style={styles.outlineActionText}>New customer</Text></Pressable>
        <Pressable onPress={() => navigate("trackers")} style={styles.primaryAction}><Ionicons name="radio-outline" color={colors.white} size={18} /><Text style={styles.primaryActionText}>Install tracker</Text></Pressable>
      </View>
    </View>
  </ScrollView>;
}

function Customers({ customers, onDeposit, onRefresh, refreshing, darkMode = false }) {
  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)}>
    <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Customer records</Text>
    {customers.length === 0 && <View style={[styles.empty, darkMode && styles.darkCard]}><Ionicons name="people-outline" color={colors.blue} size={42} /><Text style={[styles.emptyText, darkMode && styles.darkText]}>No customers yet</Text><Text style={styles.emptySub}>Use New customer to create the first field record.</Text></View>}
    {customers.map(customer => <View key={customer.id} style={[styles.listCard, darkMode && styles.darkCard]}>
      <View style={styles.listIcon}><Ionicons name="person" color={colors.blue} size={20} /></View>
      <View style={styles.listBody}>
        <Text numberOfLines={1} style={[styles.listTitle, darkMode && styles.darkText]}>{customer.name}</Text>
        <Text style={styles.listSub}>{customer.phone} • {customer.bike}</Text>
        <Text style={styles.listMeta}>{customer.location} • Balance {money(customerBalance(customer))} • Sale {customerSaleStatus(customer)}</Text>
      </View>
      <View style={styles.listStatus}>
        <Pill value={customer.payment} />
        {!customerPaymentComplete(customer) && <Pressable onPress={() => onDeposit(customer.id)} style={styles.depositButton}><Text style={styles.depositButtonText}>Prompt deposit</Text></Pressable>}
        <Text style={styles.smallMeta}>{customer.id}</Text>
      </View>
    </View>)}
  </ScrollView>;
}

function Onboarding({ addCustomer, navigate, assignedVehicles, accessToken, onRefresh, refreshing, darkMode = false }) {
  const [form, setForm] = useState({ name: "", phone: "", idNumber: "", location: "", depositAmount: "" });
  const [selectedVehicleId, setSelectedVehicleId] = useState(assignedVehicles[0]?.id || "");
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [idFrontPhoto, setIdFrontPhoto] = useState(null);
  const [idBackPhoto, setIdBackPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const selectedVehicle = assignedVehicles.find(vehicle => vehicle.id === selectedVehicleId) || assignedVehicles[0];
  const matchingVehicles = assignedVehicles.filter(vehicle => `${vehicle.registration} ${vehicle.model} ${vehicle.tracker}`.toLowerCase().includes(vehicleSearch.trim().toLowerCase()));

  async function captureImage(setImage, label) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert("Camera permission", `Allow camera access to capture ${label}.`);
    const result = await ImagePicker.launchCameraAsync({ quality: 0.55, allowsEditing: false });
    if (!result.canceled) setImage(result.assets[0].uri);
  }

  async function save() {
    if (!form.name.trim() || !form.phone.trim() || !form.idNumber.trim()) return Alert.alert("Missing details", "Enter the customer name, phone number, and national ID once.");
    if (!selectedVehicle) return Alert.alert("No assigned bike", "Only bikes assigned to this agent can be sold. Ask admin to assign inventory first.");
    if (!idFrontPhoto || !idBackPhoto) return Alert.alert("Capture ID", "Capture and save both the front and back side of the customer ID.");
    const depositAmount = Number(form.depositAmount);
    if (!Number.isFinite(depositAmount) || depositAmount < 0) return Alert.alert("Check deposit", "Enter a valid deposit amount, or use 0 if no deposit was collected.");
    if (selectedVehicle.payableAmount > 0 && depositAmount > selectedVehicle.payableAmount) return Alert.alert("Check deposit", "The deposit cannot be higher than the total payable amount.");
    setSaving(true);
    try {
      const result = await authApi.onboardCustomer(accessToken, { name: form.name.trim(), phone: form.phone.trim(), nationalId: form.idNumber.trim(), location: form.location.trim(), bikeId: selectedVehicle.id, depositAmount });
      addCustomer(result.customer);
      Alert.alert("Customer registration received", "The customer now appears in Admin and Finance as pending. An administrator must approve the screening before account access is available.");
      navigate("customers");
    } catch (error) {
      Alert.alert("Customer registration unavailable", error instanceof Error ? error.message : "Check your connection and try again.");
    } finally { setSaving(false); }
  }

  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)} keyboardShouldPersistTaps="handled">
    <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Customer onboarding</Text>
    <View style={[styles.formCard, darkMode && styles.darkCard]}>
      <Field label="Full name" value={form.name} onChangeText={name => setForm({ ...form, name })} />
      <Field label="Phone number" value={form.phone} onChangeText={phone => setForm({ ...form, phone })} keyboardType="phone-pad" />
      <Field label="National ID or passport (enter once)" value={form.idNumber} onChangeText={idNumber => setForm({ ...form, idNumber })} />
      <Field label="Location" value={form.location} onChangeText={location => setForm({ ...form, location })} />
      <Text style={styles.fieldLabel}>Assigned bike to sell</Text>
      <View style={styles.reportBikePicker}>
        <Pressable onPress={() => setVehiclePickerOpen(open => !open)} style={[styles.reportBikePickerButton, darkMode && styles.darkInput]}>
          <View style={styles.vehicleDropdownIcon}><MaterialCommunityIcons name="motorbike" size={20} color={colors.blue} /></View>
          <View style={styles.listBody}><Text style={[styles.vehicleDropdownPlate, darkMode && styles.darkText]}>{selectedVehicle?.registration || "No bike assigned"}</Text><Text style={styles.vehicleDropdownModel}>{selectedVehicle ? `${selectedVehicle.model} • Tracker ${selectedVehicle.tracker}` : "Admin must assign a bike to this agent"}</Text></View>
          <Ionicons name={vehiclePickerOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </Pressable>
        {vehiclePickerOpen && <View style={[styles.reportBikeDropdown, darkMode && styles.darkCard]}>
          <View style={[styles.reportBikeSearch, darkMode && styles.darkInput]}><Ionicons name="search" size={18} color={colors.muted} /><TextInput value={vehicleSearch} onChangeText={setVehicleSearch} placeholder="Search assigned bike or tracker" placeholderTextColor="#94A3B8" autoCapitalize="characters" style={[styles.reportBikeSearchInput, darkMode && styles.darkText]} /></View>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.reportBikeList} showsVerticalScrollIndicator>{matchingVehicles.map(vehicle => <Pressable key={vehicle.id} onPress={() => { setSelectedVehicleId(vehicle.id); setVehiclePickerOpen(false); setVehicleSearch(""); }} style={[styles.reportBikeOption, selectedVehicle?.id === vehicle.id && styles.reportBikeOptionActive]}><View style={styles.vehicleDropdownIcon}><MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} /></View><View style={styles.listBody}><Text style={[styles.vehicleDropdownPlate, darkMode && styles.darkText]}>{vehicle.registration}</Text><Text style={styles.vehicleDropdownModel}>{vehicle.model} • Payable {money(vehicle.payableAmount)}</Text></View>{selectedVehicle?.id === vehicle.id && <Ionicons name="checkmark-circle" size={20} color={colors.blue} />}</Pressable>)}{matchingVehicles.length === 0 && <Text style={styles.noVehicleText}>No assigned bike matches your search.</Text>}</ScrollView>
        </View>}
      </View>
      {selectedVehicle && <View style={styles.agreedPaymentNote}><Text style={styles.microLabel}>TOTAL PAYABLE</Text><Text style={styles.agreedPaymentValue}>{money(selectedVehicle.payableAmount)}</Text></View>}
      <Field label="Deposit amount to prompt" value={form.depositAmount} onChangeText={depositAmount => setForm({ ...form, depositAmount })} keyboardType="numeric" />
      <View style={styles.captureRow}>
        <Pressable onPress={() => captureImage(setIdFrontPhoto, "National ID front")} style={styles.secondaryButton}><Ionicons name="scan-outline" color={colors.blue} size={18} /><Text style={styles.secondaryText}>{idFrontPhoto ? "Rescan ID front" : "Scan ID front"}</Text></Pressable>
        <Pressable onPress={() => captureImage(setIdBackPhoto, "National ID back")} style={styles.secondaryButton}><Ionicons name="scan-outline" color={colors.blue} size={18} /><Text style={styles.secondaryText}>{idBackPhoto ? "Rescan ID back" : "Scan ID back"}</Text></Pressable>
      </View>
      <View style={styles.documentGrid}>
        {idFrontPhoto && <Image source={{ uri: idFrontPhoto }} style={styles.documentPreview} />}
        {idBackPhoto && <Image source={{ uri: idBackPhoto }} style={styles.documentPreview} />}
      </View>
      <Pressable disabled={saving} onPress={save} style={styles.primaryButton}>{saving ? <ActivityIndicator color={colors.white} /> : <><Text style={styles.primaryText}>Submit customer registration</Text><Ionicons name="checkmark" color={colors.white} size={18} /></>}</Pressable>
    </View>
  </ScrollView>;
}

function Trackers({ customers, onInstallComplete, onRefresh, refreshing, darkMode = false }) {
  const installCustomers = customers.filter(customer => customer.install !== "Complete");
  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)}>
    <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Tracker installation</Text>
    {trackerStock.length === 0 && <View style={[styles.empty, darkMode && styles.darkCard]}><Ionicons name="radio-outline" color={colors.blue} size={42} /><Text style={[styles.emptyText, darkMode && styles.darkText]}>No tracker stock loaded</Text><Text style={styles.emptySub}>Add a customer with a tracker ID to start installation records.</Text></View>}
    {trackerStock.map(tracker => <View key={tracker.id} style={[styles.listCard, darkMode && styles.darkCard]}>
      <View style={styles.listIcon}><Ionicons name="radio" color={colors.blue} size={20} /></View>
      <View style={styles.listBody}>
        <Text style={styles.listTitle}>{tracker.id}</Text>
        <Text style={styles.listSub}>IMEI {tracker.imei}</Text>
        <Text style={styles.listMeta}>{customers.find(c => c.tracker === tracker.id)?.name || "No customer attached"}</Text>
      </View>
      <View style={styles.listStatus}><Pill value={tracker.signal} /><Pill value={tracker.status} /></View>
    </View>)}
    <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Customer installs</Text>
    {installCustomers.length === 0 && <View style={[styles.empty, darkMode && styles.darkCard]}><Ionicons name="checkmark-circle-outline" color={colors.green} size={42} /><Text style={[styles.emptyText, darkMode && styles.darkText]}>No assigned installs pending</Text><Text style={styles.emptySub}>Sold bikes assigned to this agent will appear here until installation is complete.</Text></View>}
    {customers.map(customer => <View key={`${customer.id}-install`} style={[styles.installRow, darkMode && styles.darkCard]}>
      <Text style={[styles.installName, darkMode && styles.darkText]}>{customer.bike}</Text>
      <Text style={styles.installSub}>{customer.name} • {customer.tracker} • Sale {customerSaleStatus(customer)}</Text>
      <View style={styles.installActions}>
        <Pill value={customer.install} />
        {customer.install !== "Complete" && <Pressable onPress={() => onInstallComplete(customer.id)} style={styles.miniButton}><Text style={styles.miniButtonText}>Mark installed</Text></Pressable>}
      </View>
    </View>)}
  </ScrollView>;
}

function Commissions({ customers, onRefresh, refreshing, darkMode = false }) {
  const totalCommission = customers.reduce((sum, customer) => sum + Number(customer.commission || 0), 0);
  const confirmedSales = customers.filter(customerPaymentComplete);
  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)}>
    <View style={[styles.summaryCard, darkMode && styles.darkCard]}>
      <View>
        <Text style={styles.reportLabelDark}>TOTAL COMMISSION</Text>
        <Text style={[styles.summaryValue, darkMode && styles.darkText]}>{money(totalCommission)}</Text>
        <Text style={styles.summaryMeta}>{confirmedSales.length} customer sale{confirmedSales.length === 1 ? "" : "s"} with confirmed deposits</Text>
      </View>
      <View style={styles.summaryIcon}><Ionicons name="cash" color={colors.white} size={24} /></View>
    </View>
    <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Customer commission awards</Text>
    {customers.length === 0 && <View style={[styles.empty, darkMode && styles.darkCard]}><Ionicons name="cash-outline" color={colors.blue} size={42} /><Text style={[styles.emptyText, darkMode && styles.darkText]}>No commissions yet</Text><Text style={styles.emptySub}>Commission records appear after an assigned bike sale receives a confirmed deposit.</Text></View>}
    {customers.map(customer => {
      const balance = customerBalance(customer);
      return <View key={`${customer.id}-pay`} style={[styles.listCard, darkMode && styles.darkCard]}>
      <View style={styles.listIcon}><Ionicons name="cash" color={colors.green} size={20} /></View>
      <View style={styles.listBody}>
        <Text style={[styles.listTitle, darkMode && styles.darkText]}>{customer.name}</Text>
        <Text style={styles.listSub}>{customer.bike} • Payable {money(customer.payableAmount)} • Deposit {money(customer.amount)}</Text>
        <Text style={styles.listMeta}>Commission {money(customer.commission)} • Balance {money(balance)} • {customer.receipt || "Waiting for M-Pesa callback"}</Text>
      </View>
      <View style={styles.listStatus}>
        <Pill value={customer.commission > 0 ? "Earned" : "Pending"} />
      </View>
    </View>;
    })}
  </ScrollView>;
}

function Reports({ customers, profile, onRefresh, refreshing, darkMode = false }) {
  const [routeDate, setRouteDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportPeriod, setReportPeriod] = useState("daily");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [password, setPassword] = useState("");
  const [passwordAttempts, setPasswordAttempts] = useState(0);
  const [reportAccessBlocked, setReportAccessBlocked] = useState(false);
  const [passwordPromptVisible, setPasswordPromptVisible] = useState(false);
  const selectedCustomer = customers.find(customer => customer.id === selectedCustomerId) || customers[0];
  const matchingCustomers = customers.filter(customer => `${customer.name} ${customer.bike} ${customer.tracker}`.toLowerCase().includes(customerSearch.trim().toLowerCase()));
  function downloadReport() {
    if (!selectedCustomer) return Alert.alert("Choose customer", "Select a customer before downloading the report.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) return Alert.alert("Check date", "Enter the route date as YYYY-MM-DD.");
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setReport({ name: `jixels-agent-${reportPeriod}-route-report-${selectedCustomer.bike.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${routeDate}.pdf` });
    }, 700);
  }
  async function openReport() {
    if (reportAccessBlocked) return Alert.alert("Account blocked", "Report access is blocked after too many wrong password attempts. Contact admin.");
    setPassword("");
    setPasswordPromptVisible(true);
  }
  async function verifyReportPassword() {
    if (!profile?.loginPassword) return Alert.alert("Password check unavailable", "Sign in again before opening protected reports.");
    if (password === profile.loginPassword) {
      setPasswordAttempts(0);
      setPasswordPromptVisible(false);
      if (report?.uri) await Linking.openURL(report.uri);
      else Alert.alert("Report opened", report?.name || "Agent route report");
      return;
    }
    const nextAttempts = passwordAttempts + 1;
    setPasswordAttempts(nextAttempts);
    setPassword("");
    if (nextAttempts >= 4) {
      setReportAccessBlocked(true);
      setPasswordPromptVisible(false);
      Alert.alert("Account blocked", "Report access is blocked after the fourth wrong password attempt.");
      return;
    }
    Alert.alert("Wrong password", `${Math.max(0, 4 - nextAttempts)} report access attempt${4 - nextAttempts === 1 ? "" : "s"} remaining.`);
  }
  return <>
  <ScrollView style={[styles.pageScroll, darkMode && styles.darkPage]} contentContainerStyle={styles.pageContent} refreshControl={pullRefresh(onRefresh, refreshing)} keyboardShouldPersistTaps="handled">
    <View style={styles.reportHero}>
      <View style={styles.reportHeroIcon}><Ionicons name="map" size={31} color={colors.white} /></View>
      <Text style={styles.reportHeroTitle}>Route report</Text>
      <Text style={styles.reportHeroText}>Download where the selected customer vehicle travelled on a chosen day, including route points, distance, stops and the last recorded position.</Text>
    </View>
    <View style={[styles.settingsSection, darkMode && styles.darkCard]}>
      <Text style={[styles.settingsTitle, darkMode && styles.darkText]}>Customer and travel date</Text>
      <Text style={styles.fieldLabel}>Choose customer</Text>
      <View style={styles.reportBikePicker}>
        <Pressable onPress={() => setCustomerPickerOpen(open => !open)} style={[styles.reportBikePickerButton, darkMode && styles.darkInput]}>
          <View style={styles.vehicleDropdownIcon}><MaterialCommunityIcons name="motorbike" size={20} color={colors.blue} /></View>
          <View style={styles.listBody}><Text style={[styles.vehicleDropdownPlate, darkMode && styles.darkText]}>{selectedCustomer?.bike || "No customer"}</Text><Text style={styles.vehicleDropdownModel}>{selectedCustomer ? `${selectedCustomer.name} • Tracker ${selectedCustomer.tracker}` : "Add a customer first"}</Text></View>
          <Ionicons name={customerPickerOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </Pressable>
        {customerPickerOpen && <View style={[styles.reportBikeDropdown, darkMode && styles.darkCard]}>
          <View style={[styles.reportBikeSearch, darkMode && styles.darkInput]}><Ionicons name="search" size={18} color={colors.muted} /><TextInput value={customerSearch} onChangeText={setCustomerSearch} placeholder="Search name, plate or tracker" placeholderTextColor="#94A3B8" autoCapitalize="characters" style={[styles.reportBikeSearchInput, darkMode && styles.darkText]} /></View>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.reportBikeList} showsVerticalScrollIndicator>{matchingCustomers.map(customer => <Pressable key={customer.id} onPress={() => { setSelectedCustomerId(customer.id); setCustomerPickerOpen(false); setCustomerSearch(""); }} style={[styles.reportBikeOption, selectedCustomer?.id === customer.id && styles.reportBikeOptionActive]}><View style={styles.vehicleDropdownIcon}><MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} /></View><View style={styles.listBody}><Text style={[styles.vehicleDropdownPlate, darkMode && styles.darkText]}>{customer.bike}</Text><Text style={styles.vehicleDropdownModel}>{customer.name} • Tracker {customer.tracker}</Text></View>{selectedCustomer?.id === customer.id && <Ionicons name="checkmark-circle" size={20} color={colors.blue} />}</Pressable>)}{matchingCustomers.length === 0 && <Text style={styles.noVehicleText}>No customer matches your search.</Text>}</ScrollView>
        </View>}
      </View>
      <Field label="Route date (YYYY-MM-DD)" value={routeDate} onChangeText={setRouteDate} placeholder="2026-08-24" />
      <Text style={styles.fieldLabel}>Report period</Text>
      <View style={styles.reportPeriods}>
        {reportPeriods.map(period => <Pressable key={period.key} onPress={() => setReportPeriod(period.key)} style={[styles.reportPeriod, reportPeriod === period.key && styles.reportPeriodActive, darkMode && styles.darkInput]}>
          <Ionicons name={period.icon} size={18} color={reportPeriod === period.key ? colors.blueDark : colors.muted} />
          <Text style={[styles.reportPeriodText, reportPeriod === period.key && styles.reportPeriodTextActive]}>{period.label}</Text>
        </Pressable>)}
      </View>
    </View>
    <View style={[styles.settingsSection, darkMode && styles.darkCard]}>
      <Text style={[styles.settingsTitle, darkMode && styles.darkText]}>Secure download</Text>
      <Text style={styles.settingsCopy}>The route PDF is protected and available only to the signed-in agent.</Text>
      <Pressable disabled={busy} onPress={downloadReport} style={styles.primaryButton}>{busy ? <ActivityIndicator color={colors.white} /> : <><Ionicons name="download-outline" color={colors.white} size={18} /><Text style={styles.primaryText}>Download route report</Text></>}</Pressable>
    </View>
  </ScrollView>
  <Modal visible={!!report} transparent animationType="fade" onRequestClose={() => setReport(null)}><View style={styles.successOverlay}><View style={styles.successCard}><View style={styles.successIcon}><Ionicons name="checkmark" size={44} color={colors.white} /></View><Text style={styles.successTitle}>Downloaded successfully</Text><Text style={styles.reportSuccessMessage}>Tap view and enter your login password to open the report.</Text><View style={styles.receiptBox}><Text style={styles.receiptLabel}>DOCUMENT</Text><Text style={styles.reportSuccessEmail}>{report?.name}</Text></View><Pressable onPress={openReport} style={styles.primaryButton}><Ionicons name="open-outline" size={18} color={colors.white} /><Text style={styles.primaryButtonText}>View document</Text></Pressable><Pressable onPress={() => setReport(null)} style={styles.approvalSecondary}><Text style={styles.backToLoginText}>Close</Text></Pressable></View></View></Modal>
  <Modal visible={passwordPromptVisible} transparent animationType="fade" onRequestClose={() => setPasswordPromptVisible(false)}><View style={styles.modalOverlay}><View style={styles.depositModal}><View style={styles.depositModalIcon}><Ionicons name="lock-closed-outline" size={26} color={colors.white} /></View><Text style={styles.depositModalTitle}>Confirm report access</Text><Text style={styles.depositModalText}>Enter the password you used to sign in. Three wrong tries are allowed; the fourth blocks report access.</Text><Field label="Login password" value={password} onChangeText={setPassword} secureTextEntry /><Pressable onPress={verifyReportPassword} style={styles.primaryButton}><Ionicons name="shield-checkmark-outline" size={18} color={colors.white} /><Text style={styles.primaryText}>Open protected report</Text></Pressable><Pressable onPress={() => setPasswordPromptVisible(false)} style={styles.modalCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable></View></View></Modal>
  </>;
}

function Alerts({ alerts, markAllRead, markAlertRead, deleteAlerts, onRefresh, refreshing, darkMode = false }) {
  const [selected, setSelected] = useState(new Set());
  const [activeAlert, setActiveAlert] = useState(null);
  const selecting = selected.size > 0;
  const toggleSelected = id => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const openAlert = alert => {
    if (selecting) return toggleSelected(alert.id);
    markAlertRead(alert.id);
    setActiveAlert(alert);
  };
  const removeSelected = () => {
    deleteAlerts([...selected]);
    setSelected(new Set());
  };
  return <>
    <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)}>
      <View style={styles.nativeListToolbar}>{selecting ? <><View><Text style={[styles.nativeListHeading, darkMode && styles.darkText]}>{selected.size} selected</Text><Text style={styles.nativeToolbarSub}>Tap notifications to add or remove</Text></View><View style={styles.selectionActions}><Pressable onPress={() => setSelected(new Set(alerts.map(alert => alert.id)))} style={styles.selectionButton}><Ionicons name="checkbox-outline" size={18} color={colors.blue} /><Text style={styles.markReadText}>All</Text></Pressable><Pressable onPress={removeSelected} style={[styles.selectionButton, styles.deleteButton]}><Ionicons name="trash-outline" size={18} color={colors.red} /><Text style={styles.deleteText}>Delete</Text></Pressable></View></> : <><View><Text style={[styles.nativeListHeading, darkMode && styles.darkText]}>Recent notifications</Text><Text style={styles.nativeToolbarSub}>Tap to read • Hold to select</Text></View><Pressable onPress={markAllRead} style={styles.markReadButton}><Ionicons name="checkmark-done" size={18} color={colors.blue} /><Text style={styles.markReadText}>Clear all</Text></Pressable></>}</View>
      {alerts.length === 0 ? <View style={[styles.empty, darkMode && styles.darkCard]}><Ionicons name="checkmark-circle" color={colors.green} size={42} /><Text style={[styles.emptyText, darkMode && styles.darkText]}>No active alerts</Text></View> : alerts.map(alert => {
        const isSelected = selected.has(alert.id);
        return <Pressable key={alert.id} onPress={() => openAlert(alert)} onLongPress={() => toggleSelected(alert.id)} style={[styles.nativeRow, darkMode && styles.darkCard, alert.unread && styles.nativeRowUnread, isSelected && styles.nativeRowSelected]}>
          {selecting && <View style={[styles.selectionCheck, isSelected && styles.selectionCheckActive]}>{isSelected && <Ionicons name="checkmark" color={colors.white} size={15} />}</View>}
          <View style={[styles.nativeAvatar, alert.type === "payment" && styles.nativeAvatarGreen, alert.type === "install" && styles.nativeAvatarOrange]}><Ionicons name={alert.icon} color={colors.white} size={21} /></View>
          <View style={styles.nativeRowBody}><View style={styles.nativeRowTop}><Text style={[styles.nativeRowTitle, darkMode && styles.darkText]}>{alert.title}</Text><Text style={styles.nativeRowTime}>{alert.age}</Text></View><Text style={styles.nativeRowMessage}>{alert.message}</Text>{alert.unread && <Text style={styles.nativeRowStatus}>Unread</Text>}</View>
          {alert.unread && !selecting && <View style={styles.nativeUnreadBadge}><Text style={styles.nativeUnreadText}>1</Text></View>}
        </Pressable>;
      })}
    </ScrollView>
    <Modal visible={!!activeAlert} transparent animationType="fade" onRequestClose={() => setActiveAlert(null)}><View style={styles.modalOverlay}><View style={styles.reportSuccessCard}><View style={[styles.depositModalIcon, { backgroundColor: activeAlert?.type === "payment" ? colors.green : activeAlert?.type === "install" ? colors.orange : colors.blue }]}><Ionicons name={activeAlert?.icon || "notifications-outline"} size={26} color={colors.white} /></View><Text style={styles.depositModalTitle}>{activeAlert?.title}</Text><Text style={styles.depositModalText}>{activeAlert?.message}</Text><View style={styles.receiptBox}><Text style={styles.reportLabelDark}>CUSTOMER</Text><Text style={styles.reportSuccessName}>{activeAlert?.customerName || "Agent notification"}</Text></View><Pressable onPress={() => setActiveAlert(null)} style={styles.primaryButton}><Text style={styles.primaryText}>Done</Text></Pressable></View></View></Modal>
  </>;
}

function Profile({ agent, onLogout, onRefresh, refreshing, darkMode = false }) {
  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)}>
    <View style={styles.profileHero}>
      <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{agent.name.slice(0, 2).toUpperCase()}</Text></View>
      <Text style={styles.profileName}>{agent.name}</Text>
      <Text style={styles.profileMeta}>{agent.role} • {agent.code}</Text>
    </View>
    <View style={[styles.formCard, darkMode && styles.darkCard]}>
      <Text style={[styles.infoLine, darkMode && styles.darkText]}>Email: {agent.email}</Text>
      <Text style={[styles.infoLine, darkMode && styles.darkText]}>Workspace: Customer onboarding and tracker installation</Text>
      <Text style={[styles.infoLine, darkMode && styles.darkText]}>Access: Approved field agent account</Text>
      <Text style={[styles.infoLine, darkMode && styles.darkText]}>Sync: Secure records, payments and alerts</Text>
      <Pressable onPress={onLogout} style={styles.logoutButton}><Ionicons name="log-out-outline" color={colors.red} size={18} /><Text style={styles.logoutText}>Logout</Text></Pressable>
    </View>
  </ScrollView>;
}

function Settings({ agent, onSave, onRefresh, refreshing, darkMode = false }) {
  const [name, setName] = useState(agent.name);
  const [phone, setPhone] = useState(agent.phone || "");
  const [themeMode, setThemeMode] = useState(agent.themeMode || "light");
  const [photoUri, setPhotoUri] = useState(agent.photoUri || null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const initials = (name || agent.email || "AG").slice(0, 2).toUpperCase();

  async function choosePhoto() {
    setPhotoBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert("Photo permission", "Allow photo access to update your agent profile.");
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.65, allowsEditing: true, aspect: [1, 1] });
      if (!result.canceled) setPhotoUri(result.assets[0].uri);
    } finally {
      setPhotoBusy(false);
    }
  }

  function save() {
    onSave({ ...agent, name: name.trim() || agent.name, phone: phone.trim(), themeMode, photoUri });
    Alert.alert("Settings saved", "Your agent profile settings were updated.");
  }

  function chooseTheme(nextTheme) {
    setThemeMode(nextTheme);
    onSave({ ...agent, name: name.trim() || agent.name, phone: phone.trim(), themeMode: nextTheme, photoUri });
  }

  return <ScrollView style={darkMode && styles.darkPage} contentContainerStyle={styles.page} refreshControl={pullRefresh(onRefresh, refreshing)} keyboardShouldPersistTaps="handled">
    <View style={styles.profileHeroLight}>
      <View style={styles.profileAvatar}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.profilePhoto} /> : <Text style={styles.profileAvatarText}>{initials}</Text>}</View>
      <View style={styles.photoActions}>
        <Pressable disabled={photoBusy} onPress={choosePhoto} style={styles.photoButton}>{photoBusy ? <ActivityIndicator color={colors.blue} size="small" /> : <Ionicons name="camera-outline" size={16} color={colors.blue} />}<Text style={styles.photoButtonText}>{photoUri ? "Change photo" : "Add photo"}</Text></Pressable>
        {photoUri && <Pressable onPress={() => setPhotoUri(null)} style={styles.removePhotoButton}><Text style={styles.removePhotoText}>Remove</Text></Pressable>}
      </View>
      <Text style={[styles.profileNameDark, darkMode && styles.darkText]}>{name || agent.name}</Text>
      <Text style={styles.profileId}>Agent ID • {agent.code || "Signed in"}</Text>
    </View>
    <View style={[styles.settingsSection, darkMode && styles.darkCard]}>
      <Text style={[styles.settingsTitle, darkMode && styles.darkText]}>Appearance</Text>
      <Text style={styles.settingsCopy}>Choose how the agent app looks on this device.</Text>
      <View style={styles.themeOptions}>{[["light", "sunny-outline", "Light"], ["dark", "moon-outline", "Dark"]].map(option => <Pressable key={option[0]} onPress={() => chooseTheme(option[0])} style={[styles.themeOption, themeMode === option[0] && styles.themeOptionActive]}><Ionicons name={option[1]} size={20} color={themeMode === option[0] ? colors.white : colors.blueDark} /><Text style={[styles.themeOptionText, themeMode === option[0] && styles.themeOptionTextActive]}>{option[2]}</Text></Pressable>)}</View>
    </View>
    <View style={[styles.settingsSection, darkMode && styles.darkCard]}>
      <Text style={[styles.settingsTitle, darkMode && styles.darkText]}>Profile details</Text>
      <Text style={styles.settingsCopy}>Update contact details used for field operations.</Text>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <View style={styles.readonlyField}><Ionicons name="mail-outline" size={18} color={colors.muted} /><View style={styles.listBody}><Text style={styles.microLabel}>EMAIL ADDRESS</Text><Text style={styles.profileValue}>{agent.email}</Text></View><Ionicons name="lock-closed" size={15} color={colors.muted} /></View>
      <Pressable onPress={save} style={styles.primaryButton}><Ionicons name="save-outline" size={18} color={colors.white} /><Text style={styles.primaryText}>Save settings</Text></Pressable>
    </View>
    <View style={styles.infoCallout}><Ionicons name="shield-checkmark" size={20} color={colors.green} /><Text style={styles.infoCalloutText}>Email and access changes require secure verification by Jixels admin.</Text></View>
  </ScrollView>;
}

function DepositPrompt({ customer, visible, onCancel, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    setAmount(customer?.amount ? String(customer.amount) : "");
    setPhone(customer?.phone || "");
  }, [customer]);

  function submit() {
    const depositAmount = Number(amount);
    if (!customer) return;
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) return Alert.alert("Deposit amount", "Enter a valid customer deposit amount.");
    if (customer.payableAmount > 0 && depositAmount > customer.payableAmount) return Alert.alert("Deposit amount", "The deposit cannot be higher than the total payable amount.");
    if (!phone.trim()) return Alert.alert("Phone number", "Enter the phone number to receive the STK push.");
    onSubmit(customer.id, depositAmount, phone.trim());
  }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={styles.modalOverlay}>
      <View style={styles.depositModal}>
        <View style={styles.depositModalIcon}><Ionicons name="phone-portrait-outline" size={26} color={colors.white} /></View>
        <Text style={styles.depositModalTitle}>Customer deposit</Text>
        <Text style={styles.depositModalText}>{customer ? `Send STK push to ${customer.name}. Deposit is deducted from ${money(customer.payableAmount)} total payable.` : "Send STK push to customer."}</Text>
        <Field label="Deposit amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />
        <Field label="Customer phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Pressable onPress={submit} style={styles.primaryButton}><Ionicons name="paper-plane-outline" size={18} color={colors.white} /><Text style={styles.primaryText}>Send STK push</Text></Pressable>
        <Pressable onPress={onCancel} style={styles.modalCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

function BottomNav({ active, navigate }) {
  return <View style={styles.bottomNav}>
    {screens.map(item => <Pressable accessibilityLabel={item.label} key={item.key} onPress={() => navigate(item.key)} style={[styles.navItem, active === item.key && styles.navActive]}>
      <Ionicons name={item.icon} color={active === item.key ? colors.white : colors.muted} size={21} />
      <Text numberOfLines={1} style={[styles.navText, active === item.key && styles.navTextActive]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

function AgentApp({ agent, onLogout }) {
  const { width } = useWindowDimensions();
  const compact = width < 420;
  const [agentProfile, setAgentProfile] = useState(agent);
  const [screen, setScreen] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customers, setCustomers] = useState(initialCustomers);
  const [assignedVehicles, setAssignedVehicles] = useState(() => normalizeAssignedVehicles(agent));
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [depositCustomerId, setDepositCustomerId] = useState(null);
  const [readAlertIds, setReadAlertIds] = useState(new Set());
  const [deletedAlertIds, setDeletedAlertIds] = useState(new Set());
  const navigationHistory = useRef([]);
  const darkMode = agentProfile.themeMode === "dark";

  const title = useMemo(() => {
    const item = allScreens.find(row => row.key === screen);
    return item?.label === "Home" ? "Dashboard" : item?.label || "Dashboard";
  }, [screen]);

  const agentAlerts = useMemo(() => customers.flatMap(customer => [
    ...(customer.payment !== "Paid" ? [{ id: `${customer.id}-payment`, type: "payment", icon: "wallet-outline", title: "Payment pending", message: `${customer.name} has no confirmed deposit.`, age: "now", customerName: customer.name }] : []),
    ...(customer.install !== "Complete" ? [{ id: `${customer.id}-install`, type: "install", icon: "radio-outline", title: "Install pending", message: `${customer.bike} tracker installation is not complete.`, age: "today", customerName: customer.name }] : []),
    ...(customer.kyc !== "Approved" ? [{ id: `${customer.id}-kyc`, type: "kyc", icon: "id-card-outline", title: "KYC review", message: `${customer.name} is waiting for admin KYC approval.`, age: "today", customerName: customer.name }] : [])
  ]).filter(alert => !deletedAlertIds.has(alert.id)).map(alert => ({ ...alert, unread: !readAlertIds.has(alert.id) })), [customers, deletedAlertIds, readAlertIds]);
  const unread = agentAlerts.filter(alert => alert.unread).length;
  const depositCustomer = customers.find(customer => customer.id === depositCustomerId);
  const soldVehicleIds = useMemo(() => new Set(customers.map(customer => customer.vehicleId).filter(Boolean)), [customers]);
  const availableAssignedVehicles = useMemo(() => assignedVehicles.filter(vehicle => !soldVehicleIds.has(vehicle.id)), [assignedVehicles, soldVehicleIds]);

  const navigate = useCallback((nextScreen) => {
    if (nextScreen === screen) {
      setDrawerOpen(false);
      return;
    }
    tap();
    navigationHistory.current.push(screen);
    setScreen(nextScreen);
    setDrawerOpen(false);
  }, [screen]);

  const goBack = useCallback(() => {
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    const previous = navigationHistory.current.pop();
    if (previous) {
      tap();
      setScreen(previous);
      return true;
    }
    return true;
  }, [drawerOpen]);

  const refresh = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setRefreshing(true);
    const net = await Network.getNetworkStateAsync().catch(() => ({ isConnected: true }));
    setIsOnline(Boolean(net.isConnected));
    if (agent.accessToken && net.isConnected) {
      try {
        const [customerResult, assignmentResult] = await Promise.all([
          authApi.listCustomers(agent.accessToken),
          authApi.listAssignments(agent.accessToken)
        ]);
        setCustomers(customerResult.customers || []);
        setAssignedVehicles(normalizeAssignedVehicles({ ...agent, assignedVehicles: assignmentResult.assignments || [] }));
      } catch (error) { console.warn("Agent customer refresh failed", error); }
    }
    if (showSpinner) setTimeout(() => setRefreshing(false), 450);
  }, [agent]);

  useEffect(() => {
    refresh();
    const assignmentSync = setInterval(() => refresh({ showSpinner: false }), 60_000);
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("agent", {
        name: "Jixels Agent Trackings",
        importance: Notifications.AndroidImportance.HIGH
      }).catch(() => {});
    }
    return () => clearInterval(assignmentSync);
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refresh({ showSpinner: false });
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (Platform.OS === "android") {
      const subscription = BackHandler.addEventListener("hardwareBackPress", goBack);
      return () => subscription.remove();
    }
    return undefined;
  }, [goBack]);

  function addCustomer(customer) {
    setCustomers(current => [customer, ...current]);
  }

  function markPaid(id, paidAmount) {
    setCustomers(current => current.map(customer => customer.id === id ? {
      ...customer,
      amount: paidAmount ?? customer.amount,
      payment: Math.max(0, Number(customer.payableAmount || 0) - Number((paidAmount ?? customer.amount) || 0)) === 0 ? "Paid" : "Deposit Paid",
      balance: Math.max(0, Number(customer.payableAmount || 0) - Number((paidAmount ?? customer.amount) || 0)),
      saleStatus: customer.install === "Complete" ? "Complete" : "Pending",
      commission: Math.max(customer.commission || 0, Math.round(((paidAmount ?? customer.amount) || 0) * COMMISSION_RATE)),
      receipt: customer.receipt || `AG${Math.floor(100000 + Math.random() * 899999)}`
    } : customer));
    Notifications.scheduleNotificationAsync({
      content: { title: "Deposit paid", body: "Customer deposit record updated.", sound: "default" },
      trigger: null
    }).catch(() => {});
  }

  function requestDeposit(id) {
    const customer = customers.find(item => item.id === id);
    if (!customer || customerPaymentComplete(customer)) return;
    setDepositCustomerId(id);
  }

  function sendDepositPrompt(id, depositAmount, payerPhone) {
    const customer = customers.find(item => item.id === id);
    if (!customer) return;
    const receipt = `STK${Math.floor(100000 + Math.random() * 899999)}`;
    setDepositCustomerId(null);
    setCustomers(current => current.map(item => item.id === id ? { ...item, amount: depositAmount, payment: "Processing", balance: Number(item.payableAmount || 0), payerPhone, receipt } : item));
    Notifications.scheduleNotificationAsync({
      content: { title: "STK push sent", body: `${customer.name} has been prompted on ${payerPhone} to pay ${money(depositAmount)}.`, sound: "default" },
      trigger: null
    }).catch(() => {});
    setTimeout(() => markPaid(id, depositAmount), 1800);
  }

  function markInstallComplete(id) {
    setCustomers(current => current.map(customer => customer.id === id ? {
      ...customer,
      install: "Complete",
      saleStatus: customerPaymentComplete(customer) ? "Complete" : "Pending"
    } : customer));
    Notifications.scheduleNotificationAsync({
      content: { title: "Tracker installed", body: "Tracker installation record completed.", sound: "default" },
      trigger: null
    }).catch(() => {});
  }

  const body = screen === "dashboard" ? <Dashboard compact={compact} customers={customers} navigate={navigate} isOnline={isOnline} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "customers" ? <Customers customers={customers} onDeposit={requestDeposit} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "onboard" ? <Onboarding addCustomer={addCustomer} navigate={navigate} assignedVehicles={availableAssignedVehicles} accessToken={agent.accessToken} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "payments" ? <Commissions customers={customers} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "alerts" ? <Alerts alerts={agentAlerts} markAllRead={() => setDeletedAlertIds(new Set(agentAlerts.map(alert => alert.id)))} markAlertRead={id => setReadAlertIds(current => new Set(current).add(id))} deleteAlerts={ids => setDeletedAlertIds(current => new Set([...current, ...ids]))} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "trackers" ? <Trackers customers={customers} onInstallComplete={markInstallComplete} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "reports" ? <Reports customers={customers} profile={agentProfile} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : screen === "settings" ? <Settings agent={agentProfile} onSave={setAgentProfile} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />
    : <Profile agent={agentProfile} onLogout={onLogout} onRefresh={refresh} refreshing={refreshing} darkMode={darkMode} />;

  return <SafeAreaView style={[styles.app, darkMode && styles.darkPage]}>
    <StatusBar style="light" />
    <View style={[styles.shell, darkMode && styles.darkPage]}>
      <View style={[styles.mainPane, darkMode && styles.darkPage]}>
        <PageHeader
          title={title}
          subtitle={`${agentProfile.name} • ${isOnline ? "online" : "offline"}`}
          unread={unread}
          expanded={drawerOpen}
          darkMode={darkMode}
          onToggle={() => setDrawerOpen(open => !open)}
          onAlerts={() => navigate("alerts")}
        />
        <View style={styles.screen}>{body}</View>
      </View>
      {drawerOpen && <Pressable accessibilityLabel="Close menu overlay" onPress={() => setDrawerOpen(false)} style={styles.drawerScrim} />}
      {drawerOpen && <Drawer active={screen} unread={unread} onSelect={navigate} onLogout={onLogout} onClose={() => setDrawerOpen(false)} />}
      <DepositPrompt customer={depositCustomer} visible={!!depositCustomer} onCancel={() => setDepositCustomerId(null)} onSubmit={sendDepositPrompt} />
    </View>
  </SafeAreaView>;
}

export default function App() {
  const [phase, setPhase] = useState("boot");
  const [agent, setAgent] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setPhase("login"), 900);
    return () => clearTimeout(timer);
  }, []);

  if (phase === "boot") return <Splash />;
  if (!agent) return <Login onLogin={next => { setAgent(next); setPhase("gps"); }} />;
  if (phase === "gps") return <AgentLaunch name={agent.name} onComplete={() => setPhase("skeleton")} />;
  if (phase === "skeleton") return <LaunchSkeleton onComplete={() => setPhase("app")} />;
  return <AgentApp agent={agent} onLogout={() => { setAgent(null); setPhase("login"); }} />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.blueDark, alignItems: "center", justifyContent: "center", padding: 24 },
  splashCard: { width: "100%", maxWidth: 360, minHeight: 480, borderRadius: 30, backgroundColor: "rgba(255,255,255,.08)", borderWidth: 1, borderColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center", padding: 24 },
  splashLogo: { width: 140, height: 76, marginBottom: 28, backgroundColor: colors.white, borderRadius: 18 },
  splashTitle: { marginTop: 18, color: colors.white, fontSize: 25, fontWeight: "900", textAlign: "center" },
  splashText: { marginTop: 8, color: "#CFE2F3", fontSize: 12, lineHeight: 18, textAlign: "center" },
  authLoadingPage: { flex: 1, backgroundColor: colors.blueDark },
  authLoadingBrand: { paddingTop: 58, paddingHorizontal: 24, paddingBottom: 18, alignItems: "center", gap: 8 },
  appSkeletonPage: { flex: 1, backgroundColor: colors.surface, paddingTop: 14 },
  agentLaunch: { flex: 1, backgroundColor: colors.blueDark, paddingHorizontal: 25 },
  agentLaunchActivity: { flex: 1, justifyContent: "center", paddingBottom: 30 },
  agentLaunchStage: { height: 260, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  agentLaunchRing: { position: "absolute", width: 145, height: 145, borderRadius: 73, backgroundColor: "rgba(9,105,218,.58)" },
  agentLaunchCore: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.blue, borderWidth: 7, borderColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" },
  agentLaunchRoad: { position: "absolute", bottom: 20, left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,.2)" },
  agentLaunchVehicle: { position: "absolute", bottom: 25, width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center", shadowOpacity: .4, shadowRadius: 10, elevation: 7 },
  agentLaunchCar: { backgroundColor: colors.green, shadowColor: colors.green },
  agentLaunchBike: { backgroundColor: colors.orange, shadowColor: colors.orange },
  agentLaunchTukTuk: { backgroundColor: colors.blue, shadowColor: colors.blue },
  agentLaunchWelcome: { color: "#71D9B3", fontSize: 14, fontWeight: "900", textAlign: "center", letterSpacing: .4 },
  agentLaunchTitle: { color: colors.white, fontSize: 24, fontWeight: "900", textAlign: "center", marginTop: 5 },
  agentLaunchText: { color: "#BED0E3", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 },
  agentLaunchDots: { flexDirection: "row", justifyContent: "center", gap: 9, marginTop: 22 },
  agentLaunchDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  skeleton: { overflow: "hidden", backgroundColor: "#E6EEF7", borderRadius: 12 },
  skeletonShine: { width: 90, height: "100%", backgroundColor: "rgba(255,255,255,.55)" },
  authSkeleton: { flex: 1, marginHorizontal: 16, marginBottom: 18, borderRadius: 24, backgroundColor: colors.white, padding: 18, gap: 14 },
  skeletonAuthCard: { height: 82, borderRadius: 18 },
  skeletonLabel: { width: "52%", height: 13 },
  skeletonAuthHeader: { width: "64%", height: 28 },
  skeletonSmallLabel: { width: 86, height: 10, marginBottom: 7 },
  skeletonInput: { width: "100%", height: 52, borderRadius: 14 },
  skeletonSubmit: { width: "100%", height: 52, borderRadius: 14, marginTop: 3 },
  skeletonAuthFooter: { width: "52%", height: 12, alignSelf: "center" },
  skeletonPage: { flex: 1, padding: 14, gap: 13 },
  skeletonHero: { width: "100%", height: 150, borderRadius: 20 },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  skeletonStat: { width: "47.8%", height: 112, borderRadius: 17 },
  skeletonTitle: { width: "48%", height: 22, marginTop: 4 },
  skeletonRow: { width: "100%", height: 82, borderRadius: 16 },
  auth: { flex: 1, backgroundColor: colors.blueDark },
  authHero: { paddingTop: 58, paddingHorizontal: 22, paddingBottom: 26 },
  authLogo: { width: 118, height: 58, backgroundColor: colors.white, borderRadius: 16 },
  authTitle: { marginTop: 28, color: colors.white, fontSize: 34, fontWeight: "900" },
  authText: { marginTop: 8, color: "#CFE2F3", fontSize: 13, lineHeight: 20 },
  authCard: { flex: 1, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.white, padding: 22, gap: 14 },
  authTabs: { minHeight: 44, borderRadius: 14, backgroundColor: colors.surface, padding: 4, flexDirection: "row", gap: 5 },
  authTab: { flex: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  authTabActive: { backgroundColor: colors.blue },
  authTabText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  authTabTextActive: { color: colors.white },
  authForm: { flexGrow: 1, gap: 13, paddingBottom: 28 },
  resetIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  resetCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", fontWeight: "700" },
  forgotText: { color: colors.blue, fontSize: 12, fontWeight: "900", textAlign: "right" },
  backToLogin: { minHeight: 42, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12 },
  backToLoginText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  cardTitle: { color: colors.ink, fontSize: 25, fontWeight: "900" },
  fieldWrap: { gap: 7 },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  inputShell: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  input: { flex: 1, minHeight: 50, color: colors.ink, fontSize: 14, fontWeight: "700", padding: 0 },
  passwordToggle: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginRight: -8 },
  primaryButton: { minHeight: 52, borderRadius: 14, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  primaryText: { color: colors.white, fontSize: 13, fontWeight: "900" },
  demoText: { color: colors.muted, fontSize: 11, textAlign: "center" },
  app: { flex: 1, backgroundColor: colors.surface },
  shell: { flex: 1, backgroundColor: colors.surface },
  mainPane: { flex: 1, backgroundColor: colors.surface },
  darkPage: { backgroundColor: "#081829" },
  darkCard: { backgroundColor: "#10263B", borderColor: "#27435D" },
  darkHeader: { backgroundColor: "#10263B", borderBottomColor: "#27435D" },
  darkText: { color: colors.white },
  darkInput: { backgroundColor: "#0D1F31", borderColor: "#27435D", color: colors.white },
  drawerScrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(6,22,38,.38)", zIndex: 30 },
  drawer: { position: "absolute", top: 0, bottom: 0, left: 0, width: DRAWER_WIDTH, backgroundColor: colors.blueDark, overflow: "hidden", zIndex: 40, shadowColor: colors.ink, shadowOpacity: .24, shadowRadius: 14, elevation: 30 },
  drawerTop: { height: 78, minWidth: DRAWER_WIDTH, paddingTop: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,.08)" },
  drawerToggle: { width: 36, height: 36, borderRadius: 11, backgroundColor: "rgba(255,255,255,.1)", alignItems: "center", justifyContent: "center" },
  drawerLogo: { width: 112, height: 42, borderRadius: 12, backgroundColor: colors.white },
  drawerScroll: { flex: 1 },
  drawerMenu: { paddingHorizontal: 5, paddingTop: 9, paddingBottom: 20, gap: 7 },
  drawerItem: { width: DRAWER_WIDTH - 10, height: 48, borderRadius: 13, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
  drawerItemActive: { backgroundColor: colors.blue },
  drawerLabel: { color: "#BED0E3", fontWeight: "700", fontSize: 13, marginLeft: 14 },
  drawerLabelActive: { color: colors.white },
  menuBadge: { position: "absolute", top: -8, right: -11, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.red, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.blueDark },
  menuBadgeText: { color: colors.white, fontSize: 8, fontWeight: "900" },
  drawerLogout: { width: DRAWER_WIDTH, minHeight: 60, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,.09)", paddingHorizontal: 17, flexDirection: "row", alignItems: "center" },
  drawerLogoutText: { color: "#F9A8A8", marginLeft: 14, fontWeight: "800" },
  pageHeader: { height: 70, zIndex: 20, elevation: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  headerMenu: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" },
  headerTitleWrap: { flex: 1, minWidth: 0, marginHorizontal: 11 },
  pageTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  pageSubtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  headerAgentAvatar: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginRight: 8 },
  headerAgentAvatarText: { color: colors.white, fontSize: 10, fontWeight: "900" },
  headerBell: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  headerBadge: { position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  headerBadgeText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  header: { minHeight: 72, backgroundColor: colors.blueDark, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 11 },
  avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.white, fontSize: 13, fontWeight: "900" },
  headerTitle: { flex: 1, minWidth: 0 },
  headerName: { color: colors.white, fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#CFE2F3", fontSize: 10, marginTop: 2 },
  headerButton: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  quickMenu: { gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  quickChip: { minHeight: 38, borderRadius: 19, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  quickChipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  quickText: { color: colors.blueDark, fontSize: 11, fontWeight: "900" },
  quickTextActive: { color: colors.white },
  screen: { flex: 1 },
  screenInner: { flexGrow: 1 },
  pageScroll: { flex: 1 },
  pageContent: { padding: 14, paddingBottom: 36, gap: 14 },
  page: { padding: 14, paddingBottom: 36, gap: 13 },
  hero: { minHeight: 156, borderRadius: 22, backgroundColor: colors.blueDark, padding: 18, flexDirection: "row", gap: 14, alignItems: "center" },
  heroIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  heroSmall: { color: "#8FC7FF", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  heroTitle: { marginTop: 4, color: colors.white, fontSize: 22, lineHeight: 26, fontWeight: "900" },
  heroText: { marginTop: 6, color: "#D8E8F7", fontSize: 11, lineHeight: 16 },
  syncCard: { minHeight: 48, borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  syncText: { flex: 1, color: colors.ink, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { width: "47.8%", minHeight: 116, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 14 },
  statCardCompact: { width: "100%" },
  statIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" },
  statValue: { marginTop: 8, color: colors.ink, fontSize: 18, fontWeight: "900" },
  statLabel: { marginTop: 3, color: colors.muted, fontSize: 10, fontWeight: "800" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCard: { width: "47.8%", minHeight: 112, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 14 },
  actionTitle: { marginTop: 10, color: colors.ink, fontSize: 13, fontWeight: "900" },
  actionText: { marginTop: 4, color: colors.muted, fontSize: 10, lineHeight: 14 },
  sectionTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  sectionAction: { color: colors.blue, fontSize: 12, fontWeight: "800" },
  selectedOperationCard: { borderRadius: 18, borderWidth: 1.5, borderColor: colors.blue, backgroundColor: colors.white, padding: 15, gap: 14 },
  selectedOperationTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  selectedOperationIcon: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  selectedOperationTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  selectedOperationSub: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  operationCardActions: { flexDirection: "row", gap: 10 },
  outlineAction: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 8 },
  outlineActionText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  primaryAction: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 8 },
  primaryActionText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  listCard: { minHeight: 86, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  listIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" },
  listBody: { flex: 1, minWidth: 0 },
  listTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  listSub: { marginTop: 3, color: colors.muted, fontSize: 10, lineHeight: 15 },
  listMeta: { marginTop: 3, color: "#94A3B8", fontSize: 9 },
  listStatus: { alignItems: "flex-end", gap: 6, maxWidth: 106 },
  smallMeta: { color: "#94A3B8", fontSize: 8, fontWeight: "800" },
  pill: { minHeight: 24, borderRadius: 12, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 8, fontWeight: "900" },
  depositButton: { minHeight: 30, borderRadius: 15, backgroundColor: colors.blue, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  depositButtonText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  formCard: { borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 15, gap: 13 },
  captureRow: { flexDirection: "row", gap: 10 },
  secondaryButton: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10 },
  secondaryText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  documentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  documentPreview: { width: "31%", minWidth: 92, height: 112, borderRadius: 14, backgroundColor: colors.surface },
  photoPreview: { width: "100%", height: 180, borderRadius: 16, backgroundColor: colors.surface },
  gpsText: { color: colors.green, fontSize: 11, fontWeight: "800" },
  installRow: { minHeight: 76, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 13, justifyContent: "center", gap: 4 },
  installName: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  installSub: { color: colors.muted, fontSize: 10 },
  installActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
  miniButton: { minHeight: 30, borderRadius: 15, backgroundColor: colors.blue, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  miniButtonText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  agreedPaymentNote: { borderRadius: 12, backgroundColor: colors.bluePale, padding: 12, marginBottom: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  agreedPaymentValue: { color: colors.blueDark, fontSize: 14, fontWeight: "900" },
  summaryCard: { minHeight: 118, borderRadius: 20, backgroundColor: colors.bluePale, padding: 17, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryValue: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 5 },
  summaryMeta: { color: colors.muted, fontSize: 10, marginTop: 4, fontWeight: "700" },
  summaryIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  reportCard: { minHeight: 170, borderRadius: 22, backgroundColor: colors.blueDark, padding: 18, justifyContent: "center" },
  reportLabel: { color: "#8FC7FF", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  reportLabelDark: { color: colors.blueDark, fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  reportValue: { marginTop: 8, color: colors.white, fontSize: 32, fontWeight: "900" },
  reportText: { marginTop: 8, color: "#D8E8F7", fontSize: 12, lineHeight: 18 },
  reportHero: { borderRadius: 20, padding: 20, backgroundColor: colors.blueDark, alignItems: "center" },
  reportHeroIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  reportHeroTitle: { color: colors.white, fontSize: 21, fontWeight: "900", marginTop: 12 },
  reportHeroText: { color: "#BED0E3", fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 6 },
  reportBikePicker: { marginBottom: 14 },
  reportBikePickerButton: { minHeight: 58, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 11, flexDirection: "row", alignItems: "center" },
  reportBikeDropdown: { maxHeight: 268, marginTop: 7, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, overflow: "hidden" },
  reportBikeSearch: { minHeight: 46, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, backgroundColor: colors.surface },
  reportBikeSearchInput: { flex: 1, color: colors.ink, fontSize: 11, marginLeft: 8, paddingVertical: 0 },
  reportBikeList: { maxHeight: 212 },
  reportBikeOption: { minHeight: 55, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  reportBikeOptionActive: { backgroundColor: colors.bluePale },
  noVehicleText: { color: colors.muted, fontSize: 11, padding: 16, textAlign: "center" },
  vehicleDropdownIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center", marginRight: 9 },
  vehicleDropdownPlate: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  vehicleDropdownModel: { color: colors.muted, fontSize: 8, marginTop: 2 },
  reportPeriods: { gap: 7 },
  reportPeriod: { minHeight: 45, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  reportPeriodActive: { backgroundColor: colors.bluePale, borderColor: "#A8CCF5" },
  reportPeriodText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  reportPeriodTextActive: { color: colors.blueDark, fontWeight: "900" },
  reportMetricRow: { minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  reportMetricLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  reportMetricValue: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  reportRow: { minHeight: 62, borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 13 },
  reportName: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  reportMeta: { marginTop: 4, color: colors.muted, fontSize: 10 },
  alertCard: { minHeight: 78, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 13, flexDirection: "row", gap: 10 },
  alertIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.redPale, alignItems: "center", justifyContent: "center" },
  nativeListToolbar: { paddingHorizontal: 2, paddingVertical: 9, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nativeListHeading: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  nativeToolbarSub: { color: colors.muted, fontSize: 10, marginTop: 2 },
  selectionActions: { flexDirection: "row", gap: 6, marginRight: 2 },
  selectionButton: { minHeight: 34, paddingHorizontal: 9, borderRadius: 17, backgroundColor: colors.bluePale, flexDirection: "row", alignItems: "center", gap: 4 },
  deleteButton: { backgroundColor: colors.redPale },
  deleteText: { color: colors.red, fontSize: 9, fontWeight: "900" },
  markReadButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.bluePale, flexDirection: "row", alignItems: "center", gap: 5 },
  markReadText: { color: colors.blue, fontSize: 9, fontWeight: "900" },
  nativeRow: { minHeight: 82, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  nativeRowUnread: { backgroundColor: "#F3F8FF" },
  nativeRowSelected: { backgroundColor: "#E7F1FF" },
  selectionCheck: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginRight: 9 },
  selectionCheckActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  nativeAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginRight: 12 },
  nativeAvatarOrange: { backgroundColor: colors.orange },
  nativeAvatarGreen: { backgroundColor: colors.green },
  nativeRowBody: { flex: 1, minWidth: 0 },
  nativeRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  nativeRowTitle: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "900" },
  nativeRowTime: { color: colors.muted, fontSize: 9 },
  nativeRowMessage: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  nativeRowStatus: { color: colors.green, fontSize: 9, fontWeight: "800", marginTop: 3 },
  nativeUnreadBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  nativeUnreadText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  empty: { minHeight: 190, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  emptySub: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: "center", paddingHorizontal: 20 },
  profileHero: { minHeight: 190, borderRadius: 22, backgroundColor: colors.blueDark, alignItems: "center", justifyContent: "center", padding: 18 },
  profileHeroLight: { alignItems: "center", paddingTop: 24, paddingBottom: 18, marginTop: 8 },
  profileAvatar: { width: 76, height: 76, borderRadius: 25, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  profilePhoto: { width: 76, height: 76, borderRadius: 25 },
  profileAvatarText: { color: colors.white, fontSize: 24, fontWeight: "900" },
  profileName: { marginTop: 12, color: colors.white, fontSize: 22, fontWeight: "900" },
  profileNameDark: { color: colors.ink, fontSize: 21, fontWeight: "900", marginTop: 10 },
  profileMeta: { marginTop: 4, color: "#D8E8F7", fontSize: 11 },
  profileId: { color: colors.muted, fontSize: 10, marginTop: 3 },
  photoActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  photoButton: { minHeight: 34, borderRadius: 17, backgroundColor: colors.bluePale, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  photoButtonText: { color: colors.blue, fontSize: 10, fontWeight: "900" },
  removePhotoButton: { minHeight: 34, paddingHorizontal: 11, justifyContent: "center" },
  removePhotoText: { color: colors.red, fontSize: 10, fontWeight: "800" },
  infoLine: { color: colors.ink, fontSize: 12, lineHeight: 20, fontWeight: "700" },
  settingsSection: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 15 },
  settingsTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  settingsCopy: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4, marginBottom: 16 },
  themeOptions: { flexDirection: "row", gap: 9 },
  themeOption: { flex: 1, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  themeOptionActive: { backgroundColor: colors.blueDark, borderColor: colors.blueDark },
  themeOptionText: { color: colors.blueDark, fontSize: 11, fontWeight: "900" },
  themeOptionTextActive: { color: colors.white },
  readonlyField: { minHeight: 57, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 14, marginBottom: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  microLabel: { color: colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: .8 },
  profileValue: { color: colors.ink, fontSize: 12, fontWeight: "700", marginTop: 3 },
  infoCallout: { borderLeftWidth: 4, borderLeftColor: colors.blue, backgroundColor: colors.bluePale, borderRadius: 13, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  infoCalloutText: { flex: 1, color: colors.ink, fontSize: 11, lineHeight: 17, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(7,29,54,.64)", alignItems: "center", justifyContent: "center", padding: 20 },
  successOverlay: { flex: 1, backgroundColor: "rgba(7,29,54,.72)", alignItems: "center", justifyContent: "center", padding: 24 },
  successCard: { width: "100%", maxWidth: 370, backgroundColor: colors.white, borderRadius: 26, padding: 22, alignItems: "center" },
  depositModal: { width: "100%", maxWidth: 380, borderRadius: 22, backgroundColor: colors.white, padding: 18, gap: 13 },
  depositModalIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  depositModalTitle: { color: colors.ink, fontSize: 20, fontWeight: "900", textAlign: "center" },
  depositModalText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center" },
  reportSuccessCard: { width: "100%", maxWidth: 370, borderRadius: 22, backgroundColor: colors.white, padding: 18, alignItems: "center", gap: 13 },
  successIcon: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", marginTop: -58, borderWidth: 7, borderColor: colors.white, shadowColor: colors.green, shadowOpacity: .3, shadowRadius: 14, elevation: 8 },
  successTitle: { color: colors.ink, fontSize: 23, fontWeight: "900", marginTop: 14 },
  reportSuccessMessage: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 },
  receiptBox: { alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 15, padding: 14, alignItems: "center", marginVertical: 20 },
  receiptLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  reportSuccessName: { color: colors.ink, fontSize: 12, fontWeight: "900", marginTop: 6, textAlign: "center" },
  reportSuccessEmail: { color: colors.ink, fontSize: 13, fontWeight: "900", marginTop: 6, textAlign: "center" },
  primaryButtonText: { color: colors.white, fontSize: 13, fontWeight: "900" },
  approvalSecondary: { minHeight: 42, alignItems: "center", justifyContent: "center", marginTop: 6 },
  modalCancel: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  modalCancelText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  logoutButton: { minHeight: 50, borderRadius: 14, backgroundColor: colors.redPale, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 6 },
  logoutText: { color: colors.red, fontSize: 12, fontWeight: "900" },
  bottomNav: { position: "absolute", left: 10, right: 10, bottom: Platform.OS === "ios" ? 16 : 10, height: 66, borderRadius: 22, backgroundColor: "rgba(255,255,255,.98)", borderWidth: 1, borderColor: "rgba(15,49,83,.08)", flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 6, zIndex: 15, elevation: 18, shadowColor: colors.ink, shadowOpacity: .14, shadowRadius: 12 },
  navItem: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2 },
  navActive: { backgroundColor: colors.blue },
  navText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  navTextActive: { color: colors.white }
});
