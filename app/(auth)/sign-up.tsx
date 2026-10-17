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
  ScrollView,
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

export default function SignUp() {
  const { signUp } = useAuth();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  async function handleSignUp() {
    if (!name || !email || !password || !confirm) { setError("Please fill in all fields."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 6)  { setError("Password must be at least 6 characters."); return; }
    setError("");
    setLoading(true);
    try {
      await signUp(email, password, name);
    } catch (e: any) {
      setError(e.message ?? "Sign up failed.");
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Logo */}
            <View style={styles.logoWrap}>
              <View style={styles.logoBg}>
                <AnchorIcon size={40} color={Ocean.accent} />
              </View>
              <Text style={styles.appName}>Anchor</Text>
            </View>

            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Your personal mental health companion</Text>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="First name"
                placeholderTextColor={Ocean.textMuted}
                autoCapitalize="words"
                value={name}
                onChangeText={setName}
              />
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
              <TextInput
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor={Ocean.textMuted}
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
              />

              {!!error && <Text style={styles.error}>{error}</Text>}

              <TouchableOpacity style={styles.btn} onPress={handleSignUp} disabled={loading} activeOpacity={0.85}>
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnText}>Create Account</Text>
                }
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <Link href="/(auth)/sign-in" asChild>
                <TouchableOpacity>
                  <Text style={styles.link}>Sign In</Text>
                </TouchableOpacity>
              </Link>
            </View>

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Ocean.bg },
  kav:    { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 40 },
  content: {},

  logoWrap: { alignItems: "center", marginBottom: 28 },
  logoBg: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: Ocean.accentDim,
    borderWidth: 1, borderColor: Ocean.accent,
    alignItems: "center", justifyContent: "center",
    marginBottom: 10,
  },
  appName: { fontSize: 22, fontWeight: "700", color: Ocean.textPrimary, letterSpacing: 1 },

  title:    { fontSize: 26, fontWeight: "700", color: Ocean.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: Ocean.textSecondary, marginBottom: 24 },

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
