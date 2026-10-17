import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AnchorProvider } from '@/lib/anchor';
import { getFingerprint } from '@/lib/fingerprint';
import { Ocean } from '@/constants/theme';

type FpState = 'unknown' | 'yes' | 'no' | 'error';

function Gate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuth = segments[0] === '(auth)';
  const inOnboarding = segments[0] === '(onboarding)';
  const [fp, setFp] = useState<FpState>('unknown');

  // Probe onboarding state for the signed-in user
  useEffect(() => {
    const uid = user?.uid;
    setFp('unknown');
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getFingerprint(uid);
        if (!cancelled) setFp(data ? 'yes' : 'no');
      } catch {
        // Transient read failure: let the app open instead of dumping into onboarding
        if (!cancelled) setFp('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (!inAuth) router.replace('/(auth)/sign-in');
      return;
    }
    if (fp === 'unknown') return;
    if (inAuth) {
      router.replace(fp === 'no' ? '/(onboarding)/fingerprint' : '/');
      return;
    }
    if (fp === 'no' && !inOnboarding) {
      // Flag may be stale right after onboarding saved it — verify before bouncing
      let cancelled = false;
      getFingerprint(user.uid)
        .then((data) => {
          if (cancelled) return;
          if (data) setFp('yes');
          else router.replace('/(onboarding)/fingerprint');
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    if (fp !== 'no' && inOnboarding) router.replace('/');
  }, [loading, user, fp, inAuth, inOnboarding, router]);

  if (loading || (user && fp === 'unknown')) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={Ocean.accent} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate>
          {/*
            The provider sits at the root, not on the tab layout: `checkin` and
            `report` are siblings of `(tabs)`, so a provider mounted inside the
            group is not in their tree and `useAnchor` would throw there.
          */}
          <AnchorProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: Ocean.bg },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="checkin" options={{ presentation: 'modal' }} />
              <Stack.Screen name="report" options={{ presentation: 'modal' }} />
            </Stack>
          </AnchorProvider>
        </Gate>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  boot: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
});
