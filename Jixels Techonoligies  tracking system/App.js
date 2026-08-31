import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, BackHandler, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import MapView, { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as Network from "expo-network";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { colors } from "./src/theme";
import { useTracking } from "./src/hooks/useTracking";
import { alerts as seedAlerts, bikes as allBikes, customer, money, payments as seedPayments } from "./src/customerData";
import { config } from "./src/config";
import { ApiError, apiRequest } from "./src/services/api";
import { authApi } from "./src/services/auth";
import { sessionStore } from "./src/services/session";
import { newIdempotencyKey, paymentsApi } from "./src/services/payments";
import { dedupeById, isStrongPassword, isValidEmail, isValidOtp, normalizeEmail, normalizeKenyanMpesaPhone, upsertById } from "./src/utils/validation.mjs";
import { customerApi } from "./src/services/customer";
import { trackingApi } from "./src/services/tracking";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

const DRAWER_OPEN = 238;
const DRAWER_CLOSED = 0;
const STALE_MS = 2 * 60_000;
const OFFLINE_MS = 10 * 60_000;
const GPS_LAUNCH_SECONDS = 7;
const ranges = ["Today", "Yesterday", "7 Days", "Custom"];
const bikes = allBikes.filter(vehicle => vehicle.financeStatus !== "Completed");
const skeletonShimmer = new Animated.Value(0);
const reportPeriods = [
  { key: "daily", label: "Daily", icon: "today-outline" },
  { key: "weekly", label: "Weekly", icon: "calendar-outline" },
  { key: "monthly", label: "Monthly", icon: "calendar-number-outline" },
  { key: "yearly", label: "Yearly", icon: "bar-chart-outline" }
];

const nativeTap = () => Haptics.selectionAsync().catch(() => {});
const nativeSuccess = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

function demoMpesaReceipt() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

async function enableNotifications() {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Jixels Customer Trackings", description: "Payment, tracker and account notifications from Jixels Customer Trackings", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: colors.green, sound: "default" });
  const current = await Notifications.getPermissionsAsync();
  if (current.status !== "granted") await Notifications.requestPermissionsAsync();
}

async function saveProfilePhoto(uri) {
  const directory = `${FileSystem.documentDirectory}profile/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const extension = uri.split("?")[0].split(".").pop()?.toLowerCase();
  const safeExtension = extension && extension.length <= 5 ? extension : "jpg";
  const destination = `${directory}customer-photo.${safeExtension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

function reportFileName(period, reportType = "payments") {
  return `jixels-${reportType}-report-${period.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf`;
}
const menu = [
  { key: "dashboard", label: "Dashboard", icon: "grid-outline" },
  { key: "bikes", label: "My Vehicles", icon: "car-sport-outline" },
  { key: "tracking", label: "Live Tracking", icon: "navigate-circle-outline" },
  { key: "monitoring", label: "Monitoring", icon: "shield-checkmark-outline" },
  { key: "payments", label: "Make Payment", icon: "wallet-outline" },
  { key: "history", label: "Payment History", icon: "receipt-outline" },
  { key: "reports", label: "Reports", icon: "document-text-outline" },
  { key: "alerts", label: "Alerts", icon: "notifications-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
];

function trackerState(recordedAt) {
  const age = Date.now() - new Date(recordedAt).getTime();
  return age > OFFLINE_MS ? "offline" : age > STALE_MS ? "stale" : "online";
}

function relativeTime(value, now) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

const Logo = memo(function Logo({ compact = false }) {
  return <View style={styles.logoRow}><View style={[styles.logoBacking, compact && styles.logoBackingCompact]}><Image source={require("./assets/jixels-logo.png")} resizeMode="contain" style={[styles.brandLogoImage, compact && styles.brandLogoCompact]} /></View></View>;
});

function Field({ icon, label, secureTextEntry, keyboardType, value, onChangeText, placeholder, editable = true }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><View style={[styles.field, !editable && styles.fieldReadonly]}><Ionicons name={icon} size={18} color={colors.gray} /><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#94A3B8" secureTextEntry={secureTextEntry} keyboardType={keyboardType} autoCapitalize="none" editable={editable} style={styles.fieldInput} />{!editable && <Ionicons name="lock-closed" size={15} color={colors.gray} />}</View></View>;
}

function AuthScreen({ onAuthenticated, onPendingApproval, pendingEmail, approvedEmail }) {
  const [mode, setMode] = useState("login");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => config.demoMode ? customer.email : "");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => { Animated.spring(entrance, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 140 }).start(); }, [entrance]);
  const submit = async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) return Alert.alert("Missing information", "Enter your email address and password.");
    if (!isValidEmail(normalizedEmail)) return Alert.alert("Invalid email", "Enter a valid email address.");
    if (password.length < 8) return Alert.alert("Password too short", "Use at least 8 characters.");
    if (mode === "register" && !isStrongPassword(password)) return Alert.alert("Password is not strong enough", "Include an uppercase letter, lowercase letter, number, and special character such as @, #, !, or %. Do not use spaces.");
    if (mode === "register" && (!name.trim() || !phone.trim() || password !== confirm)) return Alert.alert("Check registration", password !== confirm ? "Passwords do not match." : "Complete your name and phone number.");
    if (mode === "login" && pendingEmail && normalizedEmail === pendingEmail.trim().toLowerCase() && normalizedEmail !== approvedEmail?.trim().toLowerCase()) return Alert.alert("Approval pending", "Wait for Jixels approval and verify the six-digit code before signing in.");
    setBusy(true);
    try {
      if (mode === "register") {
        const application = config.demoMode ? { status: "pending" } : await authApi.register({ name: name.trim(), email: normalizedEmail, phone: phone.trim(), password });
        if (application?.status !== "pending" && application?.status !== "submitted") throw new Error("Registration was not accepted.");
        onPendingApproval({ name: name.trim(), email: normalizedEmail, phone: phone.trim() });
        return;
      }
      const session = config.demoMode ? { accessToken: "demo-session", expiresAt: Date.now() + 60 * 60_000, user: { id: customer.id, name: customer.name, email: normalizedEmail, phone: customer.phone } } : await authApi.login(normalizedEmail, password);
      if (!session?.accessToken || !session?.user) throw new Error("The backend returned an invalid session.");
      onAuthenticated(session);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 423 || error.code === "ACCOUNT_LOCKED")) Alert.alert("Account locked", "Two failed login attempts were detected. Contact your Jixels administrator to have the account opened.");
      else if (error instanceof ApiError && error.status === 401) Alert.alert("Login unsuccessful", error.details?.remainingAttempts === 1 ? "The email or password is incorrect. You have one attempt remaining before the account is locked." : "The email or password is incorrect.");
      else Alert.alert(mode === "register" ? "Registration unavailable" : "Unable to sign in", error instanceof Error ? error.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const requestPasswordReset = () => {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) return Alert.alert("Enter your email", "Enter the valid email address registered on your account.");
    setBusy(true);
    (config.demoMode ? Promise.resolve() : authApi.requestPasswordReset(normalizedEmail)).catch(() => {}).finally(() => {
      setBusy(false);
      setResettingPassword(false);
      Alert.alert("Check your email", "If an approved account exists, Jixels Customer Trackings will send a secure reset link. Open it and create a new password of at least 8 characters.");
    });
  };
  if (busy && mode === "login" && !resettingPassword) return <View style={styles.authLoadingPage}><StatusBar style="light" /><View style={styles.authLoadingBrand}><Logo /><Text style={styles.authHeading}>Signing you in</Text><Text style={styles.authLead}>Preparing your secure customer dashboard.</Text></View><ActivitySkeleton screen="auth" /></View>;

  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.authPage}>
    <StatusBar style="light" />
    <View style={styles.authHero}><View style={styles.authOrbOne} /><View style={styles.authOrbTwo} /><Logo /><Text style={styles.authHeading}>{resettingPassword ? "Reset password" : mode === "login" ? "Welcome back" : "Create your account"}</Text><Text style={styles.authLead}>{resettingPassword ? "Enter your registered email. We will email a secure link where you can create a new password." : mode === "login" ? "Sign in carefully. Two failed attempts lock the account until a Jixels administrator opens it." : "Use 8+ characters with uppercase, lowercase, a number and a special character."}</Text></View>
    <Animated.View style={[styles.authCard, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }]}> 
      {!resettingPassword && <View style={styles.authTabs}><Pressable onPress={() => setMode("login")} style={[styles.authTab, mode === "login" && styles.authTabActive]}><Text style={[styles.authTabText, mode === "login" && styles.authTabTextActive]}>Login</Text></Pressable><Pressable onPress={() => setMode("register")} style={[styles.authTab, mode === "register" && styles.authTabActive]}><Text style={[styles.authTabText, mode === "register" && styles.authTabTextActive]}>Register</Text></Pressable></View>}
      <ScrollView style={styles.authFormScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{resettingPassword ? <><View style={styles.resetIcon}><Ionicons name="key-outline" size={28} color={colors.blue} /></View><Text style={styles.resetTitle}>Recover your account</Text><Text style={styles.resetCopy}>We will send instructions only if the email belongs to an approved Jixels account.</Text><Field icon="mail-outline" label="Registered email address" placeholder="your.email@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" /><Pressable onPress={requestPasswordReset} disabled={busy} style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>{busy ? <ActivityIndicator color={colors.white} /> : <><Text style={styles.primaryButtonText}>Send reset instructions</Text><Ionicons name="mail-outline" size={18} color={colors.white} /></>}</Pressable><Pressable onPress={() => setResettingPassword(false)} style={styles.backToLogin}><Ionicons name="arrow-back" size={16} color={colors.blue} /><Text style={styles.backToLoginText}>Back to login</Text></Pressable></> : <>{mode === "register" && <Field icon="person-outline" label="Full name" placeholder="Full name" value={name} onChangeText={setName} />}<Field icon="mail-outline" label="Email address" placeholder="your.email@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" />{mode === "register" && <Field icon="call-outline" label="Phone number" placeholder="07++++++++++" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />}<Field icon="lock-closed-outline" label="Password (minimum 8 characters)" placeholder="Enter at least 8 characters" value={password} onChangeText={setPassword} secureTextEntry />{mode === "register" && <Field icon="shield-checkmark-outline" label="Confirm password" placeholder="Repeat password" value={confirm} onChangeText={setConfirm} secureTextEntry />}{mode === "login" && <Pressable onPress={() => setResettingPassword(true)}><Text style={styles.forgot}>Forgot password?</Text></Pressable>}<Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>{busy ? <ActivityIndicator color={colors.white} /> : <><Text style={styles.primaryButtonText}>{mode === "login" ? "Sign in securely" : "Create account"}</Text><Ionicons name="arrow-forward" size={18} color={colors.white} /></>}</Pressable></>}</ScrollView>
      <Text style={styles.copyright}>© {new Date().getFullYear()} Bumu Teams Technologies. All rights reserved.</Text>
    </Animated.View>
  </KeyboardAvoidingView>;
}

function PendingApproval({ applicant, onEnterCode, onBackToLogin }) {
  useEffect(() => {
    if (config.demoMode || !applicant?.email) return undefined;
    let active = true;
    let notified = false;
    const check = async () => {
      try {
        const account = await authApi.accountStatus(applicant.email);
        if (active && account?.status === "approved" && !notified) {
          notified = true;
          Alert.alert("Your account has been approved", account.message || (account.otpCode ? `Your one-time login code is ${account.otpCode}.` : "Open your approval notification to view the one-time login code."), [{ text: "Enter code", onPress: onEnterCode }]);
        }
      } catch { /* keep waiting while offline or while the backend is unavailable */ }
    };
    check();
    const timer = setInterval(check, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [applicant?.email, onEnterCode]);
  return <View style={styles.approvalPage}><StatusBar style="light" /><View style={styles.approvalGlow} /><Logo /><View style={styles.approvalIcon}><Ionicons name="time-outline" size={46} color={colors.orange} /></View><Text style={styles.approvalTitle}>Account awaiting approval</Text><Text style={styles.approvalText}>Thanks, {applicant?.name || "customer"}. Jixels administration must approve your registration. After approval, Jixels Customer Trackings sends a six-digit verification code to your registered contact.</Text><View style={styles.approvalSteps}><View style={styles.approvalStep}><Ionicons name="checkmark-circle" size={21} color={colors.green} /><Text style={styles.approvalStepText}>Registration received</Text></View><View style={styles.approvalLine} /><View style={styles.approvalStep}><Ionicons name="hourglass-outline" size={21} color={colors.orange} /><Text style={styles.approvalStepText}>Admin verification and approval</Text></View><View style={styles.approvalLine} /><View style={styles.approvalStep}><Ionicons name="chatbox-ellipses-outline" size={21} color={colors.white} /><Text style={styles.approvalStepText}>Six-digit security code sent</Text></View></View><Pressable onPress={onEnterCode} style={styles.approvalButton}><Text style={styles.primaryButtonText}>Enter approval code</Text><Ionicons name="keypad-outline" size={18} color={colors.white} /></Pressable><Pressable onPress={onBackToLogin} style={styles.approvalSecondary}><Text style={styles.approvalSecondaryText}>Back to login</Text></Pressable></View>;
}

function OtpVerification({ applicant, onVerified, onBack, initialGate = false }) {
  const [code, setCode] = useState("");
  const [contact, setContact] = useState(applicant?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const inputRef = useRef(null);
  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 130 }).start();
    const animation = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true })]));
    animation.start();
    return () => animation.stop();
  }, [entrance, pulse]);
  useEffect(() => { if (resendIn <= 0) return undefined; const timer = setInterval(() => setResendIn(value => Math.max(0, value - 1)), 1000); return () => clearInterval(timer); }, [resendIn]);
  const verify = async () => {
    if (!isValidOtp(code)) return Alert.alert("Enter the full code", "The Jixels verification code contains exactly six digits.");
    const identity = isValidEmail(contact) ? normalizeEmail(contact) : normalizeKenyanMpesaPhone(contact);
    if (initialGate && !identity) return Alert.alert("Enter your registered contact", "Enter the email address or Kenyan phone number that received this code.");
    setBusy(true);
    try {
      if (config.demoMode) {
        if (code !== "123456") throw new Error("Invalid or expired code");
      } else await authApi.verifyOtp({ identifier: identity ?? applicant?.email, code, purpose: initialGate ? "app-access" : "account-approval" });
      onVerified();
    } catch (cause) {
      Alert.alert("Code not verified", cause instanceof Error ? cause.message : "Request a new code and try again.");
    } finally { setBusy(false); }
  };
  const requestNewCode = async () => {
    const identity = isValidEmail(contact) ? normalizeEmail(contact) : normalizeKenyanMpesaPhone(contact);
    if (initialGate && !identity) return Alert.alert("Enter your registered contact", "Enter the approved email address or Kenyan phone number where Jixels should send the code.");
    setBusy(true);
    try {
      if (!config.demoMode) await authApi.requestOtp({ identifier: identity ?? applicant?.email, purpose: initialGate ? "app-access" : "account-approval" });
      setCode("");
      setResendIn(30);
      Alert.alert("New code requested", initialGate ? "A new security code is available for this login." : "A new approval code is available in your private customer portal notification.");
      setTimeout(() => inputRef.current?.focus(), 250);
    } catch (cause) {
      Alert.alert("Request failed", cause instanceof Error ? cause.message : "Please try again.");
    } finally { setBusy(false); }
  };
  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.otpPage}>
    <StatusBar style="light" />
    <Animated.View style={[styles.otpGlow, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.35, .75] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [.86, 1.18] }) }] }]} />
    <Animated.View style={[styles.otpGlowSecondary, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.62, .18] }), transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [-18, 22] }) }, { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.08, .82] }) }] }]} />
    <Animated.View style={[styles.otpCard, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }, { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [.94, 1] }) }] }]}> 
      <Animated.View style={[styles.otpIcon, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }, { rotate: pulse.interpolate({ inputRange: [0, 1], outputRange: ["-2deg", "2deg"] }) }] }]}><Ionicons name="shield-checkmark" size={38} color={colors.white} /></Animated.View>
      <Text style={styles.otpTitle}>{initialGate ? "Jixels Security Check" : "Verify your approval"}</Text>
      <Text style={styles.otpText}>{initialGate ? "Enter your six-digit Jixels security code." : "Enter the six-digit code shown in your private approval notification."}</Text>
      {initialGate && <View style={{ alignSelf: "stretch", marginTop: 14 }}><Field icon="person-circle-outline" label="Registered email or phone" placeholder="your.email@example.com or 07++++++++++" value={contact} onChangeText={setContact} /></View>}
      <View style={styles.otpInputArea}>
        <View pointerEvents="none" style={styles.otpBoxes}>{Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.otpBox, code.length === index && styles.otpBoxActive, code[index] && styles.otpBoxFilled]}><Text style={styles.otpDigit}>{code[index] ?? ""}</Text></View>)}</View>
        <TextInput ref={inputRef} autoFocus value={code} onChangeText={value => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" inputMode="numeric" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp" caretHidden style={styles.otpHiddenInput} />
      </View>
      <Pressable disabled={busy} onPress={verify} style={styles.primaryButton}>{busy ? <ActivityIndicator color={colors.white} /> : <><Text style={styles.primaryButtonText}>Verify code</Text><Ionicons name="shield-checkmark-outline" size={18} color={colors.white} /></>}</Pressable>
      <Pressable disabled={resendIn > 0 || busy} onPress={requestNewCode} style={styles.otpResend}><Text style={styles.otpResendText}>{resendIn > 0 ? `Request new code in ${resendIn}s` : "Request new code"}</Text></Pressable>
      {onBack && <Pressable onPress={onBack} style={styles.backToLogin}><Ionicons name="arrow-back" size={16} color={colors.blue} /><Text style={styles.backToLoginText}>Back</Text></Pressable>}
    </Animated.View>
  </KeyboardAvoidingView>;
}

function GpsLaunch({ name, returning, onComplete }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const vehicle = useRef(new Animated.Value(0)).current;
  const dots = useRef(new Animated.Value(0)).current;
  const [seconds, setSeconds] = useState(GPS_LAUNCH_SECONDS);
  useEffect(() => {
    const pulseLoop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }));
    pulseLoop.start();
    const vehicleLoop = Animated.loop(Animated.sequence([Animated.timing(vehicle, { toValue: 1, duration: 1800, useNativeDriver: true }), Animated.timing(vehicle, { toValue: 0, duration: 1800, useNativeDriver: true })]));
    const dotLoop = Animated.loop(Animated.timing(dots, { toValue: 3, duration: 1200, useNativeDriver: true }));
    vehicleLoop.start();
    dotLoop.start();
    const countdown = setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    const timer = setTimeout(onComplete, GPS_LAUNCH_SECONDS * 1000);
    return () => { pulseLoop.stop(); vehicleLoop.stop(); dotLoop.stop(); clearInterval(countdown); clearTimeout(timer); };
  }, [dots, onComplete, pulse, vehicle]);
  const dotStyle = index => {
    const center = .25 + index;
    return { opacity: dots.interpolate({ inputRange: [0, center - .2, center, center + .45, 3], outputRange: [.25, .25, 1, .25, .25], extrapolate: "clamp" }), transform: [{ translateY: dots.interpolate({ inputRange: [0, center - .2, center, center + .45, 3], outputRange: [0, 0, -6, 0, 0], extrapolate: "clamp" }) }] };
  };
  return <View style={styles.gpsLaunch}><StatusBar style="light" /><View style={styles.gpsActivity}><View style={styles.gpsStage}><Animated.View style={[styles.gpsRing, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.65, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [.7, 1.55] }) }] }]} /><View style={styles.gpsCore}><Ionicons name="location" size={42} color={colors.white} /></View><View style={styles.loadingRoad} /><Animated.View style={[styles.movingVehicle, styles.movingCar, { transform: [{ translateX: vehicle.interpolate({ inputRange: [0, 1], outputRange: [-70, 180] }) }] }]}><Ionicons name="car-sport" size={25} color={colors.white} /></Animated.View><Animated.View style={[styles.movingVehicle, styles.movingBike, { transform: [{ translateX: vehicle.interpolate({ inputRange: [0, 1], outputRange: [135, -135] }) }] }]}><MaterialCommunityIcons name="motorbike" size={27} color={colors.white} /></Animated.View><Animated.View style={[styles.movingVehicle, styles.movingTukTuk, { transform: [{ translateX: vehicle.interpolate({ inputRange: [0, 1], outputRange: [-180, 70] }) }] }]}><MaterialCommunityIcons name="rickshaw" size={25} color={colors.white} /></Animated.View></View><Text style={styles.gpsWelcome}>{returning ? "Welcome back" : "Welcome"}, {name || customer.name}</Text><Text style={styles.gpsTitle}>Connecting to your trackers</Text><Text style={styles.gpsText}>Please wait while we securely prepare your account. You will be redirected to the app in {seconds} second{seconds === 1 ? "" : "s"}.</Text><View style={styles.gpsDots}>{[0, 1, 2].map(index => <Animated.View key={index} style={[styles.gpsDot, dotStyle(index)]} />)}</View></View></View>;
}

function PermissionGate({ onComplete }) {
  const [checking, setChecking] = useState(false);
  const checkAndContinue = useCallback(async () => {
    setChecking(true);
    try {
      const [locationPermission, notificationPermission] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Notifications.getPermissionsAsync(),
      ]);
      if (locationPermission.status === "granted" && notificationPermission.status === "granted") onComplete();
    } finally {
      setChecking(false);
    }
  }, [onComplete]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") checkAndContinue();
    });
    return () => subscription.remove();
  }, [checkAndContinue]);
  const accept = async () => {
    await Linking.openSettings();
  };
  return <View style={styles.permissionPage}><StatusBar style="light" /><View style={styles.permissionCard}><View style={styles.permissionIcon}><Ionicons name="shield-checkmark" size={38} color={colors.white} /></View><Text style={styles.permissionTitle}>Allow Jixels Customer Trackings</Text><Text style={styles.permissionText}>Jixels Customer Trackings needs device location to show where you are on the live map and notifications to deliver tracker and payment alerts.</Text><View style={styles.permissionItem}><Ionicons name="location" size={23} color={colors.blue} /><View style={{ flex: 1 }}><Text style={styles.permissionItemTitle}>Device location</Text><Text style={styles.permissionItemText}>Show your current position on the map.</Text></View></View><View style={styles.permissionItem}><Ionicons name="notifications" size={23} color={colors.blue} /><View style={{ flex: 1 }}><Text style={styles.permissionItemTitle}>Notifications</Text><Text style={styles.permissionItemText}>Receive payment and tracking alerts.</Text></View></View><Pressable disabled={checking} onPress={accept} style={styles.primaryButton}>{checking ? <ActivityIndicator color={colors.white} /> : <><Text style={styles.primaryButtonText}>Accept and open settings</Text><Ionicons name="settings-outline" size={18} color={colors.white} /></>}</Pressable><Pressable onPress={checkAndContinue} style={styles.permissionCheck}><Text style={styles.permissionCheckText}>I have allowed both permissions</Text></Pressable></View></View>;
}

function SkeletonBlock({ style }) {
  return <View style={[styles.skeleton, { overflow: "hidden" }, style]}><Animated.View pointerEvents="none" style={[styles.skeletonShine, { transform: [{ translateX: skeletonShimmer.interpolate({ inputRange: [0, 1], outputRange: [-120, 430] }) }, { skewX: "-16deg" }] }]} /></View>;
}

function ActivitySkeleton({ screen }) {
  useEffect(() => { skeletonShimmer.setValue(0); const animation = Animated.loop(Animated.timing(skeletonShimmer, { toValue: 1, duration: 1250, useNativeDriver: true })); animation.start(); return () => animation.stop(); }, []);
  if (screen === "auth") return <View style={styles.authSkeleton}><SkeletonBlock style={styles.skeletonAuthCard} /><SkeletonBlock style={styles.skeletonLabel} />{[1, 2].map(item => <View key={item}><SkeletonBlock style={styles.skeletonSmallLabel} /><SkeletonBlock style={styles.skeletonInput} /></View>)}<SkeletonBlock style={styles.skeletonSubmit} /><SkeletonBlock style={styles.skeletonAuthFooter} /></View>;
  if (screen === "tracking") return <View style={styles.mapSkeleton}><SkeletonBlock style={styles.skeletonSearch} /><View style={styles.skeletonMapControls}>{[1, 2, 3, 4].map(item => <SkeletonBlock key={item} style={styles.skeletonMapButton} />)}</View><SkeletonBlock style={styles.skeletonMapPin} /><SkeletonBlock style={styles.skeletonMapSheet} /></View>;
  if (screen === "payments") return <View style={styles.skeletonPage}><SkeletonBlock style={styles.skeletonPaymentHero} /><SkeletonBlock style={styles.skeletonLabel} /><View style={styles.skeletonChipRow}>{[1, 2, 3].map(item => <SkeletonBlock key={item} style={styles.skeletonChip} />)}</View>{[1, 2].map(item => <View key={item}><SkeletonBlock style={styles.skeletonSmallLabel} /><SkeletonBlock style={styles.skeletonInput} /></View>)}<SkeletonBlock style={styles.skeletonNotice} /><SkeletonBlock style={styles.skeletonSubmit} /></View>;
  if (screen === "history" || screen === "alerts") return <View style={styles.skeletonListPage}>{screen === "history" && <SkeletonBlock style={styles.skeletonSummary} />}<SkeletonBlock style={styles.skeletonListHeading} />{[1, 2, 3, 4, 5].map(item => <View key={item} style={styles.skeletonListRow}><SkeletonBlock style={styles.skeletonAvatar} /><View style={styles.skeletonListBody}><SkeletonBlock style={styles.skeletonRowTitle} /><SkeletonBlock style={styles.skeletonRowText} /><SkeletonBlock style={styles.skeletonRowShort} /></View></View>)}</View>;
  if (screen === "bikes") return <View style={styles.skeletonPage}><SkeletonBlock style={styles.skeletonNotice} /><SkeletonBlock style={styles.skeletonTableHead} />{[1, 2, 3].map(item => <SkeletonBlock key={item} style={styles.skeletonTableRow} />)}</View>;
  if (screen === "settings") return <View style={styles.skeletonPage}><SkeletonBlock style={styles.skeletonProfileAvatar} /><SkeletonBlock style={styles.skeletonProfileName} /><SkeletonBlock style={styles.skeletonSettingsCard} /><SkeletonBlock style={styles.skeletonNotice} /></View>;
  return <View style={styles.skeletonPage}><SkeletonBlock style={styles.skeletonHero} /><View style={styles.skeletonGrid}><SkeletonBlock style={styles.skeletonStat} /><SkeletonBlock style={styles.skeletonStat} /><SkeletonBlock style={styles.skeletonStat} /><SkeletonBlock style={styles.skeletonStat} /></View><SkeletonBlock style={styles.skeletonTitle} /><SkeletonBlock style={styles.skeletonCard} /></View>;
}

function PaymentSuccess({ receipt, onClose }) {
  const scale = useRef(new Animated.Value(.4)).current;
  useEffect(() => { if (receipt) { nativeSuccess(); Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 170 }).start(); } }, [receipt, scale]);
  return <Modal visible={!!receipt} transparent animationType="fade" onRequestClose={onClose}><View style={styles.successOverlay}><Animated.View style={[styles.successCard, { transform: [{ scale }] }]}><View style={styles.successIcon}><Ionicons name="checkmark" size={44} color={colors.white} /></View><Text style={styles.successTitle}>{receipt?.monthlyComplete ? "Agreed instalment completed!" : "Payment confirmed!"}</Text><Text style={styles.successAmount}>{money(receipt?.amount ?? 0)}</Text><Text style={styles.successVehicle}>{receipt?.registration}</Text>{receipt?.monthlyTarget ? (receipt.monthlyComplete ? <Text style={styles.successBreakdown}>Your agreed {money(receipt.monthlyTarget)} instalment is fully paid.</Text> : <Text style={styles.successBreakdown}>{money(receipt.monthlyRemaining)} remains toward your agreed instalment.</Text>) : <Text style={styles.successBreakdown}>Your chosen payment has been applied to this vehicle.</Text>}<Text style={styles.successBalance}>Vehicle finance balance: {money(receipt?.remainingBalance ?? 0)}</Text><View style={styles.receiptBox}><Text style={styles.receiptLabel}>M-PESA RECEIPT</Text><Text style={styles.receiptId}>{receipt?.mpesaReceiptNumber}</Text><Text style={styles.receiptTime}>Confirmed now • M-Pesa</Text></View><Pressable onPress={onClose} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Done</Text></Pressable></Animated.View></View></Modal>;
}

function PullToRefresh({ onRefresh, children, style }) {
  return <RefreshControl style={style} refreshing={false} onRefresh={onRefresh} colors={[colors.blue]} tintColor={colors.blue} progressBackgroundColor={colors.white}>{children}</RefreshControl>;
}

function Drawer({ expanded, active, unread, topInset, bottomInset = 0, onToggle, onSelect, onLogout }) {
  return <View style={[styles.drawer, { top: topInset, bottom: bottomInset, width: DRAWER_OPEN }]}>
    <View style={styles.drawerTop}><Pressable accessibilityLabel="Close menu" onPress={onToggle} style={styles.drawerToggle}><Ionicons name="menu" size={23} color={colors.white} /></Pressable><Logo /></View>
    <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerMenu} showsVerticalScrollIndicator={false}>
      {menu.map(item => <Pressable accessibilityLabel={item.label} android_ripple={{ color: "rgba(255,255,255,.14)" }} key={item.key} onPress={() => onSelect(item.key)} style={[styles.drawerItem, active === item.key && styles.drawerItemActive]}><View><Ionicons name={item.icon} size={22} color={active === item.key ? colors.white : "#AFC6E0"} />{item.key === "alerts" && unread > 0 && <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{unread}</Text></View>}</View><Text numberOfLines={1} style={[styles.drawerLabel, active === item.key && styles.drawerLabelActive]}>{item.label}</Text></Pressable>)}
    </ScrollView>
    <Pressable onPress={onLogout} style={styles.logout}><Ionicons name="log-out-outline" size={22} color="#F9A8A8" /><Text style={styles.logoutText}>Sign out</Text></Pressable>
  </View>;
}

function PageHeader({ title, subtitle, expanded, onToggle, unread, onAlerts, dark }) {
  return <View style={[styles.pageHeader, dark && styles.darkHeader]}><Pressable accessibilityLabel={expanded ? "Close menu" : "Open menu"} android_ripple={{ color: "rgba(9,105,218,.14)", borderless: true }} onPress={() => { nativeTap(); onToggle(); }} style={styles.headerMenu}><Ionicons name="menu" size={23} color={dark ? colors.white : colors.blueDark} /></Pressable><View style={styles.headerTitleWrap}><Text numberOfLines={1} style={[styles.pageTitle, dark && styles.darkText]}>{title}</Text><Text numberOfLines={1} style={[styles.pageSubtitle, { fontSize: 11 }]}>{subtitle}</Text></View><Pressable android_ripple={{ color: "rgba(9,105,218,.14)", borderless: true }} onPress={() => { nativeTap(); onAlerts(); }} style={styles.headerBell}><Ionicons name="notifications-outline" size={22} color={dark ? colors.white : colors.blueDark} />{unread > 0 && <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{unread}</Text></View>}</Pressable></View>;
}

function StatusPill({ status }) {
  const meta = { online: ["Online", colors.green], stale: ["Delayed", colors.orange], offline: ["Offline", colors.gray], overdue: ["Overdue", "#DC3B2A"] }[status] ?? [status, colors.gray];
  return <View style={[styles.statusPill, { backgroundColor: `${meta[1]}16` }]}><View style={[styles.statusDot, { backgroundColor: meta[1] }]} /><Text style={[styles.statusText, { color: meta[1] }]}>{meta[0]}</Text></View>;
}

function SectionTitle({ title, action, onAction, darkMode = false }) {
  return <View style={styles.sectionTitleRow}><Text style={[styles.sectionTitle, darkMode && styles.darkText]}>{title}</Text>{action && <Pressable onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable>}</View>;
}

function Dashboard({ selectedBike, onSelectBike, navigate, totalPaid, onRefresh, profile, darkMode = false }) {
  const active = bikes.filter(b => b.status === "online").length;
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  return <ScrollView style={[styles.pageScroll, darkMode && styles.darkPage]} contentContainerStyle={styles.pageContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />} showsVerticalScrollIndicator={false}>
    <View style={styles.welcomeCard}><View style={styles.welcomeIcon}>{profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.welcomePhoto} /> : <Ionicons name="person" size={23} color={colors.white} />}</View><View style={{ flex: 1 }}><Text style={styles.eyebrow}>WELCOME BACK</Text><Text style={styles.welcomeName}>{profile.name}</Text><Text style={styles.welcomeCopy}>Your vehicles, trackers and payments are in one secure place.</Text></View></View>
    <View style={styles.statGrid}><View style={[styles.statCard, darkMode && styles.darkCard]}><View style={[styles.statIcon, { backgroundColor: colors.bluePale }]}><Ionicons name="car-sport-outline" size={22} color={colors.blue} /></View><Text style={[styles.statValue, darkMode && styles.darkText]}>{bikes.length}</Text><Text style={styles.statLabel}>My vehicles</Text></View><View style={[styles.statCard, darkMode && styles.darkCard]}><View style={[styles.statIcon, { backgroundColor: "#EAF9F2" }]}><Ionicons name="radio-outline" size={22} color={colors.green} /></View><Text style={[styles.statValue, darkMode && styles.darkText]}>{active}</Text><Text style={styles.statLabel}>Online vehicles</Text></View><View style={[styles.statCard, darkMode && styles.darkCard]}><View style={[styles.statIcon, { backgroundColor: "#FFF4E5" }]}><Ionicons name="wallet-outline" size={22} color={colors.orange} /></View><Text style={[styles.statValue, darkMode && styles.darkText]}>{money(bikes.reduce((sum, b) => sum + b.balance, 0)).replace("KES ", "")}</Text><Text style={styles.statLabel}>Balance KES</Text></View><View style={[styles.statCard, darkMode && styles.darkCard]}><View style={[styles.statIcon, { backgroundColor: "#EAF9F2" }]}><Ionicons name="checkmark-circle-outline" size={22} color={colors.green} /></View><Text style={[styles.statValue, darkMode && styles.darkText]}>{money(totalPaid).replace("KES ", "")}</Text><Text style={styles.statLabel}>Total paid KES</Text></View></View>
    <SectionTitle darkMode={darkMode} title="Selected vehicle" action={vehiclePickerOpen ? "Close" : "Change"} onAction={() => setVehiclePickerOpen(open => !open)} />
    {vehiclePickerOpen && <ScrollView style={styles.dashboardVehiclePicker} contentContainerStyle={styles.dashboardVehiclePickerContent} nestedScrollEnabled showsVerticalScrollIndicator={bikes.length > 3}>{bikes.map(vehicle => <Pressable key={vehicle.id} onPress={() => { onSelectBike(vehicle); setVehiclePickerOpen(false); }} style={[styles.dashboardVehicleOption, vehicle.id === selectedBike.id && styles.dashboardVehicleActive]}><View style={styles.vehicleDropdownIcon}>{vehicle.type === "car" ? <Ionicons name="car-sport" size={18} color={colors.blue} /> : <MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} />}</View><View style={{ flex: 1 }}><Text style={styles.vehicleDropdownPlate}>{vehicle.registration}</Text><Text style={styles.vehicleDropdownModel}>{vehicle.model}</Text></View><StatusPill status={vehicle.status} /></Pressable>)}</ScrollView>}
    <BikeCard darkMode={darkMode} bike={selectedBike} selected onTrack={() => navigate("tracking")} onPay={() => navigate("payments")} onSelect={() => onSelectBike(selectedBike)} />
  </ScrollView>;
}

function BikeCard({ bike, selected, onSelect, onTrack, onPay, darkMode = false }) {
  return <Pressable onPress={onSelect} style={[styles.card, darkMode && styles.darkCard, selected && styles.cardSelected]}><View style={styles.bikeTop}><View style={styles.bikeIcon}>{bike.type === "car" ? <Ionicons name="car-sport" size={27} color={colors.blue} /> : <MaterialCommunityIcons name="motorbike" size={27} color={colors.blue} />}</View><View style={{ flex: 1 }}><Text style={[styles.cardTitle, darkMode && styles.darkText]}>{bike.model}</Text><Text style={styles.cardSub}>{bike.registration} • Tracker {bike.tracker}</Text></View><StatusPill status={bike.status} /></View><View style={styles.financeStrip}><View><Text style={styles.microLabel}>BALANCE</Text><Text style={styles.financeValue}>{money(bike.balance)}</Text></View><View><Text style={styles.microLabel}>FINANCE</Text><Text style={[styles.financeStatus, bike.financeStatus === "Overdue" && { color: "#DC3B2A" }]}>{bike.financeStatus}</Text></View></View><Text style={styles.nextPayment}>{bike.nextPayment}</Text><View style={styles.cardActions}><Pressable onPress={onTrack} style={styles.outlineButton}><Ionicons name="navigate-outline" size={17} color={colors.blue} /><Text style={styles.outlineButtonText}>Track Vehicle</Text></Pressable><Pressable onPress={onPay} style={styles.smallPrimary}><Ionicons name="wallet-outline" size={17} color={colors.white} /><Text style={styles.smallPrimaryText}>Pay Now</Text></Pressable></View></Pressable>;
}

function BikesScreen({ selectedBike, onSelectBike, navigate, onRefresh }) {
  return <ScrollView style={styles.pageScroll} contentContainerStyle={styles.vehicleTablePage} refreshControl={<PullToRefresh onRefresh={onRefresh} />}><View style={styles.infoCallout}><Ionicons name="shield-checkmark" size={21} color={colors.blue} /><Text style={styles.infoCalloutText}>Every vehicle and action is scoped to your Jixels customer account.</Text></View><View style={styles.vehicleTable}><View style={styles.vehicleTableHeader}><Text style={[styles.vehicleHeadText, styles.vehicleColMain]}>VEHICLE</Text><Text style={[styles.vehicleHeadText, styles.vehicleColBalance]}>BALANCE</Text><Text style={[styles.vehicleHeadText, styles.vehicleColStatus]}>STATUS</Text><Text style={[styles.vehicleHeadText, styles.vehicleColNext]}>NEXT PAYMENT</Text></View>{bikes.map((bike, index) => <Pressable key={bike.id} onPress={() => { onSelectBike(bike); navigate("tracking"); }} style={[styles.vehicleRow, index < bikes.length - 1 && styles.vehicleRowBorder, bike.id === selectedBike.id && styles.vehicleRowSelected]}><View style={[styles.vehicleColMain, styles.vehicleNameCell]}>{bike.type === "car" ? <Ionicons name="car-sport" size={17} color={colors.blueDark} /> : <MaterialCommunityIcons name="motorbike" size={18} color={colors.blueDark} />}<View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.vehiclePlate}>{bike.registration}</Text><Text numberOfLines={1} style={styles.vehicleModel}>{bike.model}</Text></View></View><Text numberOfLines={1} style={[styles.vehicleCellText, styles.vehicleColBalance]}>{money(bike.balance).replace("KES ", "")}</Text><View style={styles.vehicleColStatus}><View style={[styles.tableStatusDot, { backgroundColor: bike.status === "online" ? colors.green : colors.orange }]} /><Text style={[styles.tableStatusText, { color: bike.status === "online" ? colors.green : colors.orange }]}>{bike.status === "online" ? "Online" : "Delayed"}</Text></View><Text numberOfLines={2} style={[styles.vehicleNextText, styles.vehicleColNext]}>{bike.nextPayment.replace("KES ", "")}</Text></Pressable>)}</View><Text style={styles.tableHint}>Tap a vehicle to open its live tracking map.</Text></ScrollView>;
}

function PaymentScreen({ selectedBike, paymentVehicles = bikes, onSelectBike, onPaid, onRefresh, registeredPhone, isOnline }) {
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState(() => registeredPhone.replace(/\s/g, ""));
  const [busy, setBusy] = useState(false);
  const paymentAttempt = useRef(null);
  useEffect(() => { setPhone(registeredPhone.replace(/\s/g, "")); }, [registeredPhone]);
  useEffect(() => { paymentAttempt.current = null; }, [selectedBike.id]);
  const pay = async () => {
    if (!isOnline) return Alert.alert("You are offline", "M-Pesa requests require internet. Connect and try again later, or use the official Jixels PayBill.");
    const numeric = Number(amount);
    const payerPhone = normalizeKenyanMpesaPhone(phone);
    if (!numeric || numeric <= 0) return Alert.alert("Enter an amount", "Enter the amount you want to pay.");
    if (!payerPhone) return Alert.alert("Check M-Pesa number", "Enter a valid Kenyan number such as 0712 345 678 or 254712345678.");
    if (!paymentAttempt.current) paymentAttempt.current = newIdempotencyKey(selectedBike.id);
    setBusy(true);
    try {
      const accepted = await onPaid(numeric, payerPhone, paymentAttempt.current);
      if (accepted !== false) { setAmount(""); paymentAttempt.current = null; }
    } finally {
      setBusy(false);
    }
  };
  return <ScrollView style={styles.pageScroll} contentContainerStyle={styles.pageContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />} keyboardShouldPersistTaps="handled"><View style={styles.paymentHero}><Text style={styles.eyebrow}>VEHICLE-SPECIFIC PAYMENT</Text><Text style={styles.paymentBike}>{selectedBike.registration}</Text><Text style={styles.paymentModel}>{selectedBike.model}</Text><View style={styles.balanceRow}><Text style={styles.balanceLabel}>Outstanding balance</Text><Text style={styles.balanceValue}>{money(selectedBike.balance)}</Text></View></View><Text style={styles.fieldLabel}>Choose one vehicle for this payment</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bikeChips}>{paymentVehicles.map(b => <Pressable key={b.id} onPress={() => onSelectBike(b)} style={[styles.bikeChip, selectedBike.id === b.id && styles.bikeChipActive]}><Text style={[styles.bikeChipText, selectedBike.id === b.id && styles.bikeChipTextActive]}>{b.registration}</Text></Pressable>)}</ScrollView>{Number(selectedBike.monthlyPayment) > 0 && <View style={styles.agreedPaymentNote}><Text style={styles.microLabel}>AGREED INSTALMENT</Text><Text style={styles.agreedPaymentValue}>{money(selectedBike.monthlyPayment)}</Text></View>}<Field icon="cash-outline" label="Amount you want to pay (KES)" placeholder="Enter payment amount" keyboardType="numeric" value={amount} onChangeText={setAmount} /><Field icon="call-outline" label="M-Pesa number to receive the prompt" placeholder="07++++++++++" keyboardType="phone-pad" value={phone} onChangeText={setPhone} /><Text style={styles.payerPhoneHint}>Use your registered number or enter another person’s M-Pesa number with their permission.</Text><View style={styles.secureNote}><Ionicons name={isOnline ? "phone-portrait-outline" : "cloud-offline-outline"} size={16} color={isOnline ? colors.green : colors.orange} /><Text style={styles.secureNoteText}>{isOnline ? "The STK prompt goes to the number above. After that person confirms with their M-Pesa PIN, the payment is linked to this selected vehicle." : "You are offline. Connect to the internet and make the payment later, or use the official Jixels PayBill."}</Text></View><Pressable disabled={busy || !isOnline} onPress={pay} style={[styles.primaryButton, !isOnline && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <><Text style={styles.primaryButtonText}>{isOnline ? "Send M-Pesa prompt" : "Payment unavailable offline"}</Text><Ionicons name={isOnline ? "arrow-forward" : "cloud-offline-outline"} size={18} color={colors.white} /></>}</Pressable></ScrollView>;
}

function HistoryScreen({ payments, deletePayments, onRefresh, darkMode = false }) {
  const [selected, setSelected] = useState(() => new Set());
  const [activePayment, setActivePayment] = useState(null);
  const selecting = selected.size > 0;
  useEffect(() => {
    if (Platform.OS !== "android" || !selecting) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(new Set());
      return true;
    });
    return () => subscription.remove();
  }, [selecting]);
  const toggle = id => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const removeSelected = () => { deletePayments([...selected]); setSelected(new Set()); };
  const confirmedTotal = payments.filter(payment => payment.status === "Confirmed").reduce((sum, payment) => sum + payment.amount, 0);
  const detailMessage = activePayment?.notificationMessage ?? (activePayment ? `${money(activePayment.amount)} payment for ${activePayment.registration ?? bikes.find(vehicle => vehicle.id === activePayment.bikeId)?.registration ?? "your vehicle"} was ${activePayment.status === "Confirmed" ? "received and confirmed" : "submitted for processing"}. M-Pesa receipt ${activePayment.mpesaReceiptNumber}.` : "");
  return <>
    <ScrollView style={[styles.nativeListPage, darkMode && styles.darkPage]} contentContainerStyle={styles.nativeListContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />}>
      <View style={styles.nativeSummary}><View><Text style={styles.nativeSummaryLabel}>TOTAL PAID</Text><Text style={styles.nativeSummaryValue}>{money(confirmedTotal)}</Text><Text style={styles.nativeSummaryMeta}>{payments.length} recent transactions</Text></View><View style={styles.nativeSummaryIcon}><Ionicons name="wallet" size={25} color={colors.white} /></View></View>
      <View style={styles.nativeListToolbar}>{selecting ? <><View><Text style={[styles.nativeListHeading, darkMode && styles.darkText]}>{selected.size} selected</Text><Text style={styles.nativeToolbarSub}>Tap payments to add or remove</Text></View><View style={styles.selectionActions}><Pressable onPress={() => setSelected(new Set(payments.map(payment => payment.id)))} style={styles.selectionButton}><Ionicons name="checkbox-outline" size={18} color={colors.blue} /><Text style={styles.markReadText}>All</Text></Pressable><Pressable onPress={removeSelected} style={[styles.selectionButton, styles.deleteButton]}><Ionicons name="trash-outline" size={18} color="#DC3B2A" /><Text style={styles.deleteText}>Delete</Text></Pressable></View></> : <View><Text style={[styles.nativeListHeading, darkMode && styles.darkText]}>Payment activity</Text><Text style={styles.nativeToolbarSub}>Tap to read • Hold to select</Text></View>}</View>
      <View style={[styles.nativeList, darkMode && styles.darkCard]}>{payments.map((payment, index) => { const bike = bikes.find(vehicle => vehicle.id === payment.bikeId); const pending = payment.status !== "Confirmed"; const checked = selected.has(payment.id); return <Pressable key={payment.id} delayLongPress={700} onLongPress={() => toggle(payment.id)} onPress={() => selecting ? toggle(payment.id) : setActivePayment({ ...payment, registration: payment.registration ?? bike?.registration })} style={[styles.nativeRow, index < payments.length - 1 && styles.nativeRowDivider, checked && styles.nativeRowSelected]}>{selecting && <View style={[styles.selectionCheck, checked && styles.selectionCheckActive]}>{checked && <Ionicons name="checkmark" size={15} color={colors.white} />}</View>}<View style={[styles.nativeAvatar, pending && styles.nativeAvatarOrange]}><Ionicons name={pending ? "cloud-upload-outline" : "checkmark"} size={22} color={colors.white} /></View><View style={styles.nativeRowBody}><Text numberOfLines={1} style={[styles.nativeRowTitle, darkMode && styles.darkText]}>{bike?.registration ?? payment.registration}</Text><Text numberOfLines={1} style={styles.nativeRowMessage}>{payment.notificationMessage ?? `${payment.mpesaReceiptNumber} • M-Pesa`}</Text><Text style={[styles.nativeRowStatus, pending && { color: colors.orange }]}>{payment.status}</Text></View><View style={styles.paymentRowMeta}><Text numberOfLines={1} style={styles.nativeRowTime}>{payment.date}</Text><Text numberOfLines={1} style={styles.nativeRowAmount}>{money(payment.amount)}</Text></View></Pressable>; })}{payments.length === 0 && <View style={styles.emptyAlerts}><Ionicons name="receipt-outline" size={34} color={colors.gray} /><Text style={styles.stateMessage}>No payment activity</Text></View>}</View>
    </ScrollView>
    <Modal visible={!!activePayment} transparent animationType="slide" onRequestClose={() => setActivePayment(null)}><View style={styles.paymentMessageOverlay}><Pressable style={styles.paymentMessageBackdrop} onPress={() => setActivePayment(null)} /><View style={styles.paymentMessageSheet}><View style={styles.paymentMessageHandle} /><View style={styles.paymentMessageSender}><View style={styles.paymentMessageLogo}><Ionicons name="wallet" size={24} color={colors.white} /></View><View style={{ flex: 1 }}><Text style={styles.paymentMessageSenderName}>Jixels Customer Trackings</Text><Text style={styles.paymentMessageSenderMeta}>Payment notification • {activePayment?.date}</Text></View><Pressable onPress={() => setActivePayment(null)} style={styles.paymentMessageClose}><Ionicons name="close" size={22} color={colors.ink} /></Pressable></View><View style={styles.paymentMessageBubble}><Text style={styles.paymentMessageText}>{detailMessage}</Text><Text style={styles.paymentMessageTime}>{activePayment?.date} • {activePayment?.status}</Text></View><View style={styles.paymentMessageReceipt}><View><Text style={styles.receiptLabel}>M-PESA RECEIPT</Text><Text style={styles.paymentMessageReceiptId}>{activePayment?.mpesaReceiptNumber}</Text></View><View style={styles.paymentMessageAmountWrap}><Text style={styles.receiptLabel}>AMOUNT</Text><Text style={styles.paymentMessageAmount}>{money(activePayment?.amount ?? 0)}</Text></View></View>{activePayment?.remainingBalance != null && <View style={styles.paymentMessageBalance}><Text style={styles.nativeRowMessage}>Vehicle finance balance</Text><Text style={styles.nativeRowTitle}>{money(activePayment.remainingBalance)}</Text></View>}</View></View></Modal>
  </>;
}

function AlertsScreen({ alerts, markAllRead, markAlertRead, deleteAlerts, onRefresh, darkMode = false }) {
  const [selected, setSelected] = useState(() => new Set());
  const [activeAlert, setActiveAlert] = useState(null);
  const selecting = selected.size > 0;
  useEffect(() => {
    if (Platform.OS !== "android" || !selecting) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(new Set());
      return true;
    });
    return () => subscription.remove();
  }, [selecting]);
  const toggle = id => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const removeSelected = () => { deleteAlerts([...selected]); setSelected(new Set()); };
  const openAlert = alert => { markAlertRead(alert.id); setActiveAlert(alert); };
  return <>
    <ScrollView style={[styles.nativeListPage, darkMode && styles.darkPage]} contentContainerStyle={styles.nativeListContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />}>
      <View style={styles.nativeListToolbar}>{selecting ? <><View><Text style={[styles.nativeListHeading, darkMode && styles.darkText]}>{selected.size} selected</Text><Text style={styles.nativeToolbarSub}>Tap notifications to add or remove</Text></View><View style={styles.selectionActions}><Pressable onPress={() => setSelected(new Set(alerts.map(alert => alert.id)))} style={styles.selectionButton}><Ionicons name="checkbox-outline" size={18} color={colors.blue} /><Text style={styles.markReadText}>All</Text></Pressable><Pressable onPress={removeSelected} style={[styles.selectionButton, styles.deleteButton]}><Ionicons name="trash-outline" size={18} color="#DC3B2A" /><Text style={styles.deleteText}>Delete</Text></Pressable></View></> : <><View><Text style={[styles.nativeListHeading, darkMode && styles.darkText]}>Recent notifications</Text><Text style={styles.nativeToolbarSub}>Tap to read • Hold to select</Text></View><Pressable onPress={markAllRead} style={styles.markReadButton}><Ionicons name="checkmark-done" size={18} color={colors.blue} /><Text style={styles.markReadText}>Read all</Text></Pressable></>}</View>
      <View style={[styles.nativeList, darkMode && styles.darkCard]}>{alerts.map((alert, index) => { const checked = selected.has(alert.id); return <Pressable key={alert.id} delayLongPress={900} onLongPress={() => toggle(alert.id)} onPress={() => selecting ? toggle(alert.id) : openAlert(alert)} style={[styles.nativeRow, index < alerts.length - 1 && styles.nativeRowDivider, alert.unread && !darkMode && styles.nativeRowUnread, checked && styles.nativeRowSelected]}>{selecting && <View style={[styles.selectionCheck, checked && styles.selectionCheckActive]}>{checked && <Ionicons name="checkmark" size={15} color={colors.white} />}</View>}<View style={[styles.nativeAvatar, alert.type === "payment" ? styles.nativeAvatarOrange : alert.type === "receipt" ? styles.nativeAvatarGreen : null]}><Ionicons name={alert.icon} size={22} color={colors.white} /></View><View style={styles.nativeRowBody}><View style={styles.nativeRowTop}><Text numberOfLines={1} style={[styles.nativeRowTitle, darkMode && styles.darkText]}>{alert.title}</Text><Text style={styles.nativeRowTime}>{alert.age}</Text></View><Text numberOfLines={2} style={styles.nativeRowMessage}>{alert.message}</Text></View>{alert.unread && !selecting && <View style={styles.nativeUnreadBadge}><Text style={styles.nativeUnreadText}>1</Text></View>}</Pressable>; })}{alerts.length === 0 && <View style={styles.emptyAlerts}><Ionicons name="notifications-off-outline" size={34} color={colors.gray} /><Text style={styles.stateMessage}>No notifications</Text></View>}</View>
    </ScrollView>
    <Modal visible={!!activeAlert} transparent animationType="slide" onRequestClose={() => setActiveAlert(null)}><View style={styles.paymentMessageOverlay}><Pressable style={styles.paymentMessageBackdrop} onPress={() => setActiveAlert(null)} /><View style={styles.paymentMessageSheet}><View style={styles.paymentMessageHandle} /><View style={styles.paymentMessageSender}><View style={styles.paymentMessageLogo}><Ionicons name="notifications" size={24} color={colors.white} /></View><View style={{ flex: 1 }}><Text style={styles.paymentMessageSenderName}>Jixels Customer Trackings</Text><Text style={styles.paymentMessageSenderMeta}>Account notification • {activeAlert?.age}</Text></View><Pressable onPress={() => setActiveAlert(null)} style={styles.paymentMessageClose}><Ionicons name="close" size={22} color={colors.ink} /></Pressable></View><View style={styles.paymentMessageBubble}><Text style={styles.nativeRowTitle}>{activeAlert?.title}</Text><Text style={[styles.paymentMessageText, { marginTop: 8 }]}>{activeAlert?.message}</Text><Text style={styles.paymentMessageTime}>{activeAlert?.age}</Text></View></View></View></Modal>
  </>;
}

function MonitoringScreen({ selectedBike, vehicles, onSelectBike, security, onMonitoringChange, onImmobilizerChange, onRefresh, isOnline }) {
  const state = security[selectedBike.id] ?? {};
  const armed = state.monitoringArmed ?? selectedBike.monitoringArmed ?? true;
  const immobilized = state.immobilized ?? selectedBike.immobilized ?? false;
  const tampered = (state.tamperStatus ?? selectedBike.tamperStatus) === "tampered";
  const orderedVehicles = [...vehicles].sort((a, b) => Number((security[b.id]?.tamperStatus ?? b.tamperStatus) === "tampered") - Number((security[a.id]?.tamperStatus ?? a.tamperStatus) === "tampered"));
  const tamperedVehicles = orderedVehicles.filter(vehicle => (security[vehicle.id]?.tamperStatus ?? vehicle.tamperStatus) === "tampered");
  const [busy, setBusy] = useState(null);
  const changeMonitoring = value => Alert.alert(
    value ? "Arm vehicle monitoring?" : "Disarm vehicle monitoring?",
    value ? "Movement, ignition and tracker-tamper alerts will be active." : "Live GPS remains powered, but movement alerts will be paused. The tracker is never switched off.",
    [{ text: "Cancel", style: "cancel" }, { text: value ? "Arm" : "Disarm", style: value ? "default" : "destructive", onPress: async () => { setBusy("monitoring"); await onMonitoringChange(selectedBike, value); setBusy(null); } }],
  );
  const changeImmobilizer = value => Alert.alert(
    value ? "Immobilize vehicle?" : "Allow engine start?",
    value ? "For safety, the command is accepted only after the tracker confirms the vehicle is stationary and ignition is off." : "This will allow the engine to start. GPS monitoring remains active.",
    [{ text: "Cancel", style: "cancel" }, { text: value ? "Immobilize" : "Allow", style: value ? "destructive" : "default", onPress: async () => { setBusy("immobilizer"); await onImmobilizerChange(selectedBike, value); setBusy(null); } }],
  );
  return <ScrollView style={styles.pageScroll} contentContainerStyle={styles.pageContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />}>
    <View style={styles.monitorHero}><Ionicons name="shield-checkmark" size={34} color={colors.white} /><View style={{ flex: 1 }}><Text style={styles.monitorHeroTitle}>Vehicle security controls</Text><Text style={styles.monitorHeroText}>GPS stays powered so Jixels can preserve location evidence.</Text></View></View>
    {tamperedVehicles.length > 0 && <View style={[styles.tamperCard, styles.tamperCardDanger]}><Ionicons name="warning" size={25} color="#DC3B2A" /><View style={{ flex: 1 }}><Text style={styles.monitorTitle}>{tamperedVehicles.length} tampered tracker{tamperedVehicles.length === 1 ? "" : "s"} detected</Text><Text style={styles.monitorCopy}>Affected vehicles are shown first below. Select one to see its last trusted location.</Text></View></View>}
    <Text style={styles.fieldLabel}>Choose vehicle</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bikeChips}>{orderedVehicles.map(vehicle => { const vehicleTampered = (security[vehicle.id]?.tamperStatus ?? vehicle.tamperStatus) === "tampered"; return <Pressable key={vehicle.id} onPress={() => onSelectBike(vehicle)} style={[styles.bikeChip, selectedBike.id === vehicle.id && styles.bikeChipActive, vehicleTampered && styles.monitorVehicleTampered]}><Text style={[styles.bikeChipText, selectedBike.id === vehicle.id && styles.bikeChipTextActive, vehicleTampered && selectedBike.id !== vehicle.id && { color: "#DC3B2A" }]}>{vehicle.registration}{vehicleTampered ? " • TAMPER" : ""}</Text></Pressable>; })}</ScrollView>
    <View style={styles.monitorCard}><View style={styles.monitorRow}><View style={styles.monitorIcon}><Ionicons name="notifications-outline" size={22} color={colors.blue} /></View><View style={{ flex: 1 }}><Text style={styles.monitorTitle}>Monitoring</Text><Text style={styles.monitorCopy}>{armed ? "Armed — movement and tamper alerts active" : "Disarmed — GPS remains online"}</Text></View>{busy === "monitoring" ? <ActivityIndicator color={colors.blue} /> : <Switch value={armed} onValueChange={changeMonitoring} trackColor={{ false: "#CBD5E1", true: "#86B9F1" }} thumbColor={armed ? colors.blue : "#F8FAFC"} />}</View>
      <View style={styles.monitorDivider} /><View style={styles.monitorRow}><View style={[styles.monitorIcon, { backgroundColor: immobilized ? "#FEECEC" : "#EAF9F2" }]}><Ionicons name={immobilized ? "lock-closed" : "lock-open-outline"} size={22} color={immobilized ? "#DC3B2A" : colors.green} /></View><View style={{ flex: 1 }}><Text style={styles.monitorTitle}>Engine immobilizer</Text><Text style={styles.monitorCopy}>{immobilized ? "Immobilized — engine start blocked" : "Released — vehicle can start normally"}</Text></View>{busy === "immobilizer" ? <ActivityIndicator color={colors.blue} /> : <Switch disabled={!isOnline} value={immobilized} onValueChange={changeImmobilizer} trackColor={{ false: "#CBD5E1", true: "#F5A3A3" }} thumbColor={immobilized ? "#DC3B2A" : "#F8FAFC"} />}</View></View>
    <View style={[styles.tamperCard, tampered && styles.tamperCardDanger]}><Ionicons name={tampered ? "warning" : "hardware-chip-outline"} size={25} color={tampered ? "#DC3B2A" : colors.green} /><View style={{ flex: 1 }}><Text style={styles.monitorTitle}>{tampered ? "Tracker tamper detected" : "Tracker hardware secure"}</Text><Text style={styles.monitorCopy}>{tampered ? `Last trusted point: ${state.lastTrustedAddress ?? "Open Live Tracking for coordinates"}` : "Power, enclosure, antenna and heartbeat checks are normal."}</Text></View></View>
    <View style={styles.infoCallout}><Ionicons name="information-circle-outline" size={21} color={colors.blue} /><Text style={styles.infoCalloutText}>Physical removal detection requires tracker hardware with backup battery, enclosure/ignition tamper wires, power-loss and antenna alerts, periodic heartbeats, and server-side anomaly rules. The app displays those verified events and the last trusted GPS point.</Text></View>
  </ScrollView>;
}

function ReportsScreen({ profile, selectedBike, vehicles, onSelectBike, onGenerate, onRefresh, isOnline }) {
  const [routeDate, setRouteDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportPeriod, setReportPeriod] = useState("daily");
  const [bikePickerOpen, setBikePickerOpen] = useState(false);
  const [bikeSearch, setBikeSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const matchingVehicles = vehicles.filter(vehicle => `${vehicle.registration} ${vehicle.model} ${vehicle.tracker}`.toLowerCase().includes(bikeSearch.trim().toLowerCase()));
  const generate = async () => {
    if (!isOnline) return Alert.alert("You are offline", "Connect to the internet to download the password-protected report.");
    setBusy(true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) { setBusy(false); return Alert.alert("Check date", "Enter the route date as YYYY-MM-DD."); }
    const generated = await onGenerate(routeDate, "routes", selectedBike, { periodName: reportPeriod, routeDate });
    setBusy(false);
    if (generated) setReport(generated);
  };
  const openReport = async () => {
    if (!report?.uri) return;
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(report.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    else await Linking.openURL(report.uri);
  };
  return <><ScrollView style={styles.pageScroll} contentContainerStyle={styles.pageContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />} keyboardShouldPersistTaps="handled">
    <View style={styles.reportHero}><View style={styles.reportHeroIcon}><Ionicons name="map" size={31} color={colors.white} /></View><Text style={styles.reportHeroTitle}>Route report</Text><Text style={styles.reportHeroText}>Download where the selected bike travelled for the selected period, including route points, distance, stops and the last recorded position.</Text></View>
    <View style={styles.settingsSection}>
      <Text style={styles.settingsTitle}>Bike, period and travel date</Text>
      <Text style={styles.fieldLabel}>Choose bike</Text>
      <View style={styles.reportBikePicker}><Pressable onPress={() => setBikePickerOpen(open => !open)} style={styles.reportBikePickerButton}><View style={styles.vehicleDropdownIcon}><MaterialCommunityIcons name="motorbike" size={20} color={colors.blue} /></View><View style={{ flex: 1 }}><Text style={styles.vehicleDropdownPlate}>{selectedBike.registration}</Text><Text style={styles.vehicleDropdownModel}>{selectedBike.model} • Tracker {selectedBike.tracker}</Text></View><Ionicons name={bikePickerOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.gray} /></Pressable>{bikePickerOpen && <View style={styles.reportBikeDropdown}><View style={styles.reportBikeSearch}><Ionicons name="search" size={18} color={colors.gray} /><TextInput value={bikeSearch} onChangeText={setBikeSearch} placeholder="Search registration, model or tracker" placeholderTextColor="#94A3B8" autoCapitalize="characters" style={styles.reportBikeSearchInput} /></View><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.reportBikeList} showsVerticalScrollIndicator>{matchingVehicles.map(vehicle => <Pressable key={vehicle.id} onPress={() => { onSelectBike(vehicle); setBikePickerOpen(false); setBikeSearch(""); }} style={[styles.reportBikeOption, selectedBike.id === vehicle.id && styles.reportBikeOptionActive]}><View style={styles.vehicleDropdownIcon}><MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} /></View><View style={{ flex: 1 }}><Text style={styles.vehicleDropdownPlate}>{vehicle.registration}</Text><Text style={styles.vehicleDropdownModel}>{vehicle.model} • Tracker {vehicle.tracker}</Text></View>{selectedBike.id === vehicle.id && <Ionicons name="checkmark-circle" size={20} color={colors.blue} />}</Pressable>)}{matchingVehicles.length === 0 && <Text style={styles.noVehicleText}>No bike matches your search.</Text>}</ScrollView></View>}</View>
      <Field icon="calendar-outline" label="Route date (YYYY-MM-DD)" value={routeDate} onChangeText={setRouteDate} placeholder="2026-08-24" />
      <Text style={styles.fieldLabel}>Report period</Text>
      <View style={styles.reportPeriods}>
        {reportPeriods.map(period => <Pressable key={period.key} onPress={() => setReportPeriod(period.key)} style={[styles.reportPeriod, reportPeriod === period.key && styles.reportPeriodActive]}>
          <Ionicons name={period.icon} size={18} color={reportPeriod === period.key ? colors.blueDark : colors.gray} />
          <Text style={[styles.reportPeriodText, reportPeriod === period.key && styles.reportPeriodTextActive]}>{period.label}</Text>
        </Pressable>)}
      </View>
    </View>
    <View style={styles.settingsSection}><Text style={styles.settingsTitle}>Secure download</Text><Text style={styles.settingsCopy}>The route PDF is protected and available only to the signed-in owner.</Text><Pressable disabled={busy || !isOnline} onPress={generate} style={[styles.primaryButton, !isOnline && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <><Ionicons name="download-outline" size={18} color={colors.white} /><Text style={styles.primaryButtonText}>Download route report</Text></>}</Pressable></View>
  </ScrollView><Modal visible={!!report} transparent animationType="fade" onRequestClose={() => setReport(null)}><View style={styles.successOverlay}><View style={styles.successCard}><View style={styles.successIcon}><Ionicons name="checkmark" size={44} color={colors.white} /></View><Text style={styles.successTitle}>Downloaded successfully</Text><Text style={styles.reportSuccessMessage}>Tap view to open or share the route report.</Text><View style={styles.receiptBox}><Text style={styles.receiptLabel}>DOCUMENT</Text><Text style={styles.reportSuccessEmail}>{report?.name}</Text></View><Pressable onPress={openReport} style={styles.primaryButton}><Ionicons name="open-outline" size={18} color={colors.white} /><Text style={styles.primaryButtonText}>View document</Text></Pressable><Pressable onPress={() => setReport(null)} style={styles.approvalSecondary}><Text style={styles.backToLoginText}>Close</Text></Pressable></View></View></Modal></>;
}

function SettingsScreen({ profile, onSave, onRefresh }) {
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [photoBusy, setPhotoBusy] = useState(false);
  const themeMode = profile.themeMode ?? "light";
  const onThemeChange = mode => onSave({ ...profile, themeMode: mode });
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "J";
  const choosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: .8 });
    if (result.canceled || !result.assets[0]?.uri) return;
    setPhotoBusy(true);
    try {
      const photoUri = await saveProfilePhoto(result.assets[0].uri);
      onSave({ ...profile, photoUri });
    } catch {
      Alert.alert("Photo not saved", "Choose the profile photo again.");
    } finally {
      setPhotoBusy(false);
    }
  };
  const save = () => {
    if (name.trim().length < 2) return Alert.alert("Check your name", "Enter your full name.");
    if (!/^\+?[0-9\s-]{9,15}$/.test(phone.trim())) return Alert.alert("Check phone number", "Enter a valid phone number.");
    onSave({ ...profile, name: name.trim(), phone: phone.trim() });
    Alert.alert("Profile updated", "Your name and phone number have been saved.");
  };
  return <ScrollView style={[styles.pageScroll, themeMode === "dark" && styles.darkPage]} contentContainerStyle={styles.pageContent} refreshControl={<PullToRefresh onRefresh={onRefresh} />} keyboardShouldPersistTaps="handled"><View style={styles.profileHero}><View style={styles.avatar}>{profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.profilePhoto} /> : <Text style={styles.avatarText}>{initials}</Text>}</View><View style={styles.photoActions}><Pressable disabled={photoBusy} onPress={choosePhoto} style={styles.photoButton}>{photoBusy ? <ActivityIndicator color={colors.blue} size="small" /> : <Ionicons name="camera-outline" size={16} color={colors.blue} />}<Text style={styles.photoButtonText}>{profile.photoUri ? "Change photo" : "Add photo"}</Text></Pressable>{profile.photoUri && <Pressable onPress={() => onSave({ ...profile, photoUri: null })} style={styles.removePhotoButton}><Text style={styles.removePhotoText}>Remove</Text></Pressable>}</View><Text style={[styles.profileName, themeMode === "dark" && styles.darkText]}>{name || profile.name}</Text><Text style={styles.profileId}>Customer ID • JX-20481</Text></View><View style={[styles.settingsSection, themeMode === "dark" && styles.darkCard]}><Text style={[styles.settingsTitle, themeMode === "dark" && styles.darkText]}>Appearance</Text><Text style={styles.settingsCopy}>Choose how the customer app looks on this device.</Text><View style={styles.themeOptions}>{[["light", "sunny-outline", "Light"], ["dark", "moon-outline", "Dark"]].map(option => <Pressable key={option[0]} onPress={() => onThemeChange(option[0])} style={[styles.themeOption, themeMode === option[0] && styles.themeOptionActive]}><Ionicons name={option[1]} size={20} color={themeMode === option[0] ? colors.white : colors.blueDark} /><Text style={[styles.themeOptionText, themeMode === option[0] && styles.themeOptionTextActive]}>{option[2]}</Text></Pressable>)}</View></View><View style={[styles.settingsSection, themeMode === "dark" && styles.darkCard]}><Text style={[styles.settingsTitle, themeMode === "dark" && styles.darkText]}>Profile details</Text><Text style={styles.settingsCopy}>Update the contact details used on your Jixels account.</Text><Field icon="person-outline" label="Full name" placeholder="Full name" value={name} onChangeText={setName} /><Field icon="call-outline" label="Phone number" placeholder="07++++++++++" keyboardType="phone-pad" value={phone} onChangeText={setPhone} /><View style={styles.readonlyField}><Ionicons name="mail-outline" size={18} color={colors.gray} /><View style={{ flex: 1 }}><Text style={styles.microLabel}>EMAIL ADDRESS</Text><Text style={styles.profileValue}>{profile.email}</Text></View><Ionicons name="lock-closed" size={15} color={colors.gray} /></View><Pressable onPress={save} style={styles.primaryButton}><Ionicons name="save-outline" size={18} color={colors.white} /><Text style={styles.primaryButtonText}>Save profile</Text></Pressable></View><View style={styles.infoCallout}><Ionicons name="shield-checkmark" size={20} color={colors.green} /><Text style={styles.infoCalloutText}>Email and account access changes require secure verification by Jixels.</Text></View></ScrollView>;
}

const RoundButton = memo(function RoundButton({ icon, label, onPress, active, children }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.roundButton, active && styles.roundButtonActive, pressed && styles.buttonPressed]}>{children ?? <Ionicons name={icon} size={20} color={active ? colors.white : colors.blue} />}</Pressable>; });

function PhoneLocationTrackingScreen() {
  const mapRef = useRef(null);
  const [phoneLocation, setPhoneLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [locating, setLocating] = useState(false);
  const readPhoneLocation = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow location access to show your current position.");
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const point = { latitude: result.coords.latitude, longitude: result.coords.longitude };
      setPhoneLocation(point);
      requestAnimationFrame(() => mapRef.current?.animateCamera({ center: point, zoom: 16 }, { duration: 700 }));
    } catch (cause) {
      setLocationError(cause instanceof Error ? cause.message : "Your phone location is currently unavailable.");
    } finally {
      setLocating(false);
    }
  }, []);
  const locatePhone = useCallback(() => {
    Alert.alert("Show your current location?", "Jixels uses your phone location only to place you on the live map and help you compare your position with your vehicles. It does not replace or change any vehicle tracker location.", [{ text: "Not now", style: "cancel" }, { text: "Allow location", onPress: readPhoneLocation }]);
  }, [readPhoneLocation]);
  useEffect(() => { locatePhone(); }, [locatePhone]);
  const center = phoneLocation ?? { latitude: 0.0236, longitude: 37.9062 };
  return <View style={styles.mapContainer}><MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={{ ...center, latitudeDelta: phoneLocation ? .08 : 7.5, longitudeDelta: phoneLocation ? .08 : 7.5 }} showsCompass showsMyLocationButton={false}>{phoneLocation && <Marker coordinate={phoneLocation} title="Your current location"><View style={styles.phoneMarker}><View style={styles.phoneMarkerInner} /></View></Marker>}</MapView><View style={styles.noVehicleMapCard}><View style={styles.waitingTrackerIcon}><Ionicons name="location" size={22} color={colors.blue} /></View><View style={{ flex: 1 }}><Text style={styles.waitingTrackerTitle}>{phoneLocation ? "Your current location" : "Finding your location"}</Text><Text style={styles.waitingTrackerText}>{locationError ?? "No vehicle is linked yet. After a tracker-equipped vehicle is added to your account, it will appear here automatically."}</Text></View></View><View style={styles.mapControls}><RoundButton label="Find my location" onPress={locatePhone}>{locating ? <ActivityIndicator size="small" color={colors.blue} /> : <Ionicons name="locate" size={20} color={colors.blue} />}</RoundButton></View></View>;
}

function TrackingScreen({ selectedBike, onSelectBike, accessToken }) {
  const mapRef = useRef(null);
  const sheetY = useRef(new Animated.Value(0)).current;
  const refreshSpin = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState("Today");
  const [mapType, setMapType] = useState("standard");
  const [phoneLocation, setPhoneLocation] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [vehicleSearch, setVehicleSearch] = useState(`${selectedBike.registration} • ${selectedBike.model}`);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const { motorcycle, route, setRoute, loading, routeLoading, error, refresh, loadRoute } = useTracking({ motorcycleId: selectedBike.id, accessToken });
  const bike = motorcycle ? { ...motorcycle, model: selectedBike.model, registrationNumber: selectedBike.registration } : null;
  const marker = useRef(new AnimatedRegion({ latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0 })).current;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (bike?.location) marker.timing({ latitude: bike.location.latitude, longitude: bike.location.longitude, duration: 900, useNativeDriver: false }).start(); }, [bike?.location?.latitude, bike?.location?.longitude, marker]);
  useEffect(() => { if (!loading && bike?.location) requestAnimationFrame(() => mapRef.current?.animateCamera({ center: bike.location, zoom: 16 }, { duration: 700 })); }, [selectedBike.id, loading]);
  useEffect(() => {
    let active = true;
    Location.getForegroundPermissionsAsync().then(async permission => {
      if (permission.status !== "granted") return;
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (active) setPhoneLocation({ latitude: result.coords.latitude, longitude: result.coords.longitude });
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const location = bike?.location ?? { latitude: 0, longitude: 0 };
  const status = trackerState(bike?.location?.recordedAt ?? new Date(0).toISOString());
  const gpsAccuracy = Number.isFinite(Number(bike?.location?.accuracyMeters)) ? Math.round(Number(bike.location.accuracyMeters)) : null;
  const gpsQuality = gpsAccuracy == null ? "Unavailable" : gpsAccuracy <= 5 ? "Excellent" : gpsAccuracy <= 10 ? "Good" : gpsAccuracy <= 25 ? "Fair" : "Poor";
  const gpsQualityColor = gpsAccuracy == null ? colors.gray : gpsAccuracy <= 10 ? colors.green : gpsAccuracy <= 25 ? colors.orange : "#DC3B2A";
  const routeCoordinates = useMemo(() => route?.points?.map(({ latitude, longitude }) => ({ latitude, longitude })) ?? [], [route]);
  const matchingVehicles = useMemo(() => {
    const query = vehicleSearch.trim().toLowerCase();
    return query ? bikes.filter(vehicle => `${vehicle.registration} ${vehicle.model}`.toLowerCase().includes(query)) : bikes;
  }, [vehicleSearch]);
  useEffect(() => { if (!vehiclePickerOpen) setVehicleSearch(`${selectedBike.registration} • ${selectedBike.model}`); }, [selectedBike.id, vehiclePickerOpen]);
  const fleetMarkers = useMemo(() => bikes.filter(vehicle => vehicle.id !== selectedBike.id && Number.isFinite(vehicle.location?.latitude) && Number.isFinite(vehicle.location?.longitude)).map(vehicle => ({ vehicle, coordinate: vehicle.location })), [selectedBike.id]);
  useEffect(() => { if (routeCoordinates.length > 1) mapRef.current?.fitToCoordinates(routeCoordinates, { edgePadding: { top: 80, right: 55, bottom: expanded ? 345 : 215, left: 40 }, animated: true }); }, [expanded, routeCoordinates]);
  const locatePhone = async () => Alert.alert("Allow Jixels to access your location?", "This shows your position relative to your motorcycle. Tracking the bike does not require your phone location.", [{ text: "Not now", style: "cancel" }, { text: "Continue", onPress: async () => { const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== "granted") return; const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); const point = { latitude: result.coords.latitude, longitude: result.coords.longitude }; setPhoneLocation(point); mapRef.current?.animateCamera({ center: point, zoom: 15 }, { duration: 700 }); } }]);
  const refreshLocation = useCallback(async () => { if (refreshing) return; setRefreshing(true); refreshSpin.setValue(0); const spin = Animated.loop(Animated.timing(refreshSpin, { toValue: 1, duration: 800, useNativeDriver: true })); spin.start(); try { await refresh(); } finally { spin.stop(); setRefreshing(false); } }, [refresh, refreshing, refreshSpin]);
  const toggleSheet = () => { const next = !expanded; setExpanded(next); Animated.spring(sheetY, { toValue: next ? -174 : 0, useNativeDriver: true, damping: 20, stiffness: 180 }).start(); };
  if (loading) return <ActivitySkeleton screen="tracking" />;
  if (!bike?.location) {
    const previewCenter = phoneLocation ?? { latitude: 0.0236, longitude: 37.9062 };
    return <View style={styles.mapContainer}><MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} mapType={mapType} initialRegion={{ ...previewCenter, latitudeDelta: phoneLocation ? .08 : 7.5, longitudeDelta: phoneLocation ? .08 : 7.5 }} showsCompass showsMyLocationButton={false}>{phoneLocation && <Marker coordinate={phoneLocation} title="Your phone location"><View style={styles.phoneMarker}><View style={styles.phoneMarkerInner} /></View></Marker>}</MapView><View style={styles.vehiclePicker}><Pressable onPress={() => setVehiclePickerOpen(open => !open)} style={styles.vehiclePickerInput}><Ionicons name="search" size={18} color={colors.blue} /><TextInput value={vehicleSearch} onChangeText={text => { setVehicleSearch(text); setVehiclePickerOpen(true); }} onFocus={() => { setVehicleSearch(""); setVehiclePickerOpen(true); }} placeholder="Search vehicle or plate" placeholderTextColor="#7890A8" style={styles.vehicleSearchInput} /><Ionicons name={vehiclePickerOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.gray} /></Pressable>{vehiclePickerOpen && <View style={styles.vehicleDropdown}>{matchingVehicles.length ? matchingVehicles.map(vehicle => <Pressable key={vehicle.id} onPress={() => { onSelectBike(vehicle); setVehicleSearch(`${vehicle.registration} • ${vehicle.model}`); setVehiclePickerOpen(false); }} style={[styles.vehicleDropdownRow, vehicle.id === selectedBike.id && styles.vehicleDropdownSelected]}><View style={styles.vehicleDropdownIcon}>{vehicle.type === "car" ? <Ionicons name="car-sport" size={18} color={colors.blue} /> : <MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} />}</View><View style={{ flex: 1 }}><Text style={styles.vehicleDropdownPlate}>{vehicle.registration}</Text><Text style={styles.vehicleDropdownModel}>{vehicle.model}</Text></View><View style={[styles.tableStatusDot, { backgroundColor: vehicle.status === "online" ? colors.green : colors.orange }]} /></Pressable>) : <Text style={styles.noVehicleText}>No vehicle found</Text>}</View>}</View><View style={styles.waitingTrackerCard}><View style={styles.waitingTrackerIcon}><Ionicons name="radio-outline" size={22} color={colors.orange} /></View><View style={{ flex: 1 }}><Text style={styles.waitingTrackerTitle}>Waiting for {selectedBike.registration}</Text><Text style={styles.waitingTrackerText}>{error ?? "The map is ready. This vehicle will appear when its tracker sends a valid location."}</Text></View></View><View style={styles.mapControls}><RoundButton icon="navigate-outline" label="Show my phone location" onPress={locatePhone} /><RoundButton icon="layers-outline" label="Map type" active={mapType === "hybrid"} onPress={() => setMapType(value => value === "standard" ? "hybrid" : "standard")} /><RoundButton label="Retry tracker" onPress={refreshLocation}><Animated.View style={{ transform: [{ rotate: refreshSpin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}><Ionicons name="refresh" size={20} color={colors.blue} /></Animated.View></RoundButton></View></View>;
  }
  return <View style={styles.mapContainer}><MapView ref={mapRef} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} mapType={mapType} initialRegion={{ ...bike.location, latitudeDelta: 0.08, longitudeDelta: 0.08 }} showsCompass={false} showsMyLocationButton={false}>{fleetMarkers.filter(item => item.vehicle.id !== selectedBike.id).map(item => <Marker key={item.vehicle.id} coordinate={item.coordinate} title={`${item.vehicle.registration} • ${item.vehicle.model}`} onPress={() => onSelectBike(item.vehicle)} tracksViewChanges={false}><View style={styles.fleetMarker}>{item.vehicle.type === "car" ? <Ionicons name="car-sport" size={18} color={colors.blue} /> : <MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} />}</View></Marker>)}<Marker.Animated coordinate={marker} anchor={{ x: 0.5, y: 0.5 }} rotation={bike.location.heading ?? 0} flat tracksViewChanges={false}><View style={styles.bikeMarker}>{selectedBike.type === "car" ? <Ionicons name="car-sport" size={25} color={colors.white} /> : <MaterialCommunityIcons name="motorbike" size={25} color={colors.white} />}</View></Marker.Animated>{phoneLocation && <Marker coordinate={phoneLocation}><View style={styles.phoneMarker}><View style={styles.phoneMarkerInner} /></View></Marker>}{routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor={colors.blue} strokeWidth={5} />}</MapView>
    <View style={styles.vehiclePicker}><Pressable onPress={() => setVehiclePickerOpen(open => !open)} style={styles.vehiclePickerInput}><Ionicons name="search" size={18} color={colors.blue} /><TextInput value={vehicleSearch} onChangeText={text => { setVehicleSearch(text); setVehiclePickerOpen(true); }} onFocus={() => { setVehicleSearch(""); setVehiclePickerOpen(true); }} placeholder="Search vehicle or plate" placeholderTextColor="#7890A8" style={styles.vehicleSearchInput} /><Ionicons name={vehiclePickerOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.gray} /></Pressable>{vehiclePickerOpen && <View style={styles.vehicleDropdown}>{matchingVehicles.length ? matchingVehicles.map(vehicle => <Pressable key={vehicle.id} onPress={() => { onSelectBike(vehicle); setVehicleSearch(`${vehicle.registration} • ${vehicle.model}`); setVehiclePickerOpen(false); }} style={[styles.vehicleDropdownRow, vehicle.id === selectedBike.id && styles.vehicleDropdownSelected]}><View style={styles.vehicleDropdownIcon}>{vehicle.type === "car" ? <Ionicons name="car-sport" size={18} color={colors.blue} /> : <MaterialCommunityIcons name="motorbike" size={19} color={colors.blue} />}</View><View style={{ flex: 1 }}><Text style={styles.vehicleDropdownPlate}>{vehicle.registration}</Text><Text style={styles.vehicleDropdownModel}>{vehicle.model}</Text></View><View style={[styles.tableStatusDot, { backgroundColor: vehicle.status === "online" ? colors.green : colors.orange }]} /></Pressable>) : <Text style={styles.noVehicleText}>No vehicle found</Text>}</View>}</View>
    <View style={styles.mapControls}><RoundButton icon="locate" label="Recenter" onPress={() => mapRef.current?.animateCamera({ center: location, zoom: 16 }, { duration: 700 })} /><RoundButton icon="navigate-outline" label="My location" onPress={locatePhone} /><RoundButton icon="layers-outline" label="Map type" active={mapType === "hybrid"} onPress={() => setMapType(v => v === "standard" ? "hybrid" : "standard")} /><RoundButton label="Refresh" onPress={refreshLocation}><Animated.View style={{ transform: [{ rotate: refreshSpin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}><Ionicons name="refresh" size={20} color={colors.blue} /></Animated.View></RoundButton></View>
    {!!error && <View style={styles.mapError}><Ionicons name="warning" color={colors.orange} /><Text numberOfLines={2} style={styles.mapErrorText}>{error}</Text></View>}
    <Animated.View style={[styles.mapSheet, { transform: [{ translateY: sheetY }] }]}><Pressable onPress={toggleSheet}><View style={styles.handle} /><View style={styles.bikeTop}><View style={{ flex: 1 }}><Text style={styles.sheetBike}>{selectedBike.model}</Text><Text style={styles.cardSub}>{selectedBike.registration}</Text></View><StatusPill status={status} /></View><View style={styles.mapMetrics}><View style={{ flex: 1 }}><Text style={styles.microLabel}>SPEED</Text><Text style={styles.speed}>{bike.location.speedKph} <Text style={styles.speedUnit}>km/h</Text></Text></View><View style={styles.metricDivider} /><View style={{ flex: 1 }}><Text style={styles.microLabel}>LAST UPDATE</Text><Text style={styles.lastUpdate}>{relativeTime(bike.location.recordedAt, now)}</Text></View></View></Pressable><View style={styles.sheetExpanded}><View style={styles.sheetDetail}><View><Text style={styles.cardSub}>GPS accuracy</Text><Text style={styles.gpsAccuracyHint}>Live tracker precision</Text></View><View style={styles.gpsAccuracyValue}><View style={[styles.gpsAccuracyDot, { backgroundColor: gpsQualityColor }]} /><Text style={[styles.detailStrong, { color: gpsQualityColor }]}>{gpsQuality} • {gpsAccuracy == null ? "—" : `±${gpsAccuracy} m`}</Text></View></View><View style={styles.rangeRow}>{ranges.map(item => <Pressable key={item} onPress={async () => { setRange(item); if (route) await loadRoute(item); }} style={[styles.rangeButton, range === item && styles.rangeActive]}><Text style={[styles.rangeText, range === item && styles.rangeTextActive]}>{item}</Text></Pressable>)}</View><Pressable disabled={routeLoading} onPress={() => route ? setRoute(null) : loadRoute(range)} style={[styles.outlineButton, styles.fullRouteButton]}>{routeLoading ? <ActivityIndicator color={colors.blue} /> : <><Ionicons name="git-branch-outline" color={colors.blue} /><Text style={styles.outlineButtonText}>{route ? "Hide Route" : "Route History"}</Text></>}</Pressable>{route && <View style={styles.tripRow}><Text style={styles.tripText}>{route.distanceKm} km</Text><Text style={styles.tripText}>{Math.floor(route.durationMinutes / 60)}h {route.durationMinutes % 60}m</Text><Text style={styles.tripText}>{route.stops} stops</Text></View>}</View></Animated.View>
  </View>;
}

function useConnectivity() {
  const [isOnline, setIsOnline] = useState(true);
  const update = useCallback(state => setIsOnline(state.isConnected !== false && state.isInternetReachable !== false), []);
  const checkConnectivity = useCallback(async () => { const state = await Network.getNetworkStateAsync(); update(state); return state.isConnected !== false && state.isInternetReachable !== false; }, [update]);
  useEffect(() => {
    checkConnectivity().catch(() => {});
    const subscription = Network.addNetworkStateListener(update);
    return () => subscription.remove();
  }, [checkConnectivity, update]);
  return { isOnline, checkConnectivity };
}

function OfflineGate({ onContinue, onRetry }) {
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([Animated.timing(motion, { toValue: 1, duration: 2300, useNativeDriver: true }), Animated.timing(motion, { toValue: 0, duration: 0, useNativeDriver: true })]));
    animation.start();
    return () => animation.stop();
  }, [motion]);
  return <View style={styles.offlineGate}><StatusBar style="light" /><View style={styles.offlinePulse}><Ionicons name="cloud-offline" size={52} color={colors.white} /></View><View style={styles.offlineRoadStage}><View style={styles.offlineRoad} /><Animated.View style={[styles.offlineVehicle, styles.offlineCar, { transform: [{ translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [-75, 175] }) }] }]}><Ionicons name="car-sport" size={22} color={colors.white} /></Animated.View><Animated.View style={[styles.offlineVehicle, styles.offlineBike, { transform: [{ translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [140, -140] }) }] }]}><MaterialCommunityIcons name="motorbike" size={24} color={colors.white} /></Animated.View><Animated.View style={[styles.offlineVehicle, styles.offlineTukTuk, { transform: [{ translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [-175, 75] }) }] }]}><MaterialCommunityIcons name="rickshaw" size={22} color={colors.white} /></Animated.View></View><Text style={styles.offlineTitle}>Network is down</Text><Text style={styles.offlineMessage}>Connect to the internet to receive live tracker updates and complete payments. You can still open saved vehicles, history, alerts and settings offline.</Text><Pressable onPress={onRetry} style={styles.offlineRetry}><Ionicons name="refresh" size={18} color={colors.blueDark} /><Text style={styles.offlineRetryText}>Check connection</Text></Pressable><Pressable onPress={onContinue} style={styles.offlineContinue}><Text style={styles.offlineContinueText}>Continue offline</Text><Ionicons name="arrow-forward" size={17} color={colors.white} /></Pressable></View>;
}

function CustomerApp({ session, onLogout }) {
  const insets = useSafeAreaInsets();
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [screen, setScreen] = useState("dashboard");
  const [permissionAlertVisible, setPermissionAlertVisible] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const screenMotion = useRef(new Animated.Value(1)).current;
  const navigationHistory = useRef([]);
  const [selectedBike, setSelectedBike] = useState(bikes[0]);
  const [monitoringVehicles, setMonitoringVehicles] = useState(bikes);
  const [alerts, setAlerts] = useState(() => dedupeById(seedAlerts));
  const [payments, setPayments] = useState(() => dedupeById(seedPayments));
  const [monthlyProgress, setMonthlyProgress] = useState(() => Object.fromEntries(bikes.map(vehicle => [vehicle.id, vehicle.paidThisMonth ?? 0])));
  const [financeBalances, setFinanceBalances] = useState(() => Object.fromEntries(bikes.map(vehicle => [vehicle.id, vehicle.balance])));
  const [security, setSecurity] = useState(() => Object.fromEntries(bikes.map(vehicle => [vehicle.id, { monitoringArmed: vehicle.monitoringArmed ?? true, immobilized: vehicle.immobilized ?? false, tamperStatus: vehicle.tamperStatus ?? "secure" }])));
  const [profile, setProfile] = useState(() => ({ ...customer, ...(session?.user ?? {}) }));
  const { isOnline, checkConnectivity } = useConnectivity();
  const [offlineAcknowledged, setOfflineAcknowledged] = useState(false);
  const [syncQueue, setSyncQueue] = useState([]);
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [queueHydrated, setQueueHydrated] = useState(false);
  const paymentTimers = useRef(new Set());
  const notifiedTamperEvents = useRef(new Set());
  const syncFlushActive = useRef(false);
  // Page navigation is immediate. Individual data screens own their real
  // request-loading state and show skeletons only while awaiting a response.
  const booting = false;
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  useEffect(() => {
    Promise.all([
      Location.getForegroundPermissionsAsync(),
      Notifications.getPermissionsAsync(),
    ]).then(([locationPermission, notificationPermission]) => {
      setPermissionAlertVisible(locationPermission.status !== "granted" || notificationPermission.status !== "granted");
    }).catch(() => setPermissionAlertVisible(true));
  }, []);
  useEffect(() => { AsyncStorage.getItem("jixels:profile").then(value => { if (!value) return; const saved = JSON.parse(value); const legacyDemo = saved.name === "John Doe" || saved.email === "john.doe@example.com"; setProfile(current => legacyDemo ? { ...current, ...saved, name: customer.name, email: customer.email, phone: customer.phone } : { ...current, ...saved }); }).catch(() => {}).finally(() => setProfileHydrated(true)); }, []);
  useEffect(() => { if (profileHydrated) AsyncStorage.setItem("jixels:profile", JSON.stringify(profile)).catch(() => {}); }, [profile, profileHydrated]);
  useEffect(() => { AsyncStorage.getItem("jixels:sync-queue").then(value => value && setSyncQueue(dedupeById(JSON.parse(value)))).catch(() => {}).finally(() => setQueueHydrated(true)); }, []);
  useEffect(() => { if (queueHydrated) AsyncStorage.setItem("jixels:sync-queue", JSON.stringify(syncQueue)).catch(() => {}); }, [queueHydrated, syncQueue]);
  useEffect(() => () => { paymentTimers.current.forEach(clearTimeout); paymentTimers.current.clear(); }, []);
  useEffect(() => {
    if (config.demoMode || !isOnline || !session?.accessToken) return undefined;
    let active = true;
    const refreshSecurity = async () => {
      let vehiclesToCheck = bikes;
      let fleetRecords = null;
      try {
        const fleetResponse = await trackingApi.getFleetSecurityStatus(session.accessToken);
        const fleet = fleetResponse?.vehicles ?? fleetResponse?.motorcycles ?? fleetResponse;
        if (Array.isArray(fleet) && fleet.length > 0) {
          fleetRecords = fleet;
          vehiclesToCheck = fleet.map(record => record.vehicle ?? record.motorcycle ?? record).filter(vehicle => vehicle?.id);
          setMonitoringVehicles(vehiclesToCheck);
        }
      } catch {}
      const results = fleetRecords ? fleetRecords.map((response, index) => ({ status: "fulfilled", value: { vehicle: vehiclesToCheck[index], response } })) : await Promise.allSettled(vehiclesToCheck.map(async vehicle => ({ vehicle, response: await trackingApi.getSecurityStatus(vehicle.id, session.accessToken) })));
      if (!active) return;
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { vehicle, response } = result.value;
        const raw = response?.securityStatus ?? response?.security ?? response?.tamper ?? response ?? {};
        const tamperStatus = String(raw.tamperStatus ?? raw.tamper?.status ?? "secure").toLowerCase();
        const lastTrustedLocation = raw.lastTrustedLocation ?? raw.tamper?.lastTrustedLocation ?? null;
        const lastTrustedAddress = raw.lastTrustedAddress ?? lastTrustedLocation?.address ?? raw.tamper?.lastTrustedAddress ?? null;
        const detectedAt = raw.tamperDetectedAt ?? raw.tamper?.detectedAt ?? raw.updatedAt ?? null;
        const normalized = { monitoringArmed: raw.monitoringArmed ?? raw.armed ?? true, immobilized: raw.immobilized ?? false, tamperStatus, lastTrustedLocation, lastTrustedAddress, tamperDetectedAt: detectedAt };
        setSecurity(current => ({ ...current, [vehicle.id]: { ...current[vehicle.id], ...normalized } }));
        if (tamperStatus !== "tampered") continue;
        const eventId = `tamper-${vehicle.id}-${detectedAt ?? "active"}`;
        if (notifiedTamperEvents.current.has(eventId)) continue;
        notifiedTamperEvents.current.add(eventId);
        const locationText = lastTrustedAddress || (lastTrustedLocation?.latitude != null && lastTrustedLocation?.longitude != null ? `${Number(lastTrustedLocation.latitude).toFixed(5)}, ${Number(lastTrustedLocation.longitude).toFixed(5)}` : "Open Monitoring to view the last trusted point");
        const message = `${vehicle.registration}: tracker tampering detected. Last trusted location: ${locationText}.`;
        setAlerts(current => upsertById(current, { id: eventId, type: "tracker", icon: "warning-outline", title: "Tracker tamper detected", message, age: "now", unread: true }));
        Notifications.scheduleNotificationAsync({ content: { title: "Tracker tamper detected", subtitle: vehicle.registration, body: message, sound: "default", data: { screen: "monitoring", type: "tracker-tamper", eventId, vehicleId: vehicle.id, inAppRecorded: true } }, trigger: null }).catch(() => {});
      }
    };
    refreshSecurity().catch(() => {});
    const timer = setInterval(() => refreshSecurity().catch(() => {}), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [isOnline, session?.accessToken]);
  useEffect(() => { if (isOnline) setOfflineAcknowledged(false); }, [isOnline]);
  useEffect(() => {
    if (!isOnline || !session?.accessToken || syncQueue.length === 0 || syncFlushActive.current) return;
    let cancelled = false;
    syncFlushActive.current = true;
    (async () => {
      const remaining = [];
      for (const action of syncQueue) {
        if (!action?.id) { remaining.push(action); continue; }
        try {
          await apiRequest("/v1/customer/offline-actions", { method: "POST", token: session.accessToken, body: action, headers: { "Idempotency-Key": action.id } });
        } catch { remaining.push(action); }
      }
      if (!cancelled && remaining.length !== syncQueue.length) setSyncQueue(remaining);
    })().finally(() => { syncFlushActive.current = false; });
    return () => { cancelled = true; };
  }, [isOnline, session?.accessToken, syncQueue]);
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(notification => {
      const content = notification.request.content;
      if (content.data?.inAppRecorded) return;
      const eventId = content.data?.eventId ?? content.data?.mpesaReceiptNumber ?? notification.request.identifier;
      setAlerts(current => upsertById(current, { id: eventId, type: content.data?.type ?? "tracker", icon: content.data?.type === "payment" ? "checkmark-circle-outline" : "notifications-outline", title: content.title ?? "Jixels update", message: content.body ?? "You have a new account update.", age: "now", unread: true }));
      if (!config.demoMode && content.data?.type === "payment" && session?.accessToken) {
        customerApi.getPayments(session.accessToken).then(response => {
          const serverPayments = response?.payments ?? response;
          if (Array.isArray(serverPayments)) setPayments(dedupeById(serverPayments));
        }).catch(() => {});
      }
    });
    const responded = Notifications.addNotificationResponseReceivedListener(response => {
      const target = response.notification.request.content.data?.screen;
      if (target === "history" || target === "alerts" || target === "tracking" || target === "monitoring") setScreen(target);
    });
    return () => { received.remove(); responded.remove(); };
  }, [session?.accessToken]);
  const unread = alerts.filter(a => a.unread).length;
  const totalPaid = payments.filter(payment => payment.status === "Confirmed").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const darkMode = profile.themeMode === "dark";
  const paymentVehicles = useMemo(() => bikes.map(vehicle => ({ ...vehicle, balance: financeBalances[vehicle.id] ?? vehicle.balance })), [financeBalances]);
  const paymentSelectedBike = useMemo(() => paymentVehicles.find(vehicle => vehicle.id === selectedBike?.id) ?? selectedBike, [paymentVehicles, selectedBike]);
  useEffect(() => { Notifications.setBadgeCountAsync(unread).catch(() => {}); }, [unread]);
  const title = menu.find(item => item.key === screen)?.label ?? "Dashboard";
  const subtitles = { dashboard: "Overview of your Jixels account", bikes: "Track and pay for vehicles you own", tracking: selectedBike?.registration ?? "Your current location", monitoring: selectedBike ? `Security for ${selectedBike.registration}` : "Vehicle security controls", payments: selectedBike ? `Payment for ${selectedBike.registration}` : "No vehicle selected", history: "Your confirmed vehicle payments", reports: "Download vehicle route reports", alerts: "Important account updates", settings: "Profile, contact and security details" };
  const navigate = key => {
    if (key !== screen) {
      nativeTap();
      screenMotion.setValue(0);
      navigationHistory.current.push(screen);
      setScreen(key);
      requestAnimationFrame(() => Animated.timing(screenMotion, { toValue: 1, duration: 220, useNativeDriver: true }).start());
    }
    if (drawerExpanded) setDrawerExpanded(false);
  };
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (paymentReceipt) {
        setPaymentReceipt(null);
        return true;
      }
      if (drawerExpanded) {
        setDrawerExpanded(false);
        return true;
      }
      const previous = navigationHistory.current.pop();
      if (previous) {
        nativeTap();
        screenMotion.setValue(0);
        setScreen(previous);
        requestAnimationFrame(() => Animated.timing(screenMotion, { toValue: 1, duration: 220, useNativeDriver: true }).start());
        return true;
      }
      // Keep the authenticated session active on the dashboard. Sign out is
      // performed only through the explicit drawer action.
      return true;
    });
    return () => subscription.remove();
  }, [drawerExpanded, paymentReceipt]);
  const refreshApp = useCallback(() => {
    setDrawerExpanded(false);
  }, []);
  const generateReport = async (period, reportType = "payments", reportBike = selectedBike, options = {}) => {
    const reportPeriod = options.periodName || period;
    const routeDate = options.routeDate || period;
    const fileName = reportFileName(reportType === "routes" ? `${reportPeriod}-${routeDate}` : reportPeriod, reportType);
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;
    const action = { period: reportPeriod, reportType: "payments", include: ["transactions", "mpesa-receipts", "instalment-progress", "finance-balances"], format: "pdf", documentProtection: "account-password" };
    if (reportType === "routes") Object.assign(action, { date: routeDate, vehicleId: reportBike.id, reportType: "routes", include: ["route-points", "distance", "stops", "last-position"] });
    if (!isOnline) {
      Alert.alert("You are offline", "Connect to the internet to download the protected report.");
      return false;
    }
    try {
      if (config.demoMode) {
        const demoBody = reportType === "routes" ? `Jixels Customer Trackings route report\nVehicle: ${reportBike.registration}\nPeriod: ${reportPeriod}\nDate: ${routeDate}\nDistance: 18.4 km\nStops: 3\nLast recorded position: Nairobi, Kenya\nCustomer: ${profile.name}` : `Jixels Customer Trackings payment report\nPeriod: ${reportPeriod}\nCustomer: ${profile.name}\nMonthly instalment: KES 700`;
        await FileSystem.writeAsStringAsync(fileUri, demoBody);
        return { uri: fileUri, name: fileName };
      }
      const response = await customerApi.generateReport(session.accessToken, action);
      const reportUrl = response?.downloadUrl ?? response?.pdfUrl ?? response?.url ?? response?.documentUrl;
      if (!reportUrl) throw new ApiError("The report service did not return a PDF download link.", 502, "MISSING_REPORT_URL");
      const download = await FileSystem.downloadAsync(reportUrl, fileUri, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      return { uri: download.uri, name: fileName };
    } catch (error) {
      Alert.alert("Could not download report", error instanceof ApiError ? error.message : "Check your connection and try again.");
      return false;
    }
  };
  const updateMonitoring = async (vehicle, armed) => {
    try {
      if (!config.demoMode) await trackingApi.setMonitoring(vehicle.id, armed, session.accessToken);
      setSecurity(current => ({ ...current, [vehicle.id]: { ...current[vehicle.id], monitoringArmed: armed } }));
      setAlerts(current => upsertById(current, { id: `monitoring-${vehicle.id}-${Date.now()}`, type: "tracker", icon: armed ? "shield-checkmark-outline" : "shield-outline", title: armed ? "Vehicle monitoring armed" : "Vehicle monitoring disarmed", message: `${vehicle.registration}: ${armed ? "movement and tamper alerts are active" : "movement alerts paused; GPS remains online"}.`, age: "now", unread: true }));
      return true;
    } catch (error) { Alert.alert("Command failed", error instanceof ApiError ? error.message : "Monitoring could not be updated."); return false; }
  };
  const updateImmobilizer = async (vehicle, immobilized) => {
    if (!isOnline) { Alert.alert("You are offline", "A secure immobilizer command requires a live tracker connection."); return false; }
    try {
      if (!config.demoMode) await trackingApi.setImmobilizer(vehicle.id, immobilized, session.accessToken);
      setSecurity(current => ({ ...current, [vehicle.id]: { ...current[vehicle.id], immobilized } }));
      setAlerts(current => upsertById(current, { id: `immobilizer-${vehicle.id}-${Date.now()}`, type: "tracker", icon: immobilized ? "lock-closed-outline" : "lock-open-outline", title: immobilized ? "Vehicle immobilized" : "Engine start allowed", message: `${vehicle.registration}: ${immobilized ? "engine start is blocked after stationary confirmation" : "immobilizer released"}.`, age: "now", unread: true }));
      return true;
    } catch (error) { Alert.alert("Command failed", error instanceof ApiError ? error.message : "The bike did not confirm the command."); return false; }
  };
  const addPayment = async (amount, payerPhone, idempotencyKey) => {
    const currentFinanceBalance = financeBalances[selectedBike.id] ?? selectedBike.balance;
    if (!config.demoMode) {
      try {
        const response = await paymentsApi.requestMpesa(session.accessToken, { vehicleId: selectedBike.id, amount, phone: payerPhone, idempotencyKey });
        const payment = response?.payment ?? response ?? {};
        const requestId = payment.id ?? payment.requestId ?? payment.checkoutRequestId;
        if (!requestId) throw new ApiError("The payment service returned an invalid response.", 502, "INVALID_PAYMENT_RESPONSE");
        setPayments(current => upsertById(current, { id: requestId, bikeId: selectedBike.id, registration: selectedBike.registration, date: "Today", amount, payerPhone, method: "M-Pesa", status: payment.status ?? "Processing", mpesaReceiptNumber: payment.mpesaReceiptNumber ?? "Pending", notificationMessage: "M-Pesa request sent. Confirm the prompt on the selected phone." }));
        Alert.alert("M-Pesa request sent", "Complete the prompt on the selected phone. Jixels will notify you after M-Pesa confirms the payment.");
        return true;
      } catch (error) {
        Alert.alert("Payment request failed", error instanceof ApiError ? error.message : "The M-Pesa request could not be sent. Please try again.");
        return false;
      }
    }
    const mpesaReceiptNumber = demoMpesaReceipt();
    const remainingBalance = Math.max(0, currentFinanceBalance - amount);
    const configuredTarget = Number(selectedBike.monthlyPayment);
    const monthlyTarget = Number.isFinite(configuredTarget) && configuredTarget > 0 ? configuredTarget : null;
    const paidBefore = monthlyProgress[selectedBike.id] ?? selectedBike.paidThisMonth ?? 0;
    const paidThisMonth = paidBefore + amount;
    const monthlyRemaining = monthlyTarget ? Math.max(0, monthlyTarget - paidThisMonth) : null;
    const monthlyComplete = monthlyTarget ? monthlyRemaining === 0 : false;
    const receipt = { id: mpesaReceiptNumber, mpesaReceiptNumber, bikeId: selectedBike.id, registration: selectedBike.registration, date: "Today", amount, payerPhone, method: "M-Pesa", status: "Processing" };
    setPayments(current => upsertById(current, receipt));
    const confirmationTimer = setTimeout(() => {
      paymentTimers.current.delete(confirmationTimer);
      setFinanceBalances(current => ({ ...current, [selectedBike.id]: remainingBalance }));
      if (monthlyTarget) setMonthlyProgress(current => ({ ...current, [selectedBike.id]: monthlyComplete ? 0 : paidThisMonth }));
      setSelectedBike(current => current.id === selectedBike.id ? { ...current, balance: remainingBalance, nextPayment: monthlyTarget ? (monthlyComplete ? "Agreed instalment completed" : `${money(monthlyRemaining)} remaining`) : current.nextPayment } : current);
      const paymentMessage = monthlyTarget ? (monthlyComplete ? `${money(amount)} received for ${selectedBike.registration}. Your agreed instalment of ${money(monthlyTarget)} is fully paid. Vehicle finance balance: ${money(remainingBalance)}. Receipt ${mpesaReceiptNumber}.` : `${money(amount)} received for ${selectedBike.registration}. ${money(monthlyRemaining)} remains toward your agreed ${money(monthlyTarget)} instalment. Vehicle finance balance: ${money(remainingBalance)}. Receipt ${mpesaReceiptNumber}.`) : `${money(amount)} received for ${selectedBike.registration}. Vehicle finance balance: ${money(remainingBalance)}. Receipt ${mpesaReceiptNumber}.`;
      const confirmedReceipt = { ...receipt, status: "Confirmed", monthlyTarget, monthlyRemaining, monthlyComplete, remainingBalance, notificationMessage: paymentMessage };
      setPayments(current => current.map(payment => payment.id === receipt.id ? confirmedReceipt : payment));
      setAlerts(current => upsertById(current, { id: `payment-${mpesaReceiptNumber}`, type: "receipt", icon: "checkmark-circle-outline", title: monthlyComplete ? "Agreed instalment completed" : "Payment confirmed", message: paymentMessage, age: "now", unread: true }));
      setPaymentReceipt(confirmedReceipt);
      Notifications.scheduleNotificationAsync({ content: { title: monthlyComplete ? "Agreed instalment completed" : "Payment confirmed", subtitle: "Jixels Customer Trackings", body: paymentMessage, sound: "default", data: { screen: "history", type: "payment", inAppRecorded: true, mpesaReceiptNumber, vehicleId: selectedBike.id, remainingBalance, monthlyRemaining } }, trigger: null }).catch(() => {});
    }, 1800);
    paymentTimers.current.add(confirmationTimer);
    return true;
  };
  const refreshable = { onRefresh: refreshApp };
  const acceptPermissions = async () => {
    setPermissionBusy(true);
    try {
      await Promise.all([
        Location.requestForegroundPermissionsAsync(),
        enableNotifications(),
      ]);
      setPermissionAlertVisible(false);
    } finally {
      setPermissionBusy(false);
    }
  };
  if (!isOnline && !offlineAcknowledged) return <OfflineGate onContinue={() => setOfflineAcknowledged(true)} onRetry={() => checkConnectivity().catch(() => {})} />;
  return <View style={[styles.appShell, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 22) }]}><StatusBar style="light" /><View style={[styles.main, darkMode && styles.darkPage]}>{!isOnline && <View style={styles.offlineBanner}><Ionicons name="cloud-offline-outline" size={14} color={colors.white} /><Text style={styles.offlineBannerText}>Offline • {syncQueue.length} waiting to sync</Text></View>}<PageHeader dark={darkMode} title={title} subtitle={subtitles[screen]} expanded={drawerExpanded} onToggle={() => setDrawerExpanded(v => !v)} unread={unread} onAlerts={() => navigate("alerts")} profile={profile} /><Animated.View style={[styles.screen, { opacity: screenMotion, transform: [{ translateX: screenMotion.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>{booting ? <ActivitySkeleton screen={screen} /> : <>{screen === "dashboard" && <Dashboard darkMode={darkMode} selectedBike={selectedBike} onSelectBike={setSelectedBike} navigate={navigate} totalPaid={totalPaid} profile={profile} {...refreshable} />}{screen === "bikes" && <BikesScreen selectedBike={selectedBike} onSelectBike={setSelectedBike} navigate={navigate} {...refreshable} />}{screen === "tracking" && (selectedBike ? <TrackingScreen selectedBike={selectedBike} onSelectBike={setSelectedBike} accessToken={session?.accessToken} /> : <PhoneLocationTrackingScreen />)}{screen === "monitoring" && <MonitoringScreen selectedBike={selectedBike} vehicles={monitoringVehicles} onSelectBike={setSelectedBike} security={security} onMonitoringChange={updateMonitoring} onImmobilizerChange={updateImmobilizer} isOnline={isOnline} {...refreshable} />}{screen === "payments" && <PaymentScreen selectedBike={paymentSelectedBike} paymentVehicles={paymentVehicles} onSelectBike={setSelectedBike} onPaid={addPayment} registeredPhone={profile.phone} isOnline={isOnline} {...refreshable} />}{screen === "history" && <HistoryScreen darkMode={darkMode} payments={payments} deletePayments={ids => setPayments(current => current.filter(payment => !ids.includes(payment.id)))} {...refreshable} />}{screen === "reports" && <ReportsScreen profile={profile} selectedBike={selectedBike} vehicles={bikes} onSelectBike={setSelectedBike} onGenerate={generateReport} isOnline={isOnline} {...refreshable} />}{screen === "alerts" && <AlertsScreen darkMode={darkMode} alerts={alerts} markAllRead={() => setAlerts(current => current.map(a => ({ ...a, unread: false })))} markAlertRead={id => setAlerts(current => current.map(a => a.id === id ? { ...a, unread: false } : a))} deleteAlerts={ids => setAlerts(current => current.filter(alert => !ids.includes(alert.id)))} {...refreshable} />}{screen === "settings" && <SettingsScreen profile={profile} onSave={setProfile} {...refreshable} />}</>}</Animated.View></View>{permissionAlertVisible && <View pointerEvents="box-none" style={styles.dashboardPermissionWrap}><View style={styles.dashboardPermissionAlert}><View style={styles.dashboardPermissionIcon}><Ionicons name="shield-checkmark" size={25} color={colors.white} /></View><View style={styles.dashboardPermissionBody}><Text style={styles.dashboardPermissionTitle}>Allow Jixels access</Text><Text style={styles.dashboardPermissionText}>Enable device location for the live map and notifications for tracker and payment alerts.</Text></View><View style={styles.dashboardPermissionActions}><Pressable disabled={permissionBusy} onPress={() => setPermissionAlertVisible(false)} style={styles.permissionCancelButton}><Text style={styles.permissionCancelText}>Cancel</Text></Pressable><Pressable disabled={permissionBusy} onPress={acceptPermissions} style={styles.permissionAcceptButton}>{permissionBusy ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.permissionAcceptText}>Accept</Text>}</Pressable></View></View></View>}{drawerExpanded && <><Pressable accessibilityLabel="Close menu" onPress={() => setDrawerExpanded(false)} style={styles.drawerBackdrop} /><Drawer topInset={0} bottomInset={Math.max(insets.bottom, 28)} expanded active={screen} unread={unread} onToggle={() => setDrawerExpanded(false)} onSelect={navigate} onLogout={onLogout} /></>}<PaymentSuccess receipt={paymentReceipt} onClose={() => setPaymentReceipt(null)} /></View>;
}

export default function App() {
  const [phase, setPhase] = useState("otp");
  const [applicant, setApplicant] = useState(null);
  const [approvedEmail, setApprovedEmail] = useState(null);
  const [displayName, setDisplayName] = useState(customer.name);
  const [loginCount, setLoginCount] = useState(0);
  const [session, setSession] = useState(null);
  const authenticate = async (nextSession) => {
    setSession(nextSession);
    setDisplayName(nextSession?.user?.name || customer.name);
    await sessionStore.set(nextSession).catch(() => {});
    setPhase("gps");
  };
  const logout = async () => {
    await sessionStore.clear().catch(() => {});
    setSession(null);
    setPhase("auth");
  };
  return <SafeAreaProvider>{phase === "auth" && <AuthScreen pendingEmail={applicant?.email} approvedEmail={approvedEmail} onAuthenticated={authenticate} onPendingApproval={data => { setApplicant(data); setPhase("pending"); }} />}{phase === "pending" && <PendingApproval applicant={applicant} onEnterCode={() => setPhase("otp")} onBackToLogin={() => setPhase("auth")} />}{phase === "otp" && <OtpVerification applicant={applicant} initialGate={!applicant} onVerified={() => { if (applicant) { setApprovedEmail(applicant.email); Alert.alert("Account verified", "Your account is approved. Sign in with the email and password you registered."); } setPhase("auth"); }} onBack={applicant ? () => setPhase("pending") : undefined} />}{phase === "permissions" && <PermissionGate onComplete={() => setPhase("gps")} />}{phase === "gps" && <GpsLaunch name={displayName} returning={loginCount > 0} onComplete={() => { setLoginCount(count => count + 1); setPhase("app"); }} />}{phase === "app" && session && <CustomerApp session={session} onLogout={logout} />}</SafeAreaProvider>;
}

const styles = StyleSheet.create({
  permissionPage: { flex: 1, backgroundColor: colors.blueDark, paddingHorizontal: 20, justifyContent: "center" },
  permissionCard: { backgroundColor: colors.white, borderRadius: 28, padding: 22, elevation: 8, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 16 },
  permissionIcon: { width: 68, height: 68, borderRadius: 22, alignSelf: "center", alignItems: "center", justifyContent: "center", backgroundColor: colors.blue, marginBottom: 16 },
  permissionTitle: { color: colors.ink, fontSize: 23, fontWeight: "900", textAlign: "center" },
  permissionText: { color: colors.gray, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8, marginBottom: 18 },
  permissionItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F4F8FC", borderRadius: 16, padding: 14, marginBottom: 10 },
  permissionItemTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  permissionItemText: { color: colors.gray, fontSize: 10, marginTop: 2 },
  permissionCheck: { alignItems: "center", paddingTop: 14 },
  permissionCheckText: { color: colors.blue, fontSize: 12, fontWeight: "800" },
  dashboardPermissionWrap: { position: "absolute", left: 14, right: 14, top: 90, zIndex: 30 },
  dashboardPermissionAlert: { borderRadius: 18, padding: 13, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 10, elevation: 10, shadowColor: colors.ink, shadowOpacity: .14, shadowRadius: 12 },
  dashboardPermissionIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  dashboardPermissionBody: { flex: 1 },
  dashboardPermissionTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  dashboardPermissionText: { color: colors.gray, fontSize: 10, lineHeight: 14, marginTop: 2 },
  dashboardPermissionActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  permissionCancelButton: { minWidth: 58, minHeight: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  permissionCancelText: { color: colors.gray, fontSize: 11, fontWeight: "900" },
  permissionAcceptButton: { minWidth: 58, minHeight: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.blue },
  permissionAcceptText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  authLoadingPage: { flex: 1, backgroundColor: colors.blueDark },
  authLoadingBrand: { paddingTop: 58, paddingHorizontal: 24, paddingBottom: 18, alignItems: "center" },
  authSkeleton: { flex: 1, marginHorizontal: 16, marginBottom: 18, borderRadius: 24, padding: 18, gap: 14, backgroundColor: colors.white },
  waitingTrackerCard: { position: "absolute", left: 12, right: 64, top: 62, minHeight: 72, borderRadius: 15, padding: 11, backgroundColor: "rgba(255,255,255,.97)", flexDirection: "row", alignItems: "center", gap: 9, elevation: 8, shadowColor: colors.ink, shadowOpacity: .15, shadowRadius: 8 },
  waitingTrackerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#FFF4E5", alignItems: "center", justifyContent: "center" },
  waitingTrackerTitle: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  waitingTrackerText: { color: colors.gray, fontSize: 8, lineHeight: 12, marginTop: 3 },
  noVehicleMapCard: { position: "absolute", left: 12, right: 64, bottom: 18, minHeight: 76, borderRadius: 16, padding: 12, backgroundColor: "rgba(255,255,255,.97)", flexDirection: "row", alignItems: "center", gap: 9, elevation: 8, shadowColor: colors.ink, shadowOpacity: .15, shadowRadius: 8 },
  approvalSecondary: { minHeight: 42, alignItems: "center", justifyContent: "center", marginTop: 6 },
  approvalSecondaryText: { color: "#BED0E3", fontSize: 12, fontWeight: "800" },
  otpPage: { flex: 1, backgroundColor: colors.blueDark, paddingHorizontal: 20, justifyContent: "center", overflow: "hidden" },
  otpGlow: { position: "absolute", width: 330, height: 330, borderRadius: 165, backgroundColor: "rgba(9,105,218,.24)", top: -120, right: -100 },
  otpGlowSecondary: { position: "absolute", width: 230, height: 230, borderRadius: 115, backgroundColor: "rgba(25,169,116,.18)", bottom: -90, left: -80 },
  skeletonShine: { position: "absolute", top: -20, bottom: -20, left: 0, width: 62, backgroundColor: "rgba(255,255,255,.68)" },
  paymentMessageOverlay: { flex: 1, justifyContent: "flex-end" },
  paymentMessageBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(7,29,54,.58)" },
  paymentMessageSheet: { minHeight: 390, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 28, backgroundColor: colors.white },
  paymentMessageHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: "center", marginTop: 10, marginBottom: 18 },
  paymentMessageSender: { flexDirection: "row", alignItems: "center", gap: 11 },
  paymentMessageLogo: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  paymentMessageSenderName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  paymentMessageSenderMeta: { color: colors.gray, fontSize: 9, marginTop: 3 },
  paymentMessageClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  paymentMessageBubble: { marginTop: 20, marginRight: 32, borderRadius: 18, borderTopLeftRadius: 5, padding: 15, backgroundColor: colors.bluePale },
  paymentMessageText: { color: colors.ink, fontSize: 12, lineHeight: 19 },
  paymentMessageTime: { color: colors.gray, fontSize: 8, textAlign: "right", marginTop: 9 },
  paymentMessageReceipt: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 16, padding: 15, marginTop: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  paymentMessageReceiptId: { color: colors.ink, fontSize: 14, fontWeight: "900", letterSpacing: .7, marginTop: 5 },
  paymentMessageAmountWrap: { alignItems: "flex-end" },
  paymentMessageAmount: { color: colors.green, fontSize: 16, fontWeight: "900", marginTop: 5 },
  paymentMessageBalance: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4, paddingTop: 16 },
  otpCard: { borderRadius: 26, padding: 22, backgroundColor: colors.white, alignItems: "center", shadowColor: "#000", shadowOpacity: .25, shadowRadius: 18, elevation: 14 },
  otpIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginTop: -54, borderWidth: 6, borderColor: colors.white },
  otpTitle: { color: colors.ink, fontSize: 23, fontWeight: "900", marginTop: 14 },
  otpText: { color: colors.gray, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 7 },
  adminOtpBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 11, backgroundColor: colors.bluePale, paddingHorizontal: 10, paddingVertical: 8, marginTop: 12 },
  adminOtpBadgeText: { color: colors.blueDark, fontSize: 9, fontWeight: "800" },
  otpInputArea: { alignSelf: "stretch", height: 86, marginVertical: 10, justifyContent: "center" },
  otpHiddenInput: { ...StyleSheet.absoluteFillObject, zIndex: 3, opacity: .01, color: "transparent", backgroundColor: "transparent" },
  otpBoxes: { flexDirection: "row", alignSelf: "stretch", justifyContent: "space-between" },
  otpBox: { width: 42, height: 52, borderRadius: 13, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  otpBoxActive: { borderColor: colors.blue, backgroundColor: colors.bluePale },
  otpBoxFilled: { borderColor: colors.green, backgroundColor: "#EAF9F2" },
  otpDigit: { color: colors.ink, fontSize: 21, fontWeight: "900" },
  demoOtp: { color: colors.orange, fontSize: 10, fontWeight: "800", marginTop: -12, marginBottom: 14 },
  otpResend: { minHeight: 43, alignItems: "center", justifyContent: "center", marginTop: 6 },
  otpResendText: { color: colors.blue, fontSize: 11, fontWeight: "800" },
  reportSuccessMessage: { color: colors.gray, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 },
  reportSuccessEmail: { color: colors.ink, fontSize: 13, fontWeight: "900", marginTop: 6, textAlign: "center" },
  logoBacking: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 7, backgroundColor: colors.white },
  logoBackingCompact: { paddingHorizontal: 3, paddingVertical: 2, borderRadius: 6 },
  brandLogoImage: { width: 106, height: 40 },
  brandLogoCompact: { width: 40, height: 31 },
  offlineRoadStage: { width: "100%", height: 66, overflow: "hidden", justifyContent: "flex-end", marginBottom: 14 },
  offlineRoad: { position: "absolute", bottom: 7, left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,.22)" },
  offlineVehicle: { position: "absolute", bottom: 12, width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", elevation: 5 },
  offlineCar: { backgroundColor: colors.green },
  offlineBike: { backgroundColor: colors.orange },
  offlineTukTuk: { backgroundColor: colors.blue },
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
  reportTypeRow: { flexDirection: "row", gap: 10 },
  reportTypeButton: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: colors.white },
  reportTypeButtonActive: { backgroundColor: colors.blue },
  reportTypeText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  reportTypeTextActive: { color: colors.white },
  monitorHero: { borderRadius: 20, padding: 18, backgroundColor: colors.blueDark, flexDirection: "row", alignItems: "center", gap: 14 },
  monitorHeroTitle: { color: colors.white, fontSize: 18, fontWeight: "900" },
  monitorHeroText: { color: "#BED0E3", fontSize: 10, lineHeight: 15, marginTop: 4 },
  monitorCard: { borderRadius: 18, padding: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  monitorRow: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 66 },
  monitorIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" },
  monitorTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  monitorCopy: { color: colors.gray, fontSize: 10, lineHeight: 15, marginTop: 3 },
  monitorDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: 5 },
  tamperCard: { borderRadius: 16, padding: 14, backgroundColor: "#EAF9F2", borderWidth: 1, borderColor: "#B8E5D2", flexDirection: "row", gap: 11, alignItems: "center" },
  tamperCardDanger: { backgroundColor: "#FEECEC", borderColor: "#F5A3A3" },
  monitorVehicleTampered: { borderColor: "#DC3B2A", backgroundColor: "#FEECEC" },
  reportPeriods: { gap: 7 },
  reportPeriod: { minHeight: 45, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  reportPeriodActive: { backgroundColor: colors.bluePale, borderColor: "#A8CCF5" },
  reportPeriodText: { color: colors.gray, fontSize: 11, fontWeight: "700" },
  reportPeriodTextActive: { color: colors.blueDark, fontWeight: "900" },
  reportProtectionNote: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 13, padding: 12, marginBottom: 12, backgroundColor: "#EAF9F3" },
  reportProtectionTitle: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  reportProtectionText: { color: colors.gray, fontSize: 9, lineHeight: 14, marginTop: 2 },
  payerPhoneHint: { color: colors.gray, fontSize: 9, lineHeight: 14, marginTop: -8, marginBottom: 12 },
  gpsAccuracyHint: { color: colors.gray, fontSize: 8, marginTop: 2 },
  gpsAccuracyValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  gpsAccuracyDot: { width: 8, height: 8, borderRadius: 4 },
  successBreakdown: { color: colors.ink, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 10 },
  successBalance: { color: colors.gray, fontSize: 10, fontWeight: "700", textAlign: "center", marginTop: 4 },
  fieldReadonly: { backgroundColor: "#E9EEF4" },
  flexiblePaymentText: { display: "none" },
  offlineQueueNote: { backgroundColor: "#FFF4E5" },
  dashboardVehiclePicker: { maxHeight: 174, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  dashboardVehiclePickerContent: { flexGrow: 0 },
  dashboardVehicleOption: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  dashboardVehicleActive: { backgroundColor: colors.bluePale },
  profilePhoto: { width: "100%", height: "100%", borderRadius: 25 },
  headerProfilePhoto: { width: 38, height: 38, borderRadius: 19, marginRight: 8, backgroundColor: colors.bluePale },
  welcomePhoto: { width: "100%", height: "100%", borderRadius: 15 },
  photoActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  photoButton: { minHeight: 34, paddingHorizontal: 11, borderRadius: 17, backgroundColor: colors.bluePale, flexDirection: "row", alignItems: "center", gap: 5 },
  photoButtonText: { color: colors.blue, fontSize: 10, fontWeight: "900" },
  removePhotoButton: { minHeight: 34, paddingHorizontal: 11, justifyContent: "center" },
  removePhotoText: { color: "#DC3B2A", fontSize: 10, fontWeight: "800" },
  themeOptions: { flexDirection: "row", gap: 9 },
  themeOption: { flex: 1, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  themeOptionActive: { backgroundColor: colors.blueDark, borderColor: colors.blueDark },
  themeOptionText: { color: colors.blueDark, fontSize: 11, fontWeight: "900" },
  themeOptionTextActive: { color: colors.white },
  darkPage: { backgroundColor: "#081829" },
  darkCard: { backgroundColor: "#10263B", borderColor: "#27435D" },
  darkHeader: { backgroundColor: "#10263B", borderBottomColor: "#27435D" },
  darkText: { color: colors.white },
  appShell: { flex: 1, backgroundColor: colors.blueDark }, main: { flex: 1, minWidth: 0, backgroundColor: colors.surface }, screen: { flex: 1 }, pageScroll: { flex: 1 }, pageContent: { padding: 14, paddingBottom: 36, gap: 14 }, drawerBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 25, backgroundColor: "rgba(7,29,54,.42)" }, offlineGate: { flex: 1, backgroundColor: colors.blueDark, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 }, offlinePulse: { width: 104, height: 104, borderRadius: 34, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginBottom: 25 }, offlineTitle: { color: colors.white, fontSize: 27, fontWeight: "900", textAlign: "center" }, offlineMessage: { color: "#C8D8EA", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 10, marginBottom: 24 }, offlineRetry: { width: "100%", minHeight: 50, borderRadius: 14, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, offlineRetryText: { color: colors.blueDark, fontSize: 13, fontWeight: "900" }, offlineContinue: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 8 }, offlineContinueText: { color: colors.white, fontSize: 12, fontWeight: "800" }, offlineBanner: { minHeight: 28, backgroundColor: colors.orange, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 }, offlineBannerText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  approvalPage: { flex: 1, backgroundColor: colors.blueDark, paddingHorizontal: 25, paddingTop: 54, overflow: "hidden" }, approvalGlow: { position: "absolute", width: 330, height: 330, borderRadius: 165, backgroundColor: "rgba(9,105,218,.22)", top: -120, right: -120 }, approvalIcon: { width: 90, height: 90, borderRadius: 30, backgroundColor: "#FFF4DF", alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 55 }, approvalTitle: { color: colors.white, fontSize: 25, fontWeight: "900", textAlign: "center", marginTop: 22 }, approvalText: { color: "#C8D8EA", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 10 }, approvalSteps: { backgroundColor: "rgba(255,255,255,.08)", borderRadius: 18, padding: 17, marginTop: 28 }, approvalStep: { flexDirection: "row", alignItems: "center", gap: 11 }, approvalStepText: { color: colors.white, fontSize: 12, fontWeight: "700" }, approvalLine: { width: 2, height: 18, backgroundColor: "rgba(255,255,255,.16)", marginLeft: 10, marginVertical: 4 }, approvalButton: { minHeight: 50, borderRadius: 14, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 24 },
  gpsLaunch: { flex: 1, backgroundColor: colors.blueDark, paddingHorizontal: 25 }, gpsActivity: { flex: 1, justifyContent: "center", paddingBottom: 30 }, gpsStage: { height: 260, alignItems: "center", justifyContent: "center", overflow: "hidden" }, gpsRing: { position: "absolute", width: 145, height: 145, borderRadius: 73, backgroundColor: "rgba(9,105,218,.58)" }, gpsCore: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.blue, borderWidth: 7, borderColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" }, loadingRoad: { position: "absolute", bottom: 20, left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,.2)" }, movingVehicle: { position: "absolute", bottom: 25, width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center", shadowOpacity: .4, shadowRadius: 10, elevation: 7 }, movingCar: { backgroundColor: colors.green, shadowColor: colors.green }, movingBike: { backgroundColor: colors.orange, shadowColor: colors.orange }, movingTukTuk: { backgroundColor: colors.blue, shadowColor: colors.blue }, gpsWelcome: { color: "#71D9B3", fontSize: 14, fontWeight: "900", textAlign: "center", letterSpacing: .4 }, gpsTitle: { color: colors.white, fontSize: 24, fontWeight: "900", textAlign: "center", marginTop: 5 }, gpsText: { color: "#BED0E3", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 }, gpsDots: { flexDirection: "row", justifyContent: "center", gap: 9, marginTop: 22 }, gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  skeletonPage: { flex: 1, padding: 14, gap: 14 }, skeleton: { backgroundColor: "#DDE7F2", borderRadius: 14 }, skeletonHero: { height: 140, borderRadius: 20 }, skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, skeletonStat: { width: "47.8%", height: 104 }, skeletonTitle: { width: "46%", height: 18, marginTop: 5 }, skeletonCard: { height: 260, borderRadius: 18 }, skeletonAction: { width: "47.8%", height: 68 }, skeletonAuthCard: { height: 82, borderRadius: 18 }, skeletonAuthFooter: { width: "62%", height: 12, alignSelf: "center" }, mapSkeleton: { flex: 1, backgroundColor: "#E7EDF2" }, skeletonSearch: { position: "absolute", zIndex: 2, top: 12, left: 12, right: 64, height: 44 }, skeletonMapControls: { position: "absolute", zIndex: 2, top: 12, right: 12, gap: 9 }, skeletonMapButton: { width: 42, height: 42, borderRadius: 21 }, skeletonMapPin: { position: "absolute", top: "43%", left: "45%", width: 48, height: 48, borderRadius: 24 }, skeletonMapSheet: { position: "absolute", left: 9, right: 9, bottom: -5, height: 195, borderRadius: 23 }, skeletonPaymentHero: { height: 170, borderRadius: 20 }, skeletonLabel: { width: "52%", height: 13 }, skeletonChipRow: { flexDirection: "row", gap: 8 }, skeletonChip: { width: 82, height: 34, borderRadius: 17 }, skeletonSmallLabel: { width: 100, height: 10, marginBottom: 7 }, skeletonInput: { height: 51 }, skeletonNotice: { height: 62, borderRadius: 13 }, skeletonSubmit: { height: 50 }, skeletonListPage: { flex: 1, paddingTop: 8 }, skeletonSummary: { height: 178, margin: 16, borderRadius: 22 }, skeletonListHeading: { width: 175, height: 22, margin: 18 }, skeletonListRow: { height: 82, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, skeletonAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 }, skeletonListBody: { flex: 1, gap: 7 }, skeletonRowTitle: { width: "42%", height: 12 }, skeletonRowText: { width: "77%", height: 9 }, skeletonRowShort: { width: "25%", height: 8 }, skeletonTableHead: { height: 40, borderRadius: 8 }, skeletonTableRow: { height: 67, borderRadius: 8 }, skeletonProfileAvatar: { width: 76, height: 76, borderRadius: 25, alignSelf: "center", marginTop: 6 }, skeletonProfileName: { width: 145, height: 20, alignSelf: "center" }, skeletonSettingsCard: { height: 300, borderRadius: 18 },
  successOverlay: { flex: 1, backgroundColor: "rgba(7,29,54,.72)", alignItems: "center", justifyContent: "center", padding: 24 }, successCard: { width: "100%", maxWidth: 370, backgroundColor: colors.white, borderRadius: 26, padding: 22, alignItems: "center" }, successIcon: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", marginTop: -58, borderWidth: 7, borderColor: colors.white, shadowColor: colors.green, shadowOpacity: .3, shadowRadius: 14, elevation: 8 }, successTitle: { color: colors.ink, fontSize: 23, fontWeight: "900", marginTop: 14 }, successAmount: { color: colors.green, fontSize: 29, fontWeight: "900", marginTop: 10 }, successVehicle: { color: colors.gray, fontSize: 12, fontWeight: "700", marginTop: 3 }, receiptBox: { alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 15, padding: 14, alignItems: "center", marginVertical: 20 }, receiptLabel: { color: colors.gray, fontSize: 8, fontWeight: "900", letterSpacing: 1 }, receiptId: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 5, letterSpacing: .8 }, receiptTime: { color: colors.gray, fontSize: 9, marginTop: 4 },
  logoRow: { flexDirection: "row", alignItems: "center" }, logo: { width: 39, height: 39, borderRadius: 12, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginRight: 10 }, logoCompact: { marginRight: 0 }, logoText: { color: colors.white, fontSize: 24, fontWeight: "900" }, brandName: { color: colors.white, fontSize: 15, fontWeight: "900", letterSpacing: 1.2 }, brandSub: { color: "#AFC6E0", fontSize: 8, fontWeight: "700", letterSpacing: 1.4, marginTop: 2 },
  authPage: { flex: 1, backgroundColor: colors.surface }, authHero: { height: 260, backgroundColor: colors.blueDark, paddingTop: 54, paddingHorizontal: 25, overflow: "hidden" }, authOrbOne: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(9,105,218,.28)", right: -55, top: -55 }, authOrbTwo: { position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 28, borderColor: "rgba(255,255,255,.05)", right: 28, bottom: -70 }, authHeading: { color: colors.white, fontSize: 30, fontWeight: "900", marginTop: 30 }, authLead: { color: "#C8D8EA", fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330 }, authCard: { flex: 1, marginTop: -20, backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22 }, authTabs: { flexDirection: "row", backgroundColor: colors.surface, padding: 4, borderRadius: 14, marginBottom: 20 }, authTab: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 11 }, authTabActive: { backgroundColor: colors.white, shadowColor: colors.ink, shadowOpacity: .1, shadowRadius: 8, elevation: 3 }, authTabText: { color: colors.gray, fontWeight: "800" }, authTabTextActive: { color: colors.blue },
  fieldWrap: { marginBottom: 14 }, fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: "800", marginBottom: 7 }, field: { height: 51, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, fieldInput: { flex: 1, marginLeft: 10, color: colors.ink, fontSize: 14 }, forgot: { color: colors.blue, fontWeight: "700", fontSize: 13, textAlign: "right", marginBottom: 16 }, primaryButton: { minHeight: 50, borderRadius: 14, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 16 }, primaryButtonText: { color: colors.white, fontWeight: "900", fontSize: 14 }, authFormScroll: { flex: 1 }, copyright: { color: colors.gray, fontSize: 9, textAlign: "center", paddingTop: 2, paddingBottom: 18, transform: [{ translateY: -22 }] }, resetIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 6 }, resetTitle: { color: colors.ink, fontSize: 19, fontWeight: "900", textAlign: "center", marginTop: 12 }, resetCopy: { color: colors.gray, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 5, marginBottom: 20 }, backToLogin: { minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", marginTop: 8 }, backToLoginText: { color: colors.blue, fontSize: 12, fontWeight: "800" }, buttonPressed: { opacity: .82, transform: [{ scale: .97 }] }, disabledButton: { opacity: .45 },
  drawer: { position: "absolute", zIndex: 30, left: 0, top: 0, bottom: 0, backgroundColor: colors.blueDark, overflow: "hidden", shadowColor: colors.ink, shadowOpacity: .24, shadowRadius: 14, elevation: 30 }, drawerTop: { height: 78, minWidth: DRAWER_OPEN, paddingTop: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,.08)" }, drawerToggle: { width: 36, height: 36, borderRadius: 11, backgroundColor: "rgba(255,255,255,.1)", alignItems: "center", justifyContent: "center" }, drawerScroll: { flex: 1 }, drawerMenu: { paddingHorizontal: 5, paddingTop: 9, paddingBottom: 20, gap: 7 }, drawerItem: { width: DRAWER_OPEN - 10, height: 48, borderRadius: 13, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" }, drawerItemActive: { backgroundColor: colors.blue }, drawerLabel: { color: "#BED0E3", fontWeight: "700", fontSize: 13, marginLeft: 14 }, drawerLabelActive: { color: colors.white }, menuBadge: { position: "absolute", top: -8, right: -11, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.blueDark }, menuBadgeText: { color: colors.white, fontSize: 8, fontWeight: "900" }, logout: { width: DRAWER_OPEN, minHeight: 60, borderTopWidth: 1, borderColor: "rgba(255,255,255,.09)", paddingHorizontal: 17, flexDirection: "row", alignItems: "center" }, logoutText: { color: "#F9A8A8", marginLeft: 14, fontWeight: "800" },
  pageHeader: { height: 70, zIndex: 20, elevation: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }, headerMenu: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" }, headerTitleWrap: { flex: 1, minWidth: 0, marginHorizontal: 11 }, pageTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" }, pageSubtitle: { color: colors.gray, fontSize: 10, marginTop: 2 }, headerBell: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" }, headerBadge: { position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" }, headerBadgeText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  welcomeCard: { backgroundColor: colors.blueDark, borderRadius: 20, padding: 18, flexDirection: "row", gap: 13 }, welcomeIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" }, eyebrow: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 }, welcomeName: { color: colors.white, fontSize: 21, fontWeight: "900", marginTop: 3 }, welcomeCopy: { color: "#BED0E3", fontSize: 11, lineHeight: 16, marginTop: 4 }, statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, statCard: { width: "47.8%", minHeight: 112, backgroundColor: colors.white, borderRadius: 17, padding: 14, borderWidth: 1, borderColor: colors.line }, statIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" }, statValue: { color: colors.ink, fontWeight: "900", fontSize: 19, marginTop: 7 }, statLabel: { color: colors.gray, fontSize: 10, marginTop: 2 }, sectionTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 5 }, sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" }, sectionAction: { color: colors.blue, fontSize: 12, fontWeight: "800" },
  card: { backgroundColor: colors.white, borderRadius: 18, padding: 15, borderWidth: 1, borderColor: colors.line }, cardSelected: { borderColor: colors.blue, borderWidth: 1.5 }, bikeTop: { flexDirection: "row", alignItems: "center", gap: 10 }, bikeIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" }, cardTitle: { color: colors.ink, fontWeight: "900", fontSize: 15 }, cardSub: { color: colors.gray, fontSize: 10, marginTop: 3 }, statusPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 }, statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 }, statusText: { fontSize: 9, fontWeight: "900" }, financeStrip: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: 13, padding: 12, marginTop: 13 }, microLabel: { color: colors.gray, fontSize: 8, fontWeight: "800", letterSpacing: .8 }, financeValue: { color: colors.ink, fontWeight: "900", fontSize: 15, marginTop: 3 }, financeStatus: { color: colors.green, fontWeight: "800", fontSize: 12, marginTop: 4, textAlign: "right" }, nextPayment: { color: colors.gray, fontSize: 10, marginTop: 9 }, cardActions: { flexDirection: "row", gap: 9, marginTop: 13 }, outlineButton: { flex: 1, minHeight: 41, borderRadius: 12, borderWidth: 1, borderColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, outlineButtonText: { color: colors.blue, fontSize: 11, fontWeight: "900" }, smallPrimary: { flex: 1, minHeight: 41, borderRadius: 12, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, smallPrimaryText: { color: colors.white, fontSize: 11, fontWeight: "900" }, quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, quickAction: { width: "47.8%", backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 }, quickIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" }, quickText: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  infoCallout: { borderLeftWidth: 4, borderLeftColor: colors.blue, backgroundColor: colors.bluePale, borderRadius: 13, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 }, infoCalloutText: { flex: 1, color: colors.ink, fontSize: 11, lineHeight: 17, fontWeight: "600" }, paymentHero: { backgroundColor: colors.blueDark, borderRadius: 20, padding: 18 }, paymentBike: { color: colors.white, fontWeight: "900", fontSize: 24, marginTop: 6 }, paymentModel: { color: "#BED0E3", fontSize: 12, marginTop: 2 }, balanceRow: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,.14)", paddingTop: 14, marginTop: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, balanceLabel: { color: "#BED0E3", fontSize: 11 }, balanceValue: { color: colors.white, fontWeight: "900", fontSize: 17 }, bikeChips: { flexGrow: 0, marginTop: -6, marginBottom: 2 }, bikeChip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 }, bikeChipActive: { backgroundColor: colors.blue, borderColor: colors.blue }, bikeChipText: { color: colors.gray, fontSize: 11, fontWeight: "800" }, bikeChipTextActive: { color: colors.white }, agreedPaymentNote: { borderRadius: 12, backgroundColor: colors.bluePale, padding: 12, marginBottom: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, agreedPaymentValue: { color: colors.blueDark, fontSize: 14, fontWeight: "900" }, secureNote: { flexDirection: "row", gap: 8, backgroundColor: "#EAF9F2", borderRadius: 12, padding: 12, marginBottom: 2 }, secureNoteText: { flex: 1, color: "#17684C", fontSize: 10, lineHeight: 15, fontWeight: "600" },
  vehicleTablePage: { padding: 14, paddingBottom: 34, gap: 14 }, vehicleTable: { overflow: "hidden", borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, vehicleTableHeader: { minHeight: 40, paddingHorizontal: 9, backgroundColor: colors.blueDark, flexDirection: "row", alignItems: "center" }, vehicleHeadText: { color: colors.white, fontSize: 7, fontWeight: "900", letterSpacing: .35 }, vehicleColMain: { width: "35%" }, vehicleColBalance: { width: "19%" }, vehicleColStatus: { width: "20%", flexDirection: "row", alignItems: "center" }, vehicleColNext: { width: "26%" }, vehicleRow: { minHeight: 67, paddingHorizontal: 9, paddingVertical: 9, flexDirection: "row", alignItems: "center", backgroundColor: colors.white }, vehicleRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line }, vehicleRowSelected: { backgroundColor: "#F1F7FF" }, vehicleNameCell: { flexDirection: "row", alignItems: "center", gap: 6 }, vehiclePlate: { color: colors.ink, fontSize: 10, fontWeight: "900" }, vehicleModel: { color: colors.gray, fontSize: 7, marginTop: 2 }, vehicleCellText: { color: colors.ink, fontSize: 9, fontWeight: "800" }, tableStatusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 }, tableStatusText: { fontSize: 8, fontWeight: "900" }, vehicleNextText: { color: colors.ink, fontSize: 8, lineHeight: 11 }, tableHint: { color: colors.gray, fontSize: 10, textAlign: "center" },
  summaryCard: { backgroundColor: colors.bluePale, borderRadius: 18, padding: 17, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, summaryValue: { color: colors.ink, fontSize: 22, fontWeight: "900", marginTop: 5 }, transaction: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.line, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 }, transactionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#EAF9F2", alignItems: "center", justifyContent: "center" }, transactionTitle: { color: colors.ink, fontWeight: "900", fontSize: 12 }, transactionMeta: { color: colors.gray, fontSize: 8, marginTop: 4 }, transactionAmount: { color: colors.ink, fontWeight: "900", fontSize: 11 }, confirmed: { color: colors.green, fontSize: 8, marginTop: 3, fontWeight: "800" },
  nativeListPage: { flex: 1, backgroundColor: colors.white }, nativeListContent: { paddingBottom: 32 }, nativeSummary: { margin: 16, marginBottom: 8, borderRadius: 22, padding: 20, backgroundColor: colors.blueDark, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, nativeSummaryLabel: { color: "#AFC6E0", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 }, nativeSummaryValue: { color: colors.white, fontSize: 27, fontWeight: "900", marginTop: 6 }, nativeSummaryMeta: { color: "#AFC6E0", fontSize: 10, marginTop: 3 }, nativeSummaryIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" }, nativeListHeading: { color: colors.ink, fontSize: 18, fontWeight: "900", marginHorizontal: 18, marginTop: 16, marginBottom: 9 }, nativeList: { backgroundColor: colors.white }, nativeRow: { minHeight: 82, paddingHorizontal: 17, paddingVertical: 12, flexDirection: "row", alignItems: "center" }, nativeRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, nativeRowUnread: { backgroundColor: "#F3F8FF" }, nativeAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginRight: 12 }, nativeAvatarOrange: { backgroundColor: colors.orange }, nativeAvatarGreen: { backgroundColor: colors.green }, nativeRowBody: { flex: 1, minWidth: 0 }, nativeRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, nativeRowTitle: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "900" }, nativeRowTime: { color: colors.gray, fontSize: 9 }, nativeRowMessage: { color: colors.gray, fontSize: 10, lineHeight: 15, marginTop: 3 }, nativeRowStatus: { color: colors.green, fontSize: 9, fontWeight: "800", marginTop: 3 }, nativeRowAmount: { color: colors.ink, fontSize: 11, fontWeight: "900", marginTop: 8 }, paymentRowMeta: { width: 92, marginLeft: 10, alignItems: "flex-end", justifyContent: "center" }, nativeUnreadBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginLeft: 8 }, nativeUnreadText: { color: colors.white, fontSize: 9, fontWeight: "900" }, nativeListToolbar: { paddingHorizontal: 2, paddingVertical: 9, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, nativeToolbarSub: { color: colors.gray, fontSize: 10, marginLeft: 18, marginTop: -5 }, markReadButton: { marginRight: 16, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.bluePale, flexDirection: "row", alignItems: "center", gap: 5 }, markReadText: { color: colors.blue, fontSize: 9, fontWeight: "900" },
  alertHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, alertCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 13, flexDirection: "row", gap: 11 }, alertUnread: { borderColor: "#A8CCF5", backgroundColor: "#F9FCFF" }, alertIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" }, alertTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, alertTitle: { color: colors.ink, fontWeight: "900", fontSize: 12 }, unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blue }, alertMessage: { color: colors.gray, fontSize: 10, lineHeight: 15, marginTop: 4 }, alertAge: { color: "#94A3B8", fontSize: 8, marginTop: 5 }, selectionActions: { flexDirection: "row", gap: 6, marginRight: 12 }, selectionButton: { minHeight: 34, paddingHorizontal: 9, borderRadius: 17, backgroundColor: colors.bluePale, flexDirection: "row", alignItems: "center", gap: 4 }, deleteButton: { backgroundColor: "#FDECEC" }, deleteText: { color: "#DC3B2A", fontSize: 9, fontWeight: "900" }, selectionCheck: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginRight: 9 }, selectionCheckActive: { backgroundColor: colors.blue, borderColor: colors.blue }, nativeRowSelected: { backgroundColor: "#E7F1FF" }, emptyAlerts: { alignItems: "center", justifyContent: "center", paddingVertical: 65 },
  profileHero: { alignItems: "center", paddingVertical: 15 }, avatar: { width: 76, height: 76, borderRadius: 25, backgroundColor: colors.blueDark, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontSize: 23, fontWeight: "900" }, profileName: { color: colors.ink, fontSize: 21, fontWeight: "900", marginTop: 10 }, profileId: { color: colors.gray, fontSize: 10, marginTop: 3 }, profileRow: { flexDirection: "row", gap: 11, alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line }, profileRowIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center" }, profileValue: { color: colors.ink, fontSize: 12, fontWeight: "700", marginTop: 3 }, settingsSection: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 15 }, settingsTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" }, settingsCopy: { color: colors.gray, fontSize: 10, lineHeight: 15, marginTop: 4, marginBottom: 16 }, readonlyField: { minHeight: 57, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 14, marginBottom: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  mapContainer: { flex: 1, backgroundColor: colors.surface }, mapState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, stateTitle: { color: colors.ink, fontWeight: "900", fontSize: 18, marginTop: 14, textAlign: "center" }, stateMessage: { color: colors.gray, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7 }, tryButton: { marginTop: 18, backgroundColor: colors.blue, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }, mapControls: { position: "absolute", right: 12, top: 12, gap: 8 }, roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,.96)", alignItems: "center", justifyContent: "center", shadowColor: colors.ink, shadowOpacity: .17, shadowRadius: 7, elevation: 5 }, roundButtonActive: { backgroundColor: colors.blue }, bikeMarker: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.blue, borderWidth: 4, borderColor: colors.white, alignItems: "center", justifyContent: "center", elevation: 8 }, fleetMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.blue, alignItems: "center", justifyContent: "center", elevation: 5 }, phoneMarker: { width: 27, height: 27, borderRadius: 14, backgroundColor: "rgba(9,105,218,.25)", alignItems: "center", justifyContent: "center" }, phoneMarkerInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.blue, borderWidth: 2, borderColor: colors.white }, vehiclePicker: { position: "absolute", left: 10, right: 64, top: 10, zIndex: 12 }, vehiclePickerInput: { height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,.98)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, shadowColor: colors.ink, shadowOpacity: .15, shadowRadius: 8, elevation: 7 }, vehicleSearchInput: { flex: 1, color: colors.ink, fontSize: 11, marginHorizontal: 7, paddingVertical: 0 }, vehicleDropdown: { marginTop: 6, maxHeight: 220, overflow: "hidden", borderRadius: 14, backgroundColor: colors.white, shadowColor: colors.ink, shadowOpacity: .2, shadowRadius: 10, elevation: 10 }, vehicleDropdownRow: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, vehicleDropdownSelected: { backgroundColor: colors.bluePale }, vehicleDropdownIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.bluePale, alignItems: "center", justifyContent: "center", marginRight: 9 }, vehicleDropdownPlate: { color: colors.ink, fontSize: 11, fontWeight: "900" }, vehicleDropdownModel: { color: colors.gray, fontSize: 8, marginTop: 2 }, noVehicleText: { color: colors.gray, fontSize: 11, padding: 16, textAlign: "center" }, mapError: { position: "absolute", top: 62, left: 10, right: 64, borderRadius: 12, padding: 10, backgroundColor: "rgba(255,255,255,.97)", flexDirection: "row", gap: 7 }, mapErrorText: { flex: 1, color: colors.ink, fontSize: 9 }, mapSheet: { position: "absolute", left: 9, right: 9, bottom: -284, height: 544, borderRadius: 23, paddingHorizontal: 17, backgroundColor: colors.white, shadowColor: colors.ink, shadowOpacity: .2, shadowRadius: 20, elevation: 16 }, handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: "center", marginTop: 9, marginBottom: 12 }, sheetBike: { color: colors.ink, fontSize: 17, fontWeight: "900" }, mapMetrics: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginTop: 13 }, speed: { color: colors.ink, fontSize: 22, fontWeight: "900", marginTop: 4 }, speedUnit: { color: colors.gray, fontSize: 10 }, lastUpdate: { color: colors.ink, fontSize: 12, fontWeight: "800", marginTop: 8 }, metricDivider: { width: 1, backgroundColor: colors.line, marginHorizontal: 12 }, sheetExpanded: { paddingTop: 15 }, sheetDetail: { flexDirection: "row", justifyContent: "space-between" }, detailStrong: { color: colors.ink, fontSize: 11, fontWeight: "800" }, rangeRow: { flexDirection: "row", gap: 5, marginTop: 12 }, rangeButton: { flex: 1, borderRadius: 9, backgroundColor: colors.surface, alignItems: "center", paddingVertical: 8 }, rangeActive: { backgroundColor: colors.bluePale }, rangeText: { color: colors.gray, fontSize: 9, fontWeight: "700" }, rangeTextActive: { color: colors.blue }, fullRouteButton: { marginTop: 13, flex: 0 }, tripRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 12 }, tripText: { color: colors.ink, fontSize: 10, fontWeight: "800" },
});
