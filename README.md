# SAGE

> messages vanish at midnight. no history. no trace.

A free, open-source, end-to-end encrypted chat app with a terminal aesthetic.

## Stack
- **App:** React Native + Expo (Android APK + Web browser)
- **Backend:** Python FastAPI + WebSockets
- **Database:** Supabase (free PostgreSQL)
- **Email:** Brevo (300 OTPs/day free)
- **Hosting:** Render.com (free tier)
- **Encryption:** RSA-2048 + AES-256-GCM (keys never leave your device)

## Project Structure
```
sage/
├── backend/
│   ├── main.py          # FastAPI server + WebSocket relay
│   ├── auth.py          # OTP email auth via Brevo
│   ├── cleanup.py       # Midnight reset scheduler
│   ├── crypto_utils.py  # E2E encryption (server-side helpers)
│   ├── schema.sql       # Supabase database schema
│   └── requirements.txt
├── frontend/
│   ├── App.tsx          # Root navigator
│   ├── src/
│   │   ├── screens/     # Login, Contacts, Chat, Settings, Rooms
│   │   ├── utils/       # theme, crypto, api client
│   │   └── store/       # Zustand global state
│   └── package.json
└── DEPLOY.md            # Full step-by-step deployment guide
```

## Features
- ✅ Email OTP login (no passwords)
- ✅ Permanent unique hash ID (sage-xxxxxxxx)
- ✅ Username changeable once
- ✅ E2E encryption (RSA-2048 + AES-256-GCM)
- ✅ Midnight message reset (per user timezone)
- ✅ Delivery receipts [SENT] → [DELIVERED] → [READ]
- ✅ Burn mode (auto-delete after read, timer based on message length)
- ✅ Reactions [+1] [!] [?] via long press
- ✅ Typing indicator (opt-in)
- ✅ QR code identity sharing
- ✅ User search by username
- ✅ Self-destructing rooms (1/6/12/24h) with admin export
- ✅ Push notifications (even when app closed)
- ✅ Black/white terminal UI, SAGE logo cycles color daily

## See DEPLOY.md for setup instructions.
