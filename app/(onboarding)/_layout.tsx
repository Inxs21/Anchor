import { Stack } from 'expo-router';
import { Ocean } from '@/constants/theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Ocean.bg },
      }}
    />
  );
}
