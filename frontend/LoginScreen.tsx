// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Colors, Font, Spacing, getSageColor } from '../utils/theme';
import { api, setToken } from '../utils/api';
import { generateOrLoadKeyPair } from '../utils/crypto';
import { useStore } from '../store';

type Step = 'email' | 'otp' | 'register';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [step, setStep]       = useState<Step>('email');
  const [email, setEmail]     = useState('');
  const [otp, setOtp]         = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const { setUser, setToken: storeSetToken } = useStore();
  const sageColor = getSageColor();

  const handleSendOtp = async () => {
    if (!email.includes('@')) return setError('Enter a valid email');
    setLoading(true); setError('');
    try {
      await api.sendOtp(email.toLowerCase().trim());
      setStep('otp');
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return setError('Enter the 6-digit code');
    setLoading(true); setError('');
    try {
      const res = await api.verifyOtp(email, otp);
      if (res.needs_registration) {
        setStep('register');
      } else {
        await setToken(res.token);
        storeSetToken(res.token);
        setUser(res.user);
        onLogin();
      }
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const handleRegister = async () => {
    const clean = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
      return setError('3–20 chars: lowercase, numbers, underscores only');
    }
    setLoading(true); setError('');
    try {
      const { publicKeyPem } = await generateOrLoadKeyPair();
      const res = await api.registerNew(email, clean, publicKeyPem);
      await setToken(res.token);
      storeSetToken(res.token);
      setUser(res.user);
      onLogin();
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>

        {/* Logo */}
        <Text style={[s.logo, { color: sageColor }]}>SAGE</Text>
        <Text style={s.tagline}>
          {step === 'email'    ? '> enter your email_'
         : step === 'otp'     ? '> check your inbox_'
         : '> choose your identity_'}
        </Text>

        {/* Email step */}
        {step === 'email' && (
          <>
            <TextInput
              style={s.input}
              placeholder="email@address.com"
              placeholderTextColor={Colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Btn label="SEND CODE" onPress={handleSendOtp} loading={loading} color={sageColor} />
          </>
        )}

        {/* OTP step */}
        {step === 'otp' && (
          <>
            <Text style={s.hint}>6-digit code sent to {email}</Text>
            <TextInput
              style={[s.input, s.otpInput]}
              placeholder="_ _ _ _ _ _"
              placeholderTextColor={Colors.textMuted}
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <Btn label="VERIFY" onPress={handleVerifyOtp} loading={loading} color={sageColor} />
            <TouchableOpacity onPress={() => { setStep('email'); setOtp(''); }}>
              <Text style={s.back}>&lt; back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Register step */}
        {step === 'register' && (
          <>
            <Text style={s.hint}>new to sage. pick your username.</Text>
            <TextInput
              style={s.input}
              placeholder="your_username"
              placeholderTextColor={Colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <Text style={s.usernameRules}>lowercase · numbers · underscore · 3-20 chars</Text>
            <Btn label="CREATE ACCOUNT" onPress={handleRegister} loading={loading} color={sageColor} />
          </>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Text style={s.footer}>messages vanish at midnight. no history. no trace.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function Btn({ label, onPress, loading, color }: any) {
  return (
    <TouchableOpacity style={[s.btn, { borderColor: color }]} onPress={onPress} disabled={loading}>
      {loading
        ? <ActivityIndicator color={color} size="small" />
        : <Text style={[s.btnText, { color }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: Colors.bg },
  inner:    { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl },
  logo:     { fontFamily: Font.mono, fontSize: 48, fontWeight: 'bold', letterSpacing: 12, marginBottom: Spacing.sm },
  tagline:  { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.sm, marginBottom: Spacing.xl },
  input:    { fontFamily: Font.mono, color: Colors.text, fontSize: Font.size.base,
              borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg,
              padding: Spacing.md, marginBottom: Spacing.md },
  otpInput: { fontSize: Font.size.xl, letterSpacing: 12, textAlign: 'center' },
  btn:      { borderWidth: 1, padding: Spacing.md, alignItems: 'center', marginBottom: Spacing.md },
  btnText:  { fontFamily: Font.mono, fontSize: Font.size.sm, fontWeight: 'bold', letterSpacing: 4 },
  hint:     { fontFamily: Font.mono, color: Colors.textDim, fontSize: Font.size.xs, marginBottom: Spacing.md },
  usernameRules: { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginBottom: Spacing.md },
  back:     { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs, marginTop: Spacing.sm },
  error:    { fontFamily: Font.mono, color: '#ff4444', fontSize: Font.size.xs, marginTop: Spacing.sm },
  footer:   { fontFamily: Font.mono, color: Colors.textMuted, fontSize: Font.size.xs,
              position: 'absolute', bottom: Spacing.xl, alignSelf: 'center', textAlign: 'center' },
});
