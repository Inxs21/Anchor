import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { getEpisodeFingerprint } from '@/lib/checkins';

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  const router   = useRouter();
  const segments = useSegments();

  const [fpChecked,    setFpChecked]    = useState(false);
  const [hasFingerprint, setHasFingerprint] = useState(false);

  // Check fingerprint on login AND whenever the active route group changes
  // (so navigating away from onboarding after saving re-reads the value)
  useEffect(() => {
    if (!user) {
      setFpChecked(false);
      setHasFingerprint(false);
      return;
    }
    setFpChecked(false);
    getEpisodeFingerprint(user.uid).then((fp) => {
      setHasFingerprint(fp !== null);
      setFpChecked(true);
    });
  }, [user?.uid, segments[0]]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup       = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
      return;
    }

    if (user && inAuthGroup) {
      // Just signed in — wait for fingerprint check before routing
      if (!fpChecked) return;
      if (!hasFingerprint) {
        router.replace('/(onboarding)/fingerprint');
      } else {
        router.replace('/');
      }
      return;
    }

    if (user && !fpChecked) return;

    if (user && !hasFingerprint && !inOnboardingGroup) {
      router.replace('/(onboarding)/fingerprint');
    }
  }, [user, loading, segments, fpChecked, hasFingerprint]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
        <Stack.Screen name="(auth)"        options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)"  options={{ headerShown: false }} />
        <Stack.Screen name="modal"         options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
