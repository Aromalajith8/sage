// src/screens/ContactsScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Modal,
} from 'react-native';
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { api } from '../utils/api';
import { useStore, Contact } from '../store';

interface Props {
  onSelectContact: (contact: Contact) => void;
  onOpenSettings:  () => void;
  onOpenRooms:     () => void;
}

export default function ContactsScreen({ onSelectContact, onOpenSettings, onOpenRooms }: Props) {
  const { user, contacts, setContacts, addContact, messages } = useStore();
  const [searching, setSearching]  = useState(false);
  const [searchQ, setSearchQ]      = useState('');
  const [searchResults, setResults] = useState<any[]>([]);
  const [loading, setLoading]      = useState(false);
  const sageColor = getSageColor();

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const res = await api.getContacts();
      setContacts(res.contacts || []);
    } catch {}
  };

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) return setResults([]);
    setLoading(true);
    try {
      const res = await api.searchUsers(q);
      setResults(res.users || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQ), 350);
    return () => clearTimeout(t);
  }, [searchQ]);

  const handleAddContact = async (u: any) => {
    addContact(u);
    setSearching(false);
    setSearchQ('');
    onSelectContact(u);
  };

  const getLastMessagePreview = (contactId: string) => {
    const msgs = messages[contactId] || [];
    const last = msgs[msgs.length - 1];
    if (!last) return '';
    if (last.burn_mode) return '[burn]';
    return last.decrypted_text ? last.decrypted_text.slice(0, 35) + (last.decrypted_text.length > 35 ? '…' : '') : '[encrypted]';
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={[s.logo, { color: sageColor }]}>SAGE</Text>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={() => setSearching(true)} style={s.iconBtn}>
            <Text style={s.icon}>[+]</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenRooms} style={s.iconBtn}>
            <Text style={s.icon}>[#]</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenSettings} style={s.iconBtn}>
            <Text style={s.icon}>[⚙]</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={s.userId}>id: {user?.hash_id}</Text>

      {/* Contact list */}
      {contacts.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>{'> no contacts yet'}</Text>
          <Text style={s.emptyHint}>tap [+] to find someone</Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={c => c.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={s.contactRow} onPress={() => onSelectContact(item)}>
              <View style={s.contactLeft}>
                <Text style={s.contactName}>{item.username}</Text>
                <Text style={s.contactPreview}>{getLastMessagePreview(item.id)}</Text>
              </View>
              <Text style={s.contactArrow}>{'>'}</Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}

      {/* Search modal */}
      <Modal visible={searching} animationType="fade" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={[s.modalTitle, { color: sageColor }]}>FIND USER</Text>
            <TextInput
              style={s.searchInput}
              placeholder="username..."
              placeholderTextColor={Colors.textMuted}
              value={searchQ}
              onChangeText={setSearchQ}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {loading && <ActivityIndicator color={Colors.textDim} style={{ marginVertical: 8 }} />}
            {searchResults.map(u => (
              <TouchableOpacity key={u.id} style={s.searchResult} onPress={() => handleAddContact(u)}>
                <Text style={s.searchUsername}>{u.username}</Text>
                <Text style={s.searchHash}>{u.hash_id}</Text>
              </TouchableOpacity>
            ))}
            {searchQ.length > 1 && !loading && searchResults.length === 0 && (
              <Text style={s.noResults}>no users found</Text>
            )}
            <TouchableOpacity onPress={() => { setSearching(false); setSearchQ(''); setResults([]); }}>
              <Text style={s.cancelBtn}>[cancel]</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
             paddingHorizontal: Spacing.md, paddingTop: Spacing.xl, paddingBottom: Spacing.sm,
             borderBottomWidth: 1, borderBottomColor: Colors.border },
  logo:    { fontFamily: Font.mono, fontSize: Font.size.xl, fontWeight: 'bold', letterSpacing: 6 },
  headerRight: { flexDirection: 'row', gap: Spacing.sm },
  iconBtn: { padding: Spacing.xs },
  icon:    { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.base },
  userId:  { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs,
             paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
             borderBottomWidth: 1, borderBottomColor: Colors.borderDim },
  empty:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText:{ fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.base },
  emptyHint:{ fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: Spacing.sm },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.md },
  contactLeft: { flex: 1 },
  contactName: { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.base },
  contactPreview: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: 2 },
  contactArrow:   { fontFamily: Font.mono, color: Colors.textMuted },
  separator: { height: 1, backgroundColor: Colors.borderDim, marginLeft: Spacing.md },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: Spacing.xl },
  modal:        { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg },
  modalTitle:   { fontFamily: Font.mono, fontSize: Font.size.lg, fontWeight: 'bold',
                  letterSpacing: 4, marginBottom: Spacing.md },
  searchInput:  { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.base,
                  borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm,
                  backgroundColor: Colors.inputBg, marginBottom: Spacing.sm },
  searchResult: { paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderDim },
  searchUsername:{ fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.sm },
  searchHash:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs },
  noResults:    { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginVertical: Spacing.sm },
  cancelBtn:    { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, marginTop: Spacing.md, textAlign: 'center' },
});
