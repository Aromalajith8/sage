// App.tsx — Sage root navigator
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StatusBar, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Colors } from './src/utils/theme';
import { useStore, Contact } from './src/store';
import { api, wsClient, getToken, setToken } from './src/utils/api';
import { generateOrLoadKeyPair } from './src/utils/crypto';
import LoginScreen    from './src/screens/LoginScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import ChatScreen     from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import RoomsScreen    from './src/screens/RoomsScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

type Screen = 'login' | 'contacts' | 'chat' | 'settings' | 'rooms';

export default function App() {
  const { user, setUser, token, setToken: storeSetToken } = useStore();
  const [screen, setScreen]         = useState<Screen>('login');
  const [activeContact, setContact] = useState<Contact | null>(null);
  const [initializing, setInit]     = useState(true);

  useEffect(() => { initialize(); }, []);

  // FIX #2: Android hardware back button + swipe-back gesture
  useEffect(() => {
    const onBack = () => {
      if (screen === 'chat' || screen === 'settings' || screen === 'rooms') {
        setScreen('contacts');
        return true; // handled — don't exit app
      }
      if (screen === 'contacts') {
        // Let Android close the app naturally
        return false;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [screen]);

  const initialize = async () => {
    await generateOrLoadKeyPair();
    const storedToken = await getToken();
    if (storedToken) {
      try {
        storeSetToken(storedToken);
        const me = await api.getMe();
        setUser(me);
        const { publicKeyPem } = await generateOrLoadKeyPair();
        await api.updatePubkey(publicKeyPem);
        wsClient.connect(me.id, storedToken);

        // Register push notifications
        const { status } = await Notifications.requestPermissionsAsync();
        if (status === 'granted') {
          const t = await Notifications.getExpoPushTokenAsync();
          wsClient.send({ type: 'push_token', token: t.data });
        }

        setScreen('contacts');
      } catch {
        await AsyncStorage.removeItem('sage_token');
      }
    }
    setInit(false);
  };

  const handleLogin = async () => {
    const storedToken = await getToken();
    if (!storedToken) return;
    storeSetToken(storedToken);
    try {
      const me = await api.getMe();
      setUser(me);
      wsClient.connect(me.id, storedToken);

      // Register push notifications after login too
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        const t = await Notifications.getExpoPushTokenAsync();
        wsClient.send({ type: 'push_token', token: t.data });
      }
    } catch {}
    setScreen('contacts');
  };

  const handleSelectContact = (contact: Contact) => {
    setContact(contact);
    setScreen('chat');
  };

  const handleLogout = () => {
    wsClient.disconnect();
    setUser(null);
    storeSetToken(null);
    setScreen('login');
  };

  if (initializing) {
    return <View style={s.root} />;
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      {screen === 'login' && <LoginScreen onLogin={handleLogin} />}
      {screen === 'contacts' && (
        <ContactsScreen
          onSelectContact={handleSelectContact}
          onOpenSettings={() => setScreen('settings')}
          onOpenRooms={() => setScreen('rooms')}
        />
      )}
      {screen === 'chat' && activeContact && (
        <ChatScreen contact={activeContact} onBack={() => setScreen('contacts')} />
      )}
      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen('contacts')} onLogout={handleLogout} />
      )}
      {screen === 'rooms' && (
        <RoomsScreen onBack={() => setScreen('contacts')} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
});
