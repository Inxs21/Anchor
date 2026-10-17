import { Stack } from 'expo-router';
import { Ocean } from '@/constants/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Ocean.bg },
      }}
    />
  );
}
