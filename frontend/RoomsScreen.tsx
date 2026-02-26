// src/screens/RoomsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  Alert, ScrollView, KeyboardAvoidingView, Platform, FlatList
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

interface RoomMessage {
  id: string;
  text: string;
  sender_id: string;
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
  
  // Chat States
  const [chatInput, setChatInput] = useState('');
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  
  const sageColor = getSageColor();

  useEffect(() => {
    loadMyRooms();
  }, []);

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

  const handleCreate = async () => {
    if (!roomName.trim()) return Alert.alert('Error', 'Enter a room name');
    setLoading(true);
    try {
      const res = await api.createRoom(roomName.trim(), duration);
      await saveRoom(res.room);
      setActiveRoom(res.room);
      setRoomMessages([]); // Clear chat on new room
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
      setRoomMessages([]); // Clear chat on new join
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

  const handleSendRoomMessage = () => {
    if (!chatInput.trim()) return;
    
    // Add locally for now to make the UI responsive
    const newMsg = {
      id: Date.now().toString(),
      text: chatInput.trim(),
      sender_id: user?.id || 'unknown'
    };
    
    setRoomMessages(prev => [...prev, newMsg]);
    setChatInput('');
    
    // Note: If you want these messages to sync to other users, 
    // you will need to add a websocket emit here in the future!
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
    <ScrollView style={s.root} contentContainerStyle={{ flexGrow: 1 }}>
      <View style
