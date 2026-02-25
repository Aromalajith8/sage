-- ============================================================
-- SAGE — Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── USERS ────────────────────────────────────────────────────
create table users (
  id            uuid primary key default uuid_generate_v4(),
  email         text unique not null,
  username      text unique not null,           -- lowercase, letters/numbers/underscore
  hash_id       text unique not null,           -- sage-xxxxxxxx (public shareable ID)
  display_name  text not null,                  -- same as username initially
  username_changed_at timestamptz default null, -- null = never changed (one change allowed)
  timezone      text default 'UTC',             -- detected from IP at login
  push_token    text default null,              -- Expo push token
  typing_indicator_enabled boolean default false,
  created_at    timestamptz default now(),
  last_seen     timestamptz default now()
);

-- ── OTP CODES ────────────────────────────────────────────────
create table otp_codes (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null,
  code       text not null,                     -- 6-digit code
  expires_at timestamptz not null,              -- 10 minutes from creation
  used       boolean default false,
  created_at timestamptz default now()
);

-- Auto-delete used/expired OTPs after 1 hour
create or replace function cleanup_otps() returns void as $$
  delete from otp_codes where expires_at < now() - interval '1 hour';
$$ language sql;

-- ── CONTACTS ─────────────────────────────────────────────────
-- Stores who has messaged whom (only these appear in contact list)
create table contacts (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references users(id) on delete cascade,
  contact_id uuid references users(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, contact_id)
);

-- ── DIRECT MESSAGES ──────────────────────────────────────────
create table messages (
  id              uuid primary key default uuid_generate_v4(),
  sender_id       uuid references users(id) on delete cascade,
  receiver_id     uuid references users(id) on delete cascade,
  encrypted_data  text not null,               -- opaque E2E encrypted blob
  status          text default 'sent',         -- sent | delivered | read
  burn_mode       boolean default false,
  burn_duration_ms integer default null,       -- milliseconds before deletion
  burned_at       timestamptz default null,    -- when to delete (set on delivery)
  reaction        text default null,           -- '+1' | '!' | '?'
  created_at      timestamptz default now(),
  expires_at      timestamptz not null,        -- midnight of sender's timezone
  deleted         boolean default false        -- soft delete flag
);

-- Index for fast conversation queries
create index messages_conversation_idx on messages(sender_id, receiver_id, created_at);
create index messages_expires_idx on messages(expires_at) where deleted = false;

-- ── ROOMS (Self-Destructing Group Chats) ─────────────────────
create table rooms (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  room_code   text unique not null,            -- short join code e.g. SAGE-XK29
  admin_id    uuid references users(id) on delete cascade,
  expires_at  timestamptz not null,
  exported    boolean default false,
  created_at  timestamptz default now()
);

-- ── ROOM MEMBERS ─────────────────────────────────────────────
create table room_members (
  id        uuid primary key default uuid_generate_v4(),
  room_id   uuid references rooms(id) on delete cascade,
  user_id   uuid references users(id) on delete cascade,
  joined_at timestamptz default now(),
  unique(room_id, user_id)
);

-- ── ROOM MESSAGES ────────────────────────────────────────────
create table room_messages (
  id             uuid primary key default uuid_generate_v4(),
  room_id        uuid references rooms(id) on delete cascade,
  sender_id      uuid references users(id) on delete cascade,
  encrypted_data text not null,
  reaction       text default null,
  created_at     timestamptz default now(),
  deleted        boolean default false
);

-- ── PUBLIC KEYS (for E2E encryption) ─────────────────────────
create table public_keys (
  user_id    uuid primary key references users(id) on delete cascade,
  pubkey_pem text not null,
  updated_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table users         enable row level security;
alter table messages      enable row level security;
alter table contacts      enable row level security;
alter table rooms         enable row level security;
alter table room_members  enable row level security;
alter table room_messages enable row level security;
alter table public_keys   enable row level security;

-- We use service_role key on backend (bypasses RLS).
-- These policies are for safety if anon key is ever used.
create policy "service only" on users         using (false);
create policy "service only" on messages      using (false);
create policy "service only" on contacts      using (false);
create policy "service only" on rooms         using (false);
create policy "service only" on room_members  using (false);
create policy "service only" on room_messages using (false);
create policy "service only" on public_keys   using (false);
