// src/screens/SettingsScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ScrollView, Alert, Modal, Platform
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera'; // NEW
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { useStore } from '../store';
import { api, clearToken } from '../utils/api';
import { getKeyFingerprint, getPublicKeyPem } from '../utils/crypto';

interface Props { 
  onBack: () => void; 
  onLogout: () => void;
  onSelectContact: (contact: any) => void; // NEW: To jump to chat
}

export default function SettingsScreen({ onBack, onLogout, onSelectContact }: Props) {
  const { user, setUser, typingEnabled, setTypingEnabled } = useStore();
  const [showQR, setShowQR]             = useState(false);
  const [permission, requestPermission] = useCameraPermissions(); // NEW
  const [showScanner, setShowScanner]   = useState(false); // NEW
  const [fingerprint, setFingerprint]   = useState('');
  const [newUsername, setNewUsername]   = useState('');
  const [changingName, setChangingName] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [editingBio, setEditingBio]     = useState(false);
  const [bioText, setBioText]           = useState(user?.bio || '');
  const [savingBio, setSavingBio]       = useState(false);
  const sageColor = getSageColor();

  const canChangeUsername = !user?.username_changed_at;

  const handleShowQR = async () => {
    const pem = await getPublicKeyPem();
    if (pem) setFingerprint(getKeyFingerprint(pem));
    setShowQR(true);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    setShowScanner(false);
    try {
      // Look up user by the scanned Hash ID
      const targetUser = await api.getUserByHash(data);
      onSelectContact(targetUser); // Instantly navigate to Chat
    } catch (e: any) {
      Alert.alert('Not Found', 'This ID does not belong to a Sage user.');
    }
  };

  const handleChangeUsername = async () => {
    if (!canChangeUsername) return Alert.alert('Sage', 'Username can only be changed once.');
    const clean = newUsername.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) return Alert.alert('Invalid', '3–20 chars: lowercase, numbers, underscores only');
    
    Alert.alert('Warning', `Change to "${clean}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: async () => {
        setLoading(true);
        try {
          const res = await api.changeUsername(clean);
          setUser(res.user);
          setChangingName(false);
          Alert.alert('Done', `Username changed to "${clean}".`);
        } catch (e: any) { Alert.alert('Error', e.message); }
        finally { setLoading(false); }
      }}
    ]);
  };

  const handleSaveBio = async () => {
    const trimmed = bioText.trim().slice(0, 160);
    setSavingBio(true);
    try {
      await api.updateBio(trimmed);
      setUser({ ...user!, bio: trimmed });
      setEditingBio(false);
    } catch (e: any) { Alert.alert('Error', e.message || 'Could not save bio'); }
    finally { setSavingBio(false); }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'You will need to verify email to log back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => {
        await clearToken();
        onLogout();
      }}
    ]);
  };

  // --- CAMERA OVERLAY ---
  if (showScanner) {
    if (!permission?.granted) {
      return (
        <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
          <Text style={[s.hint, { textAlign: 'center', marginBottom: 20 }]}>Camera permission is needed to scan Sage IDs.</Text>
          <TouchableOpacity style={s.input} onPress={requestPermission}><Text style={{ color: '#fff', textAlign: 'center' }}>[grant permission]</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setShowScanner(false)}><Text style={s.cancelText}>[cancel]</Text></TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={s.root}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
        <View style={s.scanOverlay}>
          <Text style={s.scanText}>POINT AT A SAGE QR CODE</Text>
          <TouchableOpacity style={s.closeScanner} onPress={() => setShowScanner(false)}>
            <Text style={{ color: '#fff', fontFamily: Font.mono }}>[cancel]</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}><Text style={s.back}>{'< back'}</Text></TouchableOpacity>
        <Text style={[s.title, { color: sageColor }]}>SETTINGS</Text>
      </View>

      <ScrollView style={s.scroll}>
        <Section label="IDENTITY">
          <Row label="username"  value={user?.username || ''} />
          <Row label="sage id"   value={user?.hash_id || ''} mono small />
        </Section>

        <Section label="BIO">
          {editingBio ? (
            <>
              <TextInput
                style={s.bioInput}
                value={bioText}
                onChangeText={t => setBioText(t.slice(0, 160))}
                multiline
                maxLength={160}
                autoFocus
              />
              <TouchableOpacity style={s.actionBtn} onPress={handleSaveBio} disabled={savingBio}>
                <Text style={[s.actionText, { color: sageColor }]}>{savingBio ? 'saving...' : '[save bio]'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingBio(false)}><Text style={s.cancelText}>[cancel]</Text></TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.bioDisplay}>{user?.bio || 'no bio yet'}</Text>
              <TouchableOpacity style={s.actionBtn} onPress={() => setEditingBio(true)}><Text style={s.actionText}>[edit bio]</Text></TouchableOpacity>
            </>
          )}
        </Section>

        <Section label="CONNECT">
          <TouchableOpacity style={s.actionBtn} onPress={() => setShowScanner(true)}>
            <Text style={[s.actionText, { color: sageColor }]}>[scan a friend's qr]</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handleShowQR}>
            <Text style={s.actionText}>[show my qr code]</Text>
          </TouchableOpacity>
        </Section>

        <Section label="DATA POLICY">
          <Text style={s.policyText}>{'> all messages deleted at midnight.\n> server cannot decrypt chats.'}</Text>
        </Section>

        <Section label="">
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}><Text style={s.logoutText}>[logout]</Text></TouchableOpacity>
        </Section>
      </ScrollView>

      {/* QR Modal */}
      <Modal visible={showQR} transparent animationType="fade">
        <TouchableOpacity style={s.qrOverlay} onPress={() => setShowQR(false)} activeOpacity={1}>
          <View style={s.qrBox}>
            <Text style={[s.qrTitle, { color: sageColor }]}>YOUR SAGE ID</Text>
            <View style={s.qrWrap}>
              <QRCode value={user?.hash_id || ''} size={200} backgroundColor="#000" color="#fff" />
            </View>
            <Text style={s.qrHashId}>{user?.hash_id}</Text>
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
  section:      { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderDim },
  sectionLabel: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, letterSpacing: 2, marginBottom: Spacing.sm },
  row:          { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel:     { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  rowValue:     { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm },
  mono:         { fontFamily: Font.mono },
  small:        { fontSize: Font.size.xs, color: Colors.textMuted },
});

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingTop: Spacing.xl, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:    { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  title:   { fontFamily: Font.mono, fontSize: Font.size.lg, fontWeight: 'bold', letterSpacing: 4 },
  scroll:  { flex: 1 },
  input:   { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, backgroundColor: Colors.inputBg },
  bioInput:  { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm, backgroundColor: Colors.inputBg, minHeight: 80, textAlignVertical: 'top' },
  bioDisplay:{ fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm, lineHeight: 20, marginBottom: Spacing.sm },
  actionBtn:   { paddingVertical: Spacing.sm },
  actionText:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  cancelText:  { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: Spacing.xs },
  policyText:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, lineHeight: 20 },
  logoutBtn:   { paddingVertical: Spacing.md },
  logoutText:  { fontFamily: Font.mono, color: '#ff4444', fontSize: Font.size.sm },
  qrOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  qrBox:        { backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, alignItems: 'center', minWidth: 280 },
  qrTitle:      { fontFamily: Font.mono, fontSize: Font.size.lg, fontWeight: 'bold', letterSpacing: 4, marginBottom: Spacing.lg },
  qrWrap:       { padding: Spacing.md, backgroundColor: '#000', borderWidth: 1, borderColor: Colors.border },
  qrHashId:     { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.xs, marginTop: Spacing.md, letterSpacing: 2 },
  qrDismiss:    { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: Spacing.lg },
  scanOverlay:  { flex: 1, justifyContent: 'space-between', paddingVertical: 100, alignItems: 'center', backgroundColor: 'transparent' },
  scanText:     { color: '#fff', backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, fontFamily: Font.mono },
  closeScanner: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 15, borderRadius: 5 },
  hint: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs }
});
