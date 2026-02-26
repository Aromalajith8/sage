// App.tsx — Sage root navigator (React Navigation)
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Colors } from './src/utils/theme';
import { useStore, Contact } from './src/store';
import { api, wsClient, getToken } from './src/utils/api';
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

export type RootStackParamList = {
  Login:    undefined;
  Contacts: undefined;
  Chat:     { contact: Contact };
  Settings: undefined;
  Rooms:    undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  const { setUser, setToken: storeSetToken } = useStore();
  const [initialScreen, setInitialScreen]   = useState<keyof RootStackParamList>('Login');
  const [initializing, setInit]             = useState(true);

  useEffect(() => { initialize(); }, []);

  const registerPush = async () => {
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus === 'granted') {
        const t = await Notifications.getExpoPushTokenAsync();
        wsClient.send({ type: 'push_token', token: t.data });
      }
    } catch {}
  };

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
        await registerPush();
        setInitialScreen('Contacts');
      } catch {
        await AsyncStorage.removeItem('sage_token');
      }
    }
    setInit(false);
  };

  if (initializing) {
    return <View style={s.root} />;
  }

  return (
    <GestureHandlerRootView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={initialScreen}
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            ...TransitionPresets.SlideFromRightIOS,
            cardStyle: { backgroundColor: Colors.bg },
          }}
        >
          <Stack.Screen name="Login">
            {(props) => (
              <LoginScreen
                onLogin={async () => {
                  const storedToken = await getToken();
                  if (!storedToken) return;
                  storeSetToken(storedToken);
                  try {
                    const me = await api.getMe();
                    setUser(me);
                    wsClient.connect(me.id, storedToken);
                    await registerPush();
                  } catch {}
                  props.navigation.reset({ index: 0, routes: [{ name: 'Contacts' }] });
                }}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Contacts">
            {(props) => (
              <ContactsScreen
                onSelectContact={(contact) => props.navigation.navigate('Chat', { contact })}
                onOpenSettings={() => props.navigation.navigate('Settings')}
                onOpenRooms={() => props.navigation.navigate('Rooms')}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Chat">
            {(props) => (
              <ChatScreen
                contact={props.route.params.contact}
                onBack={() => props.navigation.goBack()}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Settings">
            {(props) => (
              <SettingsScreen
                onBack={() => props.navigation.goBack()}
                onLogout={() => {
                  wsClient.disconnect();
                  setUser(null);
                  storeSetToken(null);
                  props.navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
                }}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Rooms">
            {(props) => (
              <RoomsScreen onBack={() => props.navigation.goBack()} />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
});
