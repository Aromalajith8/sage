// src/screens/RoomsScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  Modal, Alert, ScrollView,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { api } from '../utils/api';
import { useStore } from '../store';

interface Room {
  id: string;
  name: string;
  room_code: string;
  admin_id: string;
  expires_at: string;
}

interface Props { onBack: () => void; }

export default function RoomsScreen({ onBack }: Props) {
  const { user } = useStore();
  const [mode, setMode]         = useState<'menu' | 'create' | 'join' | 'room'>('menu');
  const [roomName, setRoomName] = useState('');
  const [duration, setDuration] = useState<1 | 6 | 12 | 24>(6);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading]   = useState(false);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const sageColor = getSageColor();

  const handleCreate = async () => {
    if (!roomName.trim()) return Alert.alert('Error', 'Enter a room name');
    setLoading(true);
    try {
      const res = await api.createRoom(roomName.trim(), duration);
      setActiveRoom(res.room);
      setMode('room');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setLoading(false); }
  };

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code.startsWith('SAGE-') || code.length < 9) {
      return Alert.alert('Invalid code', 'Room codes look like SAGE-AB12');
    }
    setLoading(true);
    try {
      const res = await api.joinRoom(code);
      setActiveRoom(res.room);
      setMode('room');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setLoading(false); }
  };

  const handleExport = async () => {
    if (!activeRoom) return;
    if (activeRoom.admin_id !== user?.id) {
      return Alert.alert('Permission denied', 'Only the room admin can export.');
    }
    try {
      const content = await api.exportRoom(activeRoom.id);
      const path = FileSystem.documentDirectory + `sage-room-${activeRoom.room_code}.txt`;
      await FileSystem.writeAsStringAsync(path, content);
      await Sharing.shareAsync(path, { mimeType: 'text/plain' });
    } catch (e: any) {
      Alert.alert('Export error', e.message);
    }
  };

  const formatExpiry = (iso: string) => {
    const d = new Date(iso);
    const diff = d.getTime() - Date.now();
    if (diff <= 0) return 'expired';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m remaining`;
  };

  // ── Main menu ────────────────────────────────────────────────
  if (mode === 'menu') return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}><Text style={s.back}>{'< back'}</Text></TouchableOpacity>
        <Text style={[s.title, { color: sageColor }]}>ROOMS</Text>
      </View>
      <View style={s.menu}>
        <Text style={s.menuHint}>{'> self-destructing group chats'}</Text>
        <TouchableOpacity style={s.menuBtn} onPress={() => setMode('create')}>
          <Text style={s.menuBtnText}>[create room]</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.menuBtn} onPress={() => setMode('join')}>
          <Text style={s.menuBtnText}>[join with code]</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Create room ──────────────────────────────────────────────
  if (mode === 'create') return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setMode('menu')}><Text style={s.back}>{'< back'}</Text></TouchableOpacity>
        <Text style={[s.title, { color: sageColor }]}>CREATE ROOM</Text>
      </View>
      <View style={s.form}>
        <Text style={s.label}>room name</Text>
        <TextInput
          style={s.input}
          value={roomName}
          onChangeText={setRoomName}
          placeholder="e.g. project-x"
          placeholderTextColor={Colors.textMuted}
          autoFocus
          autoCapitalize="none"
        />
        <Text style={s.label}>self-destruct after</Text>
        <View style={s.durationRow}>
          {([1, 6, 12, 24] as const).map(d => (
            <TouchableOpacity
              key={d}
              style={[s.durationBtn, duration === d && { borderColor: sageColor }]}
              onPress={() => setDuration(d)}
            >
              <Text style={[s.durationText, duration === d && { color: sageColor }]}>{d}h</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[s.submitBtn, { borderColor: sageColor }]} onPress={handleCreate} disabled={loading}>
          <Text style={[s.submitText, { color: sageColor }]}>{loading ? 'creating...' : '[create]'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Join room ────────────────────────────────────────────────
  if (mode === 'join') return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setMode('menu')}><Text style={s.back}>{'< back'}</Text></TouchableOpacity>
        <Text style={[s.title, { color: sageColor }]}>JOIN ROOM</Text>
      </View>
      <View style={s.form}>
        <Text style={s.label}>enter room code</Text>
        <TextInput
          style={[s.input, { letterSpacing: 4 }]}
          value={joinCode}
          onChangeText={setJoinCode}
          placeholder="SAGE-XXXX"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="characters"
          autoFocus
        />
        <TouchableOpacity style={[s.submitBtn, { borderColor: sageColor }]} onPress={handleJoin} disabled={loading}>
          <Text style={[s.submitText, { color: sageColor }]}>{loading ? 'joining...' : '[join]'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Active room ──────────────────────────────────────────────
  if (mode === 'room' && activeRoom) return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setMode('menu')}><Text style={s.back}>{'< back'}</Text></TouchableOpacity>
        <View style={s.roomHeaderCenter}>
          <Text style={[s.title, { color: sageColor }]}>{activeRoom.name}</Text>
          <Text style={s.roomCode}>{activeRoom.room_code} · {formatExpiry(activeRoom.expires_at)}</Text>
        </View>
        {activeRoom.admin_id === user?.id && (
          <TouchableOpacity onPress={handleExport}>
            <Text style={s.exportBtn}>[export]</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={s.roomInfo}>
        <Text style={s.roomInfoText}>
          {'> share code: '}<Text style={{ color: sageColor }}>{activeRoom.room_code}</Text>
        </Text>
        <Text style={s.roomInfoText}>{'> room chat coming in next update'}</Text>
        <Text style={s.roomInfoText}>{'> room will be destroyed when timer expires'}</Text>
        {activeRoom.admin_id === user?.id && (
          <Text style={s.roomInfoText}>{'> you are the admin — only you can export'}</Text>
        )}
      </View>
    </View>
  );

  return null;
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
             paddingHorizontal: Spacing.md, paddingTop: Spacing.xl, paddingBottom: Spacing.sm,
             borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:    { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  title:   { fontFamily: Font.mono, fontSize: Font.size.lg, fontWeight: 'bold', letterSpacing: 4 },

  menu:       { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl },
  menuHint:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginBottom: Spacing.xl },
  menuBtn:    { borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md },
  menuBtnText:{ fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.base },

  form:    { padding: Spacing.lg },
  label:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs,
             letterSpacing: 2, marginBottom: Spacing.sm },
  input:   { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.base,
             borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm,
             backgroundColor: Colors.inputBg, marginBottom: Spacing.lg },
  durationRow:{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },
  durationBtn:{ flex: 1, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm, alignItems: 'center' },
  durationText:{ fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm },
  submitBtn:  { borderWidth: 1, padding: Spacing.md, alignItems: 'center' },
  submitText: { fontFamily: Font.mono, fontSize: Font.size.sm, fontWeight: 'bold', letterSpacing: 4 },

  roomHeaderCenter:{ flex: 1, paddingHorizontal: Spacing.sm },
  roomCode:  { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs },
  exportBtn: { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs },
  roomInfo:  { padding: Spacing.lg },
  roomInfoText:{ fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm,
                 lineHeight: 24, marginBottom: Spacing.xs },
});
