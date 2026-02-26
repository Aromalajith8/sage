// src/screens/ChatScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Modal, Alert,
} from 'react-native';
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { useStore, Message, Contact } from '../store';
import { wsClient, api } from '../utils/api';
import { encryptMessage, decryptMessage, getPrivateKeyPem } from '../utils/crypto';

interface Props {
  contact: Contact;
  onBack: () => void;
}

const REACTIONS = ['+1', '!', '?'] as const;
const FIRST_MSG_KEY = 'sage_first_msg_shown';

export default function ChatScreen({ contact, onBack }: Props) {
  const { user, messages, addMessage, updateMessageStatus, updateMessageReaction,
          setActiveConversation, peerKeys, setPeerKey,
          typingEnabled, typingUsers } = useStore();
  const [text, setText]             = useState('');
  const [loading, setLoading]       = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<Message | null>(null);
  const [privKey, setPrivKey]       = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const sageColor = getSageColor();
  const conversationMsgs = messages[contact.id] || [];
  const isTyping = typingUsers[contact.id] || false;
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActiveConversation(contact.id);
    initialize();
    return () => setActiveConversation(null);
  }, [contact.id]);

  const initialize = async () => {
    const pk = await getPrivateKeyPem();
    setPrivKey(pk);

    if (!peerKeys[contact.id]) {
      try {
        const res = await api.getPubkey(contact.id);
        setPeerKey(contact.id, res.pubkey_pem);
      } catch {}
    }

    try {
      const res = await api.getMessages(contact.id);
      const decrypted = await decryptAll(res.messages || [], pk!, user!.id);
      useStore.getState().setMessages(contact.id, decrypted);
    } catch {}

    const key = `${FIRST_MSG_KEY}_${contact.id}`;
    const shown = await import('@react-native-async-storage/async-storage')
                    .then(m => m.default.getItem(key));
    if (!shown) {
      setShowBanner(true);
      import('@react-native-async-storage/async-storage')
        .then(m => m.default.setItem(key, '1'));
    }

    setLoading(false);
  };

  // FIX #8: own messages encrypted with recipient pubkey — we can't re-decrypt them.
  // Keep the decrypted_text we stored during optimistic send.
  const decryptAll = async (msgs: Message[], pk: string, myId: string): Promise<Message[]> => {
    if (!pk) return msgs;
    return Promise.all(msgs.map(async m => {
      if (m.sender_id === myId) {
        return { ...m, decrypted_text: m.decrypted_text || '[your message]' };
      }
      try {
        const t = decryptMessage(m.encrypted_data, pk);
        return { ...m, decrypted_text: t };
      } catch {
        return { ...m, decrypted_text: '[could not decrypt]' };
      }
    }));
  };

  useEffect(() => {
    const unsub = wsClient.onMessage(async (msg) => {
      if (msg.type === 'dm' && msg.from === contact.id) {
        wsClient.send({ type: 'read', id: msg.id });

        let decryptedText = '[encrypted]';
        if (privKey) {
          try { decryptedText = decryptMessage(msg.data, privKey); } catch {}
        }

        const newMsg: Message = {
          id:             msg.id,
          sender_id:      contact.id,
          receiver_id:    user!.id,
          encrypted_data: msg.data,
          decrypted_text: decryptedText,
          status:         'read',
          burn_mode:      false,
          created_at:     msg.created_at,
          expires_at:     '',
          deleted:        false,
        };
        addMessage(contact.id, newMsg);
        scrollToBottom();
      }

      if (msg.type === 'status') {
        updateMessageStatus(contact.id, msg.id, msg.status);
      }

      if (msg.type === 'reaction' && (msg.from === contact.id || msg.from === user?.id)) {
        updateMessageReaction(contact.id, msg.id, msg.reaction);
      }

      if (msg.type === 'typing' && msg.from === contact.id) {
        useStore.getState().setTyping(contact.id, msg.is_typing);
        if (msg.is_typing) {
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() =>
            useStore.getState().setTyping(contact.id, false), 3000);
        }
      }
    });
    return unsub;
  }, [contact.id, privKey]);

  const sendMessage = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const pubkey = peerKeys[contact.id];
    if (!pubkey) {
      Alert.alert('Error', "Cannot find recipient's public key.");
      return;
    }

    try {
      const encrypted = encryptMessage(trimmed, pubkey);

      wsClient.send({ type: 'dm', to: contact.id, data: encrypted });

      // Optimistic add — store plain text so WE can see our own message
      const optimistic: Message = {
        id:              `tmp_${Date.now()}`,
        sender_id:       user!.id,
        receiver_id:     contact.id,
        encrypted_data:  encrypted,
        decrypted_text:  trimmed,
        status:          'sent',
        burn_mode:       false,
        created_at:      new Date().toISOString(),
        expires_at:      '',
        deleted:         false,
      };
      addMessage(contact.id, optimistic);
      setText('');
      scrollToBottom();
    } catch (e: any) {
      Alert.alert('Encryption error', e.message);
    }
  };

  const sendTyping = (isTyping: boolean) => {
    if (!typingEnabled) return;
    wsClient.send({ type: 'typing', to: contact.id, is_typing: isTyping });
  };

  const sendReaction = (msg: Message, reaction: string) => {
    wsClient.send({ type: 'reaction', id: msg.id, reaction });
    setReactionTarget(null);
  };

  const scrollToBottom = () => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const statusLabel = (s: string) => {
    if (s === 'sent')      return '[SENT]';
    if (s === 'delivered') return '[DELIVERED]';
    if (s === 'read')      return '[READ]';
    return '';
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === user?.id;
    return (
      <TouchableOpacity
        onLongPress={() => setReactionTarget(item)}
        delayLongPress={400}
        activeOpacity={0.85}
      >
        <View style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
          <View style={[s.msgBubble, isMe ? s.bubbleMe : s.bubbleThem]}>
            <Text style={s.msgText}>{item.decrypted_text || '[encrypted]'}</Text>
            {item.reaction && (
              <Text style={s.reactionBadge}>[{item.reaction}]</Text>
            )}
            <View style={s.msgMeta}>
              <Text style={s.msgTime}>{formatTime(item.created_at)}</Text>
              {isMe && <Text style={s.msgStatus}> {statusLabel(item.status)}</Text>}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    // FIX #1: behavior='padding' on both platforms keeps input above keyboard
    <KeyboardAvoidingView
      style={s.root}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backIcon}>{'<'}</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerName}>{contact.username}</Text>
          <Text style={s.headerHash}>{contact.hash_id}</Text>
        </View>
      </View>

      {/* Midnight banner */}
      {showBanner && (
        <TouchableOpacity style={s.banner} onPress={() => setShowBanner(false)}>
          <Text style={s.bannerText}>
            {'> messages in sage disappear at midnight. no history. no trace. tap to dismiss.'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={conversationMsgs}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        contentContainerStyle={s.messageList}
        onContentSizeChange={scrollToBottom}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? null : (
            <Text style={s.emptyChat}>{'> start of conversation'}</Text>
          )
        }
      />

      {/* Typing indicator */}
      {isTyping && (
        <Text style={s.typingIndicator}>{contact.username} {'> _'}</Text>
      )}

      {/* Input */}
      <View style={s.inputRow}>
        <Text style={s.prompt}>{'>'}</Text>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={(t) => { setText(t); sendTyping(t.length > 0); }}
          onBlur={() => sendTyping(false)}
          placeholder="type a message..."
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity style={s.sendBtn} onPress={sendMessage} disabled={!text.trim()}>
          <Text style={[s.sendText, { color: text.trim() ? sageColor : Colors.textMuted }]}>{'[↵]'}</Text>
        </TouchableOpacity>
      </View>

      {/* Reaction modal */}
      <Modal visible={!!reactionTarget} transparent animationType="fade">
        <TouchableOpacity style={s.reactionOverlay} onPress={() => setReactionTarget(null)} activeOpacity={1}>
          <View style={s.reactionBox}>
            <Text style={s.reactionTitle}>react</Text>
            <View style={s.reactionRow}>
              {REACTIONS.map(r => (
                <TouchableOpacity key={r} style={s.reactionBtn}
                  onPress={() => reactionTarget && sendReaction(reactionTarget, r)}>
                  <Text style={s.reactionText}>[{r}]</Text>
                </TouchableOpacity>
              ))}
              {reactionTarget?.reaction && (
                <TouchableOpacity style={s.reactionBtn}
                  onPress={() => reactionTarget && sendReaction(reactionTarget, '')}>
                  <Text style={s.reactionRemove}>[×]</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md,
            paddingTop: Spacing.xl, paddingBottom: Spacing.sm,
            borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { paddingRight: Spacing.md },
  backIcon:{ fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.lg },
  headerCenter: { flex: 1 },
  headerName:   { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.base },
  headerHash:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs },

  banner:     { backgroundColor: Colors.surface, padding: Spacing.md,
                borderBottomWidth: 1, borderBottomColor: Colors.border },
  bannerText: { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, lineHeight: 18 },

  messageList: { padding: Spacing.md, paddingBottom: Spacing.lg },
  emptyChat:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs,
                 textAlign: 'center', marginTop: Spacing.xl },

  msgRow:    { marginBottom: Spacing.sm },
  msgRowMe:  { alignItems: 'flex-end' },
  msgRowThem:{ alignItems: 'flex-start' },
  msgBubble: { maxWidth: '82%', padding: Spacing.sm, borderWidth: 1 },
  bubbleMe:  { backgroundColor: Colors.surface, borderColor: Colors.border },
  bubbleThem:{ backgroundColor: Colors.bg, borderColor: Colors.borderDim },
  msgText:   { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm, lineHeight: 20 },
  reactionBadge:{ fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, marginTop: 4 },
  msgMeta:   { flexDirection: 'row', marginTop: 4 },
  msgTime:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs },
  msgStatus: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs },

  typingIndicator:{ fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs,
                    paddingHorizontal: Spacing.md, paddingBottom: Spacing.xs },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.sm,
              borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  prompt:   { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.base,
              paddingBottom: 10, paddingRight: Spacing.xs },
  input:    { flex: 1, fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm,
              maxHeight: 120, paddingVertical: Spacing.sm, backgroundColor: Colors.inputBg,
              paddingHorizontal: Spacing.sm, borderWidth: 1, borderColor: Colors.borderDim },
  sendBtn:  { paddingLeft: Spacing.sm, paddingBottom: Spacing.sm },
  sendText: { fontFamily: Font.mono, fontSize: Font.size.lg },

  reactionOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  reactionBox:    { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                    padding: Spacing.lg, minWidth: 220 },
  reactionTitle:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, marginBottom: Spacing.md },
  reactionRow:    { flexDirection: 'row', gap: Spacing.md },
  reactionBtn:    { padding: Spacing.sm },
  reactionText:   { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.lg },
  reactionRemove: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.lg },
});
