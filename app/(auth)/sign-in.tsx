import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
} from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { Ocean } from "@/constants/theme";

// ─── Anchor Logo ──────────────────────────────────────────────────────────────

function AnchorIcon({ size = 52, color = Ocean.accent }: { size?: number; color?: string }) {
  const sw    = Math.max(2, Math.round(size * 0.09));
  const ringD = size * 0.34;
  const ringR = ringD / 2;
  const cx    = size / 2;
  const armY  = ringD + size * 0.14;
  const armW  = size * 0.76;
  const botD  = size * 0.28;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: ringD, height: ringD, borderRadius: ringR, borderWidth: sw, borderColor: color, position: "absolute", top: 0, left: cx - ringR }} />
      <View style={{ width: sw, height: size * 0.48, backgroundColor: color, position: "absolute", top: ringD, left: cx - sw / 2 }} />
      <View style={{ width: armW, height: sw, backgroundColor: color, position: "absolute", top: armY, left: (size - armW) / 2 }} />
      <View style={{ width: botD, height: botD, borderRadius: botD / 2, borderWidth: sw, borderColor: color, borderTopColor: "transparent", borderRightColor: "transparent", position: "absolute", bottom: size * 0.01, left: size * 0.06, transform: [{ rotate: "20deg" }] }} />
      <View style={{ width: botD, height: botD, borderRadius: botD / 2, borderWidth: sw, borderColor: color, borderTopColor: "transparent", borderLeftColor: "transparent", position: "absolute", bottom: size * 0.01, right: size * 0.06, transform: [{ rotate: "-20deg" }] }} />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  async function handleSignIn() {
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (e: any) {
      setError(e.message ?? "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

          {/* Logo */}
          <View style={styles.logoWrap}>
            <View style={styles.logoBg}>
              <AnchorIcon size={40} color={Ocean.accent} />
            </View>
            <Text style={styles.appName}>Anchor</Text>
          </View>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Ocean.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Ocean.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity style={styles.btn} onPress={handleSignIn} disabled={loading} activeOpacity={0.85}>
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Sign In</Text>
              }
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/sign-up" asChild>
              <TouchableOpacity>
                <Text style={styles.link}>Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>

        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Ocean.bg },
  kav:     { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },

  logoWrap: { alignItems: "center", marginBottom: 40 },
  logoBg: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: Ocean.accentDim,
    borderWidth: 1, borderColor: Ocean.accent,
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  appName: { fontSize: 22, fontWeight: "700", color: Ocean.textPrimary, letterSpacing: 1 },

  title:    { fontSize: 28, fontWeight: "700", color: Ocean.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 15, color: Ocean.textSecondary, marginBottom: 32 },

  form: { gap: 14 },

  input: {
    backgroundColor: Ocean.card,
    borderWidth: 1, borderColor: Ocean.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    fontSize: 16, color: Ocean.textPrimary,
  },

  error: { color: Ocean.danger, fontSize: 13, marginTop: -4 },

  btn: {
    backgroundColor: Ocean.accent,
    borderRadius: 14, paddingVertical: 16,
    alignItems: "center", marginTop: 6,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  footer:     { flexDirection: "row", justifyContent: "center", marginTop: 28 },
  footerText: { color: Ocean.textSecondary, fontSize: 15 },
  link:       { color: Ocean.accent, fontWeight: "700", fontSize: 15 },
});
