// src/screens/RoomsScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  Alert, ScrollView, FlatList, KeyboardAvoidingView, Platform, BackHandler
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { api, wsClient } from '../utils/api';
import { useStore } from '../store';
import { encryptMessage, decryptMessage } from '../utils/crypto';

interface Room {
  id: string;
  name: string;
  room_code: string;
  admin_id: string;
  expires_at: string;
}

interface RoomMessage {
  id: string;
  sender_id: string;
  from_name: string;
  text: string;
  created_at: string;
}

interface Props { onBack: () => void; }

const MY_ROOMS_KEY = 'sage_my_rooms';

export default function RoomsScreen({ onBack }: Props) {
  const { user } = useStore();
  const [mode, setMode]         = useState<'menu' | 'create' | 'join' | 'room'>('menu');
  const [roomName, setRoomName] = useState('');
  const [duration, setDuration] = useState<1 | 6 | 12 | 24>(6);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading]   = useState(false);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [myRooms, setMyRooms]   = useState<Room[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const sageColor = getSageColor();

  useEffect(() => {
    loadMyRooms();
  }, []);

  // Handle Hardware Back Button
  useEffect(() => {
    const backAction = () => {
      if (mode !== 'menu') {
        setMode('menu');
        setActiveRoom(null);
        return true; // Prevent default behavior (closing app)
      }
      onBack(); // If on menu, use the navigator's back
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [mode, onBack]);


  // Listen for real-time room messages
  useEffect(() => {
    if (!activeRoom) return;

    const handleWsMessage = async (msg: any) => {
      if (msg.type === 'room_msg' && msg.room_id === activeRoom.id) {
        try {
          const decrypted = await decryptMessage(msg.data);
          const newMsg: RoomMessage = {
            id: msg.id,
            sender_id: msg.from,
            from_name: msg.from_name,
            text: decrypted,
            created_at: msg.created_at,
          };
          setMessages(prev => [...prev, newMsg]);
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        } catch (e) {
          console.log('Failed to decrypt incoming room msg', e);
        }
      }
    };

    wsClient.onMessage(handleWsMessage);
    loadRoomHistory(activeRoom.id);

    return () => {
      wsClient.offMessage(handleWsMessage);
    };
  }, [activeRoom]);

  const loadMyRooms = async () => {
    try {
      const raw = await AsyncStorage.getItem(MY_ROOMS_KEY);
      if (!raw) return;
      const rooms: Room[] = JSON.parse(raw);
      const active = rooms.filter(r => new Date(r.expires_at).getTime() > Date.now());
      setMyRooms(active);
      await AsyncStorage.setItem(MY_ROOMS_KEY, JSON.stringify(active));
    } catch {}
  };

  const saveRoom = async (room: Room) => {
    try {
      const raw = await AsyncStorage.getItem(MY_ROOMS_KEY);
      const rooms: Room[] = raw ? JSON.parse(raw) : [];
      const filtered = rooms.filter(r => r.id !== room.id);
      const updated = [room, ...filtered];
      await AsyncStorage.setItem(MY_ROOMS_KEY, JSON.stringify(updated));
      setMyRooms(updated.filter(r => new Date(r.expires_at).getTime() > Date.now()));
    } catch {}
  };

  const loadRoomHistory = async (roomId: string) => {
    try {
      const res = await api.getRoomMessages(roomId);
      const loaded: RoomMessage[] = [];
      for (const m of res.messages) {
        try {
          const text = await decryptMessage(m.encrypted_data);
          loaded.push({
            id: m.id,
            sender_id: m.sender_id,
            from_name: m.users?.username || 'unknown',
            text,
            created_at: m.created_at,
          });
        } catch {}
      }
      setMessages(loaded);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (e: any) {
      Alert.alert('Error', 'Could not load room history');
    }
  };

  const handleCreate = async () => {
    if (!roomName.trim()) return Alert.alert('Error', 'Enter a room name');
    setLoading(true);
    try {
      const res = await api.createRoom(roomName.trim(), duration);
      await saveRoom(res.room);
      setActiveRoom(res.room);
      setMessages([]);
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
      await saveRoom(res.room);
      setActiveRoom(res.room);
      setMessages([]);
      setMode('room');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setLoading(false); }
  };

  const handleSend = async () => {
    if (!inputText.trim() || !activeRoom) return;
    const text = inputText.trim();
    setInputText('');
    
    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const myMsg: RoomMessage = {
      id: tempId,
      sender_id: user?.id || '',
      from_name: user?.username || 'me',
      text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, myMsg]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // In a real app, you need the public keys of all room members to encrypt properly.
      // For this prototype, we'll use a placeholder or encrypt it simply if the backend handles room distribution differently.
      // Assuming api.ts has a generic encrypt for rooms or you are sending raw for now (NOT SECURE for production)
      // We will encrypt using the sender's key just so it's not plaintext on the wire, but this needs a proper group key exchange for production.
      const encrypted = await encryptMessage(text, ""); // Requires proper pub key logic for groups
      
      wsClient.send({
        type: 'room_msg',
        room_id: activeRoom.id,
        data: encrypted, // Send encrypted data
      });
    } catch (e) {
      console.log('Failed to send room msg', e);
    }
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

  const renderMessage = ({ item }: { item: RoomMessage }) => {
    const isMe = item.sender_id === user?.id;
    return (
      <View style={[s.msgContainer, isMe ? s.msgContainerMe : s.msgContainerThem]}>
        {!isMe && <Text style={s.msgSenderName}>{item.from_name}</Text>}
        <View style={[s.msgBubble, isMe ? [s.msgBubbleMe, { borderColor: sageColor }] : s.msgBubbleThem]}>
          <Text style={[s.msgText, isMe ? { color: sageColor } : null]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  if (mode === 'menu') return (
    <ScrollView style={s.root} contentContainerStyle={{ flexGrow: 1 }}>
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

      {myRooms.length > 0 && (
        <View style={s.myRoomsSection}>
          <Text style={s.myRoomsLabel}>MY ROOMS</Text>
          {myRooms.map(room => (
            <TouchableOpacity
              key={room.id}
              style={s.roomItem}
              onPress={() => { setActiveRoom(room); setMode('room'); }}
            >
              <View style={s.roomItemLeft}>
                <Text style={s.roomItemName}>{room.name}</Text>
                <Text style={s.roomItemCode}>{room.room_code}</Text>
              </View>
              <Text style={s.roomItemExpiry}>{formatExpiry(room.expires_at)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );

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

  if (mode === 'room' && activeRoom) return (
    <KeyboardAvoidingView 
      style={s.root} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={() => setMode('menu')}><Text style={s.back}>{'< back'}</Text></TouchableOpacity>
        <View style={s.roomHeaderCenter}>
          <Text style
