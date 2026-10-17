import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Ocean } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Ocean.accent,
        tabBarInactiveTintColor: Ocean.textMuted,
        tabBarStyle: {
          backgroundColor: Ocean.tabBar,
          borderTopColor: Ocean.tabBarBorder,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: Ocean.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="companion"
        options={{
          title: 'Talk',
          tabBarIcon: ({ color, size }) => <Ionicons name="mic" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="meds"
        options={{
          title: 'Meds',
          tabBarIcon: ({ color, size }) => <Ionicons name="medical" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Report',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
