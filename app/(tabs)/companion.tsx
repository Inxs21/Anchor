import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAnchor } from '@/lib/anchor';
import { companionReply, type ChatMessage } from '@/lib/claude';
import { speak, stopSpeaking } from '@/lib/voice';
import { StateBadge } from '@/components/StateBadge';
import { Ocean, radius, stateColor } from '@/constants/theme';

type Bubble = ChatMessage & { id: string };

let seq = 0;
const nextId = () => `m${++seq}`;

export default function Companion() {
  const router = useRouter();
  const { loading, today, companionContext } = useAnchor();
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const listRef = useRef<FlatList<Bubble>>(null);
  const opened = useRef(false);

  const tone = today?.analysis?.tone ?? 'steady';
  const state = today?.analysis?.state ?? 'stable';

  const say = useCallback(
    (text: string) => {
      if (speakReplies) speak(text, tone).catch(() => {});
    },
    [speakReplies, tone],
  );

  // The companion opens the conversation, already holding today's context.
  useEffect(() => {
    if (loading || opened.current) return;
    opened.current = true;
    setThinking(true);
    companionReply(companionContext, [])
      .then(({ text }) => {
        setMessages([{ id: nextId(), role: 'assistant', content: text }]);
        say(text);
      })
      .catch(() => {})
      .finally(() => setThinking(false));
  }, [loading, companionContext, say]);

  useEffect(() => {
    return () => {
      stopSpeaking().catch(() => {});
    };
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    await stopSpeaking().catch(() => {});

    const history: ChatMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ];
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }]);
    setInput('');
    setThinking(true);

    const { text: reply } = await companionReply(companionContext, history);
    setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: reply }]);
    setThinking(false);
    say(reply);
  };

  const toggleVoice = async () => {
    if (speakReplies) await stopSpeaking().catch(() => {});
    setSpeakReplies((v) => !v);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={Ocean.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Anchor</Text>
          <Text style={styles.subtitle}>
            {tone === 'grounding'
              ? 'Keeping things slow and steady'
              : tone === 'activating'
                ? 'Low pressure — no big asks'
                : 'Here whenever you want to talk'}
          </Text>
        </View>
        <TouchableOpacity onPress={toggleVoice} hitSlop={10} style={styles.voiceToggle}>
          <Ionicons
            name={speakReplies ? 'volume-high' : 'volume-mute'}
            size={20}
            color={speakReplies ? Ocean.accent : Ocean.textMuted}
          />
        </TouchableOpacity>
      </View>

      {today ? (
        <View style={styles.contextStrip}>
          <StateBadge state={state} size="sm" />
          <Text style={styles.contextText} numberOfLines={1}>
            Today&apos;s check-in is in context
          </Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.nudge} onPress={() => router.push('/checkin')}>
          <Ionicons name="mic" size={16} color={Ocean.accent} />
          <Text style={styles.nudgeText}>
            Check in first and Anchor will know how today is going.
          </Text>
          <Ionicons name="chevron-forward" size={16} color={Ocean.accent} />
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const mine = item.role === 'user';
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                <Text style={[styles.bubbleText, mine && styles.mineText]}>{item.content}</Text>
              </View>
            );
          }}
          ListFooterComponent={
            thinking ? (
              <View style={[styles.bubble, styles.theirs, styles.typing]}>
                <ActivityIndicator size="small" color={stateColor(state)} />
              </View>
            ) : null
          }
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Say what's on your mind…"
            placeholderTextColor={Ocean.textMuted}
            multiline
            onSubmitEditing={send}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || thinking) && styles.sendDisabled]}
            onPress={send}
            disabled={!input.trim() || thinking}
          >
            <Ionicons name="arrow-up" size={20} color={Ocean.bg} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: Ocean.bg },
  center: { flex: 1, backgroundColor: Ocean.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { color: Ocean.textPrimary, fontSize: 24, fontWeight: '700' },
  subtitle: { color: Ocean.textSecondary, fontSize: 13.5, marginTop: 2 },
  voiceToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  contextText: { color: Ocean.textMuted, fontSize: 12.5, marginLeft: 10, flex: 1 },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: Ocean.accentDim,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  nudgeText: { flex: 1, color: Ocean.textSecondary, fontSize: 13.5, marginHorizontal: 10 },

  list: { paddingHorizontal: 18, paddingBottom: 14 },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: Ocean.card,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderBottomLeftRadius: radius.sm,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: Ocean.accent,
    borderBottomRightRadius: radius.sm,
  },
  bubbleText: { color: Ocean.textPrimary, fontSize: 15.5, lineHeight: 22 },
  mineText: { color: Ocean.bg, fontWeight: '500' },
  typing: { paddingVertical: 16, paddingHorizontal: 22 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: Ocean.cardBorder,
    backgroundColor: Ocean.bg,
  },
  input: {
    flex: 1,
    backgroundColor: Ocean.surface,
    borderWidth: 1,
    borderColor: Ocean.cardBorder,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    color: Ocean.textPrimary,
    fontSize: 15.5,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Ocean.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 9,
  },
  sendDisabled: { opacity: 0.4 },
});
