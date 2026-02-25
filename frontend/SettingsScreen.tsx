// src/screens/SettingsScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ScrollView, Alert, Modal,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { useStore } from '../store';
import { api, clearToken } from '../utils/api';
import { getKeyFingerprint, getPublicKeyPem } from '../utils/crypto';

interface Props { onBack: () => void; onLogout: () => void; }

export default function SettingsScreen({ onBack, onLogout }: Props) {
  const { user, setUser, typingEnabled, setTypingEnabled } = useStore();
  const [showQR, setShowQR]               = useState(false);
  const [fingerprint, setFingerprint]     = useState('');
  const [newUsername, setNewUsername]     = useState('');
  const [changingName, setChangingName]   = useState(false);
  const [loading, setLoading]             = useState(false);
  const sageColor = getSageColor();

  const canChangeUsername = !user?.username_changed_at;

  const handleShowQR = async () => {
    const pem = await getPublicKeyPem();
    if (pem) setFingerprint(getKeyFingerprint(pem));
    setShowQR(true);
  };

  const handleChangeUsername = async () => {
    if (!canChangeUsername) {
      return Alert.alert('Sage', 'Username can only be changed once.');
    }
    const clean = newUsername.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
      return Alert.alert('Invalid', '3–20 chars: lowercase, numbers, underscores only');
    }
    Alert.alert(
      'Warning',
      `You can only change your username ONCE.\n\nChange to "${clean}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: async () => {
          setLoading(true);
          try {
            const res = await api.changeUsername(clean);
            setUser(res.user);
            setChangingName(false);
            Alert.alert('Done', `Username changed to "${clean}". This cannot be undone.`);
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally { setLoading(false); }
        }}
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'You will need to verify your email again to log back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => {
        await clearToken();
        onLogout();
      }}
    ]);
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={s.back}>{'< back'}</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: sageColor }]}>SETTINGS</Text>
      </View>

      <ScrollView style={s.scroll}>
        {/* Identity */}
        <Section label="IDENTITY">
          <Row label="username"  value={user?.username || ''} />
          <Row label="sage id"   value={user?.hash_id || ''} mono small />
          <Row label="timezone"  value={user?.timezone || 'UTC'} />
        </Section>

        {/* QR Code */}
        <Section label="SHARE">
          <TouchableOpacity style={s.actionBtn} onPress={handleShowQR}>
            <Text style={s.actionText}>[show my qr code]</Text>
          </TouchableOpacity>
          <Text style={s.hint}>others can scan this to add you instantly</Text>
        </Section>

        {/* Change username */}
        {canChangeUsername ? (
          <Section label="CHANGE USERNAME (once only)">
            {changingName ? (
              <>
                <TextInput
                  style={s.input}
                  value={newUsername}
                  onChangeText={setNewUsername}
                  placeholder="new_username"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
                <TouchableOpacity style={s.actionBtn} onPress={handleChangeUsername} disabled={loading}>
                  <Text style={[s.actionText, { color: sageColor }]}>[confirm change]</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setChangingName(false)}>
                  <Text style={s.cancelText}>[cancel]</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={s.actionBtn} onPress={() => setChangingName(true)}>
                <Text style={s.actionText}>[change username]</Text>
              </TouchableOpacity>
            )}
          </Section>
        ) : (
          <Section label="USERNAME">
            <Text style={s.hint}>username has been changed once and is now locked.</Text>
          </Section>
        )}

        {/* Preferences */}
        <Section label="PREFERENCES">
          <TouchableOpacity
            style={s.toggleRow}
            onPress={() => setTypingEnabled(!typingEnabled)}
          >
            <Text style={s.toggleLabel}>typing indicator</Text>
            <Text style={[s.toggleVal, typingEnabled && { color: sageColor }]}>
              {typingEnabled ? '[on]' : '[off]'}
            </Text>
          </TouchableOpacity>
          <Text style={s.hint}>let others see when you're typing</Text>
        </Section>

        {/* Midnight reset info */}
        <Section label="DATA POLICY">
          <Text style={s.policyText}>
            {'> all messages are deleted at midnight in your local timezone.\n> no message history is stored after reset.\n> the server cannot decrypt your messages.\n> your private key never leaves this device.'}
          </Text>
        </Section>

        {/* Logout */}
        <Section label="">
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
            <Text style={s.logoutText}>[logout]</Text>
          </TouchableOpacity>
        </Section>
      </ScrollView>

      {/* QR Modal */}
      <Modal visible={showQR} transparent animationType="fade">
        <TouchableOpacity style={s.qrOverlay} onPress={() => setShowQR(false)} activeOpacity={1}>
          <View style={s.qrBox}>
            <Text style={[s.qrTitle, { color: sageColor }]}>YOUR SAGE ID</Text>
            <View style={s.qrWrap}>
              <QRCode
                value={user?.hash_id || ''}
                size={200}
                backgroundColor="#000"
                color="#fff"
              />
            </View>
            <Text style={s.qrHashId}>{user?.hash_id}</Text>
            <Text style={s.qrUsername}>{user?.username}</Text>
            {fingerprint ? (
              <Text style={s.qrFingerprint}>key: {fingerprint}</Text>
            ) : null}
            <Text style={s.qrDismiss}>tap anywhere to close</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={ss.section}>
      {label ? <Text style={ss.sectionLabel}>{label}</Text> : null}
      {children}
    </View>
  );
}

function Row({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <View style={ss.row}>
      <Text style={ss.rowLabel}>{label}</Text>
      <Text style={[ss.rowValue, mono && ss.mono, small && ss.small]}>{value}</Text>
    </View>
  );
}

const ss = StyleSheet.create({
  section:      { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
                  borderBottomWidth: 1, borderBottomColor: Colors.borderDim },
  sectionLabel: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs,
                  letterSpacing: 2, marginBottom: Spacing.sm },
  row:          { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel:     { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  rowValue:     { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm },
  mono:         { fontFamily: Font.mono },
  small:        { fontSize: Font.size.xs, color: Colors.textMuted },
});

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
             paddingHorizontal: Spacing.md, paddingTop: Spacing.xl, paddingBottom: Spacing.sm,
             borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:    { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  title:   { fontFamily: Font.mono, fontSize: Font.size.lg, fontWeight: 'bold', letterSpacing: 4 },
  scroll:  { flex: 1 },
  input:   { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm,
             borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm,
             backgroundColor: Colors.inputBg, marginBottom: Spacing.sm },
  actionBtn:   { paddingVertical: Spacing.sm },
  actionText:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  cancelText:  { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: Spacing.xs },
  hint:        { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: 2 },
  toggleRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  toggleLabel: { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm },
  toggleVal:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.sm },
  policyText:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, lineHeight: 20 },
  logoutBtn:   { paddingVertical: Spacing.md },
  logoutText:  { fontFamily: Font.mono, color: '#ff4444', fontSize: Font.size.sm },

  qrOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  qrBox:       { backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
                 padding: Spacing.xl, alignItems: 'center', minWidth: 280 },
  qrTitle:     { fontFamily: Font.mono, fontSize: Font.size.lg, fontWeight: 'bold',
                 letterSpacing: 4, marginBottom: Spacing.lg },
  qrWrap:      { padding: Spacing.md, backgroundColor: '#000', borderWidth: 1, borderColor: Colors.border },
  qrHashId:    { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.xs,
                 marginTop: Spacing.md, letterSpacing: 2 },
  qrUsername:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm, marginTop: 4 },
  qrFingerprint:{ fontFamily: Font.mono, color: Colors.textMuted, fontSize: 9,
                  marginTop: Spacing.sm, textAlign: 'center' },
  qrDismiss:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: Spacing.lg },
});
