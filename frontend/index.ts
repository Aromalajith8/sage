// src/store/index.ts
import 'react-native-gesture-handler';
import { create } from 'zustand';

export interface User {
  id: string;
  username: string;
  hash_id: string;
  display_name: string;
  timezone: string;
  typing_indicator_enabled: boolean;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  encrypted_data: string;
  decrypted_text?: string;       // filled in by client after decryption
  status: 'sent' | 'delivered' | 'read';
  burn_mode: boolean;
  burn_duration_ms?: number;
  burned_at?: string;
  reaction?: string;
  created_at: string;
  expires_at: string;
  deleted: boolean;
  is_burning?: boolean;          // local UI state: countdown active
  burn_remaining_ms?: number;    // local countdown
}

export interface Contact {
  id: string;
  username: string;
  hash_id: string;
  display_name: string;
  last_seen: string;
}

interface SageStore {
  // Auth
  user: User | null;
  token: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;

  // Contacts
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
  addContact: (contact: Contact) => void;

  // Messages: keyed by conversation partner's user_id
  messages: Record<string, Message[]>;
  setMessages: (userId: string, msgs: Message[]) => void;
  addMessage: (userId: string, msg: Message) => void;
  updateMessageStatus: (userId: string, msgId: string, status: string) => void;
  updateMessageReaction: (userId: string, msgId: string, reaction: string | null) => void;
  deleteMessage: (userId: string, msgId: string) => void;

  // Active conversation
  activeConversation: string | null;  // user_id of the person we're chatting with
  setActiveConversation: (id: string | null) => void;

  // Settings
  burnModeEnabled: Record<string, boolean>;    // per conversation
  typingEnabled: boolean;
  setBurnMode: (userId: string, enabled: boolean) => void;
  setTypingEnabled: (enabled: boolean) => void;

  // Typing state
  typingUsers: Record<string, boolean>;        // user_id → is typing
  setTyping: (userId: string, isTyping: boolean) => void;

  // Peer public keys cache
  peerKeys: Record<string, string>;            // user_id → pubkey_pem
  setPeerKey: (userId: string, pem: string) => void;
}

export const useStore = create<SageStore>((set) => ({
  user:  null,
  token: null,
  setUser:  (user)  => set({ user }),
  setToken: (token) => set({ token }),

  contacts: [],
  setContacts: (contacts) => set({ contacts }),
  addContact: (contact) => set((s) => ({
    contacts: s.contacts.find(c => c.id === contact.id)
      ? s.contacts
      : [...s.contacts, contact]
  })),

  messages: {},
  setMessages: (userId, msgs) => set((s) => ({ messages: { ...s.messages, [userId]: msgs } })),
  addMessage: (userId, msg) => set((s) => ({
    messages: { ...s.messages, [userId]: [...(s.messages[userId] || []), msg] }
  })),
  updateMessageStatus: (userId, msgId, status) => set((s) => ({
    messages: {
      ...s.messages,
      [userId]: (s.messages[userId] || []).map(m => m.id === msgId ? { ...m, status } : m)
    }
  })),
  updateMessageReaction: (userId, msgId, reaction) => set((s) => ({
    messages: {
      ...s.messages,
      [userId]: (s.messages[userId] || []).map(m => m.id === msgId ? { ...m, reaction } : m)
    }
  })),
  deleteMessage: (userId, msgId) => set((s) => ({
    messages: {
      ...s.messages,
      [userId]: (s.messages[userId] || []).filter(m => m.id !== msgId)
    }
  })),

  activeConversation: null,
  setActiveConversation: (id) => set({ activeConversation: id }),

  burnModeEnabled: {},
  typingEnabled: false,
  setBurnMode:     (userId, enabled) => set((s) => ({ burnModeEnabled: { ...s.burnModeEnabled, [userId]: enabled } })),
  setTypingEnabled:(enabled) => set({ typingEnabled: enabled }),

  typingUsers: {},
  setTyping: (userId, isTyping) => set((s) => ({ typingUsers: { ...s.typingUsers, [userId]: isTyping } })),

  peerKeys: {},
  setPeerKey: (userId, pem) => set((s) => ({ peerKeys: { ...s.peerKeys, [userId]: pem } })),
}));
