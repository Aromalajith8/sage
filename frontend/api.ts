// src/utils/api.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

// UPDATE: Using your specific Render URL
const BASE_URL = 'https://sage-10yk.onrender.com';
const WS_URL   = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// ── Token management ─────────────────────────────────────────

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('sage_token');
}
export async function setToken(t: string) {
  return AsyncStorage.setItem('sage_token', t);
}
export async function clearToken() {
  return AsyncStorage.removeItem('sage_token');
}

// ── HTTP helpers ─────────────────────────────────────────────

async function apiFetch(path: string, options: RequestInit = {}, auth = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { ...headers, ...(options.headers as any) } });
  
  // Robust error handling for non-JSON responses
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || 'Request failed');
    return data;
  } else {
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'Request failed');
    return text;
  }
}

// ── Auth & Endpoints ──────────────────────────────────────────

export const api = {
  sendOtp:        (email: string) => apiFetch('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) }, false),
  verifyOtp:      (email: string, code: string) => apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }, false),
  registerNew:    (email: string, username: string, pubkey_pem: string) =>
                    apiFetch('/auth/register-new', { method: 'POST', body: JSON.stringify({ email, username, pubkey_pem }) }, false),
  getMe:          () => apiFetch('/auth/me'),
  changeUsername: (new_username: string) => apiFetch('/auth/change-username', { method: 'POST', body: JSON.stringify({ username: new_username }) }),
  updatePubkey:   (pubkey_pem: string) => apiFetch('/auth/update-pubkey', { method: 'POST', body: JSON.stringify({ public_key: pubkey_pem }) }),
  updateBio:      (bio: string) => apiFetch('/auth/update-bio', { method: 'POST', body: JSON.stringify({ bio }) }),

  searchUsers:    (q: string) => apiFetch(`/search?q=${encodeURIComponent(q)}`),
  getUserByHash:  (hash_id: string) => apiFetch(`/user-by-hash/${hash_id}`),
  getPubkey:      (user_id: string) => apiFetch(`/users/${user_id}/pubkey`),

  getContacts:    () => apiFetch('/contacts'),
  getMessages:    (user_id: string) => apiFetch(`/messages/${user_id}`),

  createRoom:     (name: string, duration_hours: number) =>
                    apiFetch('/rooms/create', { method: 'POST', body: JSON.stringify({ name, duration_hours }) }),
  joinRoom:       (code: string) => apiFetch('/rooms/join', { method: 'POST', body: JSON.stringify({ code }) }),
  getRoomMessages:(room_id: string) => apiFetch(`/rooms/${room_id}/messages`),
  exportRoom:     (room_id: string) => apiFetch(`/rooms/${room_id}/export`),
};

// ── WebSocket Manager ─────────────────────────────────────────

type MessageHandler = (msg: any) => void;

class SageWebSocket {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private userId = '';
  private token  = '';

  connect(userId: string, token: string) {
    this.userId = userId;
    this.token  = token;
    this._connect();
  }

  private _connect() {
    if (this.ws) this.ws.close();
    this.ws = new WebSocket(`${WS_URL}/ws/${this.userId}?token=${this.token}`);

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handlers.forEach(h => h(msg));
      } catch {}
    };

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this._connect(), 3000);
    };

    this.ws.onerror = () => this.ws?.close();
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export const wsClient = new SageWebSocket();
