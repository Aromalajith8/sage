"""
main.py — Sage Backend Server
FastAPI + WebSockets. Server is a blind relay — cannot decrypt messages.

Endpoints:
  POST /auth/send-otp          — Send OTP to email
  POST /auth/verify-otp        — Verify OTP, return session token
  POST /auth/register          — Complete registration (username + pubkey)
  GET  /auth/me                — Get current user profile
  POST /auth/change-username   — Change username (once only)
  POST /auth/update-pubkey     — Store/update RSA public key
  GET  /users/search?q=        — Search users by username
  GET  /users/:hash_id         — Get user by hash_id (for QR scan)
  GET  /contacts               — Get contact list
  GET  /messages/:user_id      — Get message history with a user (today only)
  GET  /rooms/:room_id/export  — Export room chat as .txt (admin only)
  POST /rooms                  — Create a room
  POST /rooms/join             — Join room by code
  WS   /ws/:user_id            — WebSocket connection for real-time chat
"""

import os, json, secrets, logging, hashlib
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, EmailStr
from supabase import create_client
from dotenv import load_dotenv

from auth import send_otp_email, verify_otp, get_or_create_user, create_user, change_username
from cleanup import start_scheduler, calculate_message_expiry
import pytz, requests as req_lib

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sage")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SECRET_KEY   = os.getenv("SECRET_KEY", "changeme")
db = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Lifespan ─────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # scheduler = start_scheduler()
    yield
    # scheduler.shutdown()

app = FastAPI(title="Sage", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"])

# ── Session tokens (simple signed tokens, no JWT library needed) ──
def make_token(user_id: str) -> str:
    raw = f"{user_id}:{SECRET_KEY}"
    sig = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"{user_id}.{sig}"

def verify_token(token: str) -> str:
    """Returns user_id or raises HTTPException."""
    try:
        user_id, sig = token.rsplit(".", 1)
        expected = hashlib.sha256(f"{user_id}:{SECRET_KEY}".encode()).hexdigest()[:16]
        if sig != expected:
            raise ValueError()
        return user_id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    user_id = verify_token(token)
    result = db.table("users").select("*").eq("id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="User not found")
    return result.data[0]

def get_user_timezone_from_ip(ip: str) -> str:
    """Detect timezone from IP using free ip-api.com (1000 req/min free)."""
    try:
        r = req_lib.get(f"http://ip-api.com/json/{ip}?fields=timezone", timeout=3)
        tz = r.json().get("timezone", "UTC")
        pytz.timezone(tz)  # validate
        return tz
    except Exception:
        return "UTC"

# ── WebSocket Connection Manager ──────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: dict[str, WebSocket] = {}  # user_id → websocket

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.active[user_id] = ws
        log.info(f"[ws] {user_id} connected. Online: {len(self.active)}")

    def disconnect(self, user_id: str):
        self.active.pop(user_id, None)
        log.info(f"[ws] {user_id} disconnected. Online: {len(self.active)}")

    async def send(self, user_id: str, data: dict):
        ws = self.active.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(user_id)

    async def broadcast_room(self, room_id: str, data: dict, exclude_user: str = None):
        members = db.table("room_members").select("user_id").eq("room_id", room_id).execute()
        for m in (members.data or []):
            uid = m["user_id"]
            if uid != exclude_user:
                await self.send(uid, data)

ws_manager = ConnectionManager()

# ═══════════════════════════════════════════════════════════════
# AUTH ROUTES
# ═══════════════════════════════════════════════════════════════

class SendOTPRequest(BaseModel):
    email: str

class VerifyOTPRequest(BaseModel):
    email: str
    code: str

class RegisterRequest(BaseModel):
    username: str
    pubkey_pem: str

class ChangeUsernameRequest(BaseModel):
    new_username: str

class UpdatePubkeyRequest(BaseModel):
    pubkey_pem: str

@app.post("/auth/send-otp")
async def send_otp(body: SendOTPRequest, x_forwarded_for: Optional[str] = Header(None)):
    success = send_otp_email(body.email.lower().strip())
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send OTP email")
    return {"ok": True}

@app.post("/auth/verify-otp")
async def verify_otp_route(body: VerifyOTPRequest, x_forwarded_for: Optional[str] = Header(None)):
    email = body.email.lower().strip()
    if not verify_otp(email, body.code.strip()):
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    user = get_or_create_user(email)
    if not user:
        # New user — needs registration
        return {"ok": True, "needs_registration": True, "email": email}

    # Update timezone from IP
    ip = (x_forwarded_for or "").split(",")[0].strip() or "8.8.8.8"
    tz = get_user_timezone_from_ip(ip)
    db.table("users").update({"timezone": tz, "last_seen": datetime.now(timezone.utc).isoformat()})\
      .eq("id", user["id"]).execute()

    token = make_token(user["id"])
    return {"ok": True, "needs_registration": False, "token": token, "user": _safe_user(user)}

@app.post("/auth/register")
async def register(body: RegisterRequest, authorization: str = Header(None),
                   x_forwarded_for: Optional[str] = Header(None)):
    # During registration we use a temporary email token
    # The email is passed via a short-lived temp token stored in headers
    # Simpler: pass email in body since OTP was just verified
    raise HTTPException(status_code=400, detail="Use /auth/register-new")

class RegisterNewRequest(BaseModel):
    email: str
    username: str
    pubkey_pem: str

@app.post("/auth/register-new")
async def register_new(body: RegisterNewRequest, x_forwarded_for: Optional[str] = Header(None)):
    """Called after OTP verify for new users."""
    username = body.username.lower().strip()
    if not _valid_username(username):
        raise HTTPException(status_code=400,
            detail="Username must be 3-20 chars: lowercase letters, numbers, underscores only")

    ip = (x_forwarded_for or "").split(",")[0].strip() or "8.8.8.8"
    tz = get_user_timezone_from_ip(ip)

    try:
        user = create_user(body.email.lower().strip(), username, tz)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Store public key
    db.table("public_keys").upsert({"user_id": user["id"], "pubkey_pem": body.pubkey_pem}).execute()

    token = make_token(user["id"])
    return {"ok": True, "token": token, "user": _safe_user(user)}

@app.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return _safe_user(user)

@app.post("/auth/change-username")
async def change_username_route(body: ChangeUsernameRequest, user=Depends(get_current_user)):
    new = body.new_username.lower().strip()
    if not _valid_username(new):
        raise HTTPException(status_code=400, detail="Invalid username format")
    try:
        updated = change_username(user["id"], new)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True, "user": _safe_user(updated)}

@app.post("/auth/update-pubkey")
async def update_pubkey(body: UpdatePubkeyRequest, user=Depends(get_current_user)):
    db.table("public_keys").upsert({"user_id": user["id"], "pubkey_pem": body.pubkey_pem,
                                     "updated_at": datetime.now(timezone.utc).isoformat()}).execute()
    return {"ok": True}

# ═══════════════════════════════════════════════════════════════
# USER ROUTES
# ═══════════════════════════════════════════════════════════════

@app.get("/users/search")
async def search_users(q: str, user=Depends(get_current_user)):
    if len(q) < 2:
        return {"users": []}
    results = db.table("users").select("id,username,hash_id,display_name,last_seen")\
                .ilike("username", f"%{q}%").neq("id", user["id"]).limit(20).execute()
    return {"users": results.data or []}

@app.get("/users/by-hash/{hash_id}")
async def get_user_by_hash(hash_id: str, user=Depends(get_current_user)):
    result = db.table("users").select("id,username,hash_id,display_name,last_seen")\
               .eq("hash_id", hash_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return result.data[0]

@app.get("/users/{user_id}/pubkey")
async def get_pubkey(user_id: str, user=Depends(get_current_user)):
    result = db.table("public_keys").select("pubkey_pem").eq("user_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Public key not found")
    return {"pubkey_pem": result.data[0]["pubkey_pem"]}

# ═══════════════════════════════════════════════════════════════
# CONTACTS & MESSAGES
# ═══════════════════════════════════════════════════════════════

@app.get("/contacts")
async def get_contacts(user=Depends(get_current_user)):
    result = db.table("contacts").select("contact_id, users!contacts_contact_id_fkey(id,username,hash_id,display_name,last_seen)")\
               .eq("user_id", user["id"]).execute()
    contacts = [r["users"] for r in (result.data or []) if r.get("users")]
    return {"contacts": contacts}

@app.get("/messages/{other_user_id}")
async def get_messages(other_user_id: str, user=Depends(get_current_user)):
    """Get today's message history between two users (non-deleted only)."""
    uid = user["id"]
    result = db.table("messages").select("*")\
               .or_(f"and(sender_id.eq.{uid},receiver_id.eq.{other_user_id}),and(sender_id.eq.{other_user_id},receiver_id.eq.{uid})")\
               .eq("deleted", False).order("created_at").execute()
    return {"messages": result.data or []}

# ═══════════════════════════════════════════════════════════════
# ROOMS
# ═══════════════════════════════════════════════════════════════

class CreateRoomRequest(BaseModel):
    name: str
    duration_hours: int  # 1, 6, 12, 24

class JoinRoomRequest(BaseModel):
    room_code: str

@app.post("/rooms")
async def create_room(body: CreateRoomRequest, user=Depends(get_current_user)):
    if body.duration_hours not in [1, 6, 12, 24]:
        raise HTTPException(status_code=400, detail="Duration must be 1, 6, 12, or 24 hours")
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=body.duration_hours)).isoformat()
    room_code  = "SAGE-" + secrets.token_hex(2).upper()
    room = db.table("rooms").insert({
        "name": body.name, "room_code": room_code,
        "admin_id": user["id"], "expires_at": expires_at
    }).execute().data[0]
    db.table("room_members").insert({"room_id": room["id"], "user_id": user["id"]}).execute()
    return {"room": room}

@app.post("/rooms/join")
async def join_room(body: JoinRoomRequest, user=Depends(get_current_user)):
    result = db.table("rooms").select("*").eq("room_code", body.room_code.upper()).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Room not found")
    room = result.data[0]
    if room["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=410, detail="Room has expired")
    db.table("room_members").upsert({"room_id": room["id"], "user_id": user["id"]}).execute()
    return {"room": room}

@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, user=Depends(get_current_user)):
    # Verify membership
    m = db.table("room_members").select("id").eq("room_id", room_id).eq("user_id", user["id"]).execute()
    if not m.data:
        raise HTTPException(status_code=403, detail="Not a member")
    msgs = db.table("room_messages").select("*, users!room_messages_sender_id_fkey(username,display_name)")\
             .eq("room_id", room_id).eq("deleted", False).order("created_at").execute()
    return {"messages": msgs.data or []}

@app.get("/rooms/{room_id}/export", response_class=PlainTextResponse)
async def export_room(room_id: str, user=Depends(get_current_user)):
    """Export room chat as .txt — admin only."""
    room = db.table("rooms").select("*").eq("id", room_id).single().execute().data
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["admin_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the room admin can export.")

    msgs = db.table("room_messages")\
             .select("created_at, encrypted_data, users!room_messages_sender_id_fkey(username)")\
             .eq("room_id", room_id).eq("deleted", False).order("created_at").execute()

    lines = [f"SAGE — Room Export: {room['name']}", f"Room Code: {room['room_code']}",
             f"Exported: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
             "NOTE: Messages are E2E encrypted. This export contains encrypted blobs only.", "─" * 60]
    for msg in (msgs.data or []):
        ts  = msg["created_at"][:19].replace("T", " ")
        who = msg.get("users", {}).get("username", "?")
        lines.append(f"[{ts}] {who}: [ENCRYPTED — {len(msg['encrypted_data'])} bytes]")

    db.table("rooms").update({"exported": True}).eq("id", room_id).execute()
    return "\n".join(lines)

# ═══════════════════════════════════════════════════════════════
# WEBSOCKET — Real-time relay
# ═══════════════════════════════════════════════════════════════

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(ws: WebSocket, user_id: str, token: str):
    # Verify token passed as query param
    try:
        verified_id = verify_token(token)
        if verified_id != user_id:
            await ws.close(code=4001)
            return
    except Exception:
        await ws.close(code=4001)
        return

    await ws_manager.connect(user_id, ws)
    user = db.table("users").select("*").eq("id", user_id).single().execute().data

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            mtype = msg.get("type")

            # ── Direct Message ────────────────────────────────
            if mtype == "dm":
                to_id        = msg.get("to")
                encrypted    = msg.get("data", "")
                burn_mode    = msg.get("burn_mode", False)
                burn_ms      = msg.get("burn_duration_ms")
                expires_at   = calculate_message_expiry(user.get("timezone", "UTC"))

                # Persist to DB
                row = {
                    "sender_id":       user_id,
                    "receiver_id":     to_id,
                    "encrypted_data":  encrypted,
                    "status":          "sent",
                    "burn_mode":       burn_mode,
                    "burn_duration_ms":burn_ms,
                    "expires_at":      expires_at,
                }
                saved = db.table("messages").insert(row).execute().data[0]

                # Add to contacts (both sides)
                db.table("contacts").upsert({"user_id": user_id,    "contact_id": to_id}).execute()
                db.table("contacts").upsert({"user_id": to_id, "contact_id": user_id}).execute()

                # Relay to receiver — server CANNOT decrypt 'data'
                log.info(f"[relay] DM {user_id}→{to_id} ({len(encrypted)} chars, CANNOT READ)")
                await ws_manager.send(to_id, {
                    "type":        "dm",
                    "id":          saved["id"],
                    "from":        user_id,
                    "from_name":   user["username"],
                    "data":        encrypted,         # still encrypted
                    "burn_mode":   burn_mode,
                    "burn_duration_ms": burn_ms,
                    "created_at":  saved["created_at"],
                })

                # Confirm delivery status to sender
                await ws_manager.send(user_id, {"type": "status", "id": saved["id"], "status": "delivered"
                    if to_id in ws_manager.active else "sent"})

                # Update status if receiver is online
                if to_id in ws_manager.active:
                    db.table("messages").update({"status": "delivered"}).eq("id", saved["id"]).execute()

            # ── Read Receipt ──────────────────────────────────
            elif mtype == "read":
                msg_id = msg.get("id")
                db.table("messages").update({"status": "read"}).eq("id", msg_id).execute()
                row = db.table("messages").select("sender_id").eq("id", msg_id).single().execute().data
                if row:
                    await ws_manager.send(row["sender_id"], {"type": "status", "id": msg_id, "status": "read"})
                    # Set burn timer if applicable
                    msg_row = db.table("messages").select("*").eq("id", msg_id).single().execute().data
                    if msg_row and msg_row.get("burn_mode") and msg_row.get("burn_duration_ms"):
                        burn_at = (datetime.now(timezone.utc) + timedelta(milliseconds=msg_row["burn_duration_ms"])).isoformat()
                        db.table("messages").update({"burned_at": burn_at}).eq("id", msg_id).execute()

            # ── Reaction ──────────────────────────────────────
            elif mtype == "reaction":
                msg_id   = msg.get("id")
                reaction = msg.get("reaction")  # '+1' | '!' | '?'
                if reaction not in ("+1", "!", "?", None):
                    continue
                db.table("messages").update({"reaction": reaction}).eq("id", msg_id).execute()
                row = db.table("messages").select("sender_id,receiver_id").eq("id", msg_id).single().execute().data
                if row:
                    payload = {"type": "reaction", "id": msg_id, "reaction": reaction, "from": user_id}
                    await ws_manager.send(row["sender_id"],   payload)
                    await ws_manager.send(row["receiver_id"], payload)

            # ── Typing Indicator ──────────────────────────────
            elif mtype == "typing":
                to_id = msg.get("to")
                await ws_manager.send(to_id, {
                    "type": "typing", "from": user_id, "from_name": user["username"],
                    "is_typing": msg.get("is_typing", False)
                })

            # ── Room Message ──────────────────────────────────
            elif mtype == "room_msg":
                room_id   = msg.get("room_id")
                encrypted = msg.get("data", "")
                # Verify membership
                m = db.table("room_members").select("id").eq("room_id", room_id).eq("user_id", user_id).execute()
                if not m.data:
                    continue
                saved = db.table("room_messages").insert({
                    "room_id": room_id, "sender_id": user_id, "encrypted_data": encrypted
                }).execute().data[0]
                await ws_manager.broadcast_room(room_id, {
                    "type": "room_msg", "id": saved["id"], "room_id": room_id,
                    "from": user_id, "from_name": user["username"],
                    "data": encrypted, "created_at": saved["created_at"]
                }, exclude_user=user_id)

            # ── Push Token Registration ───────────────────────
            elif mtype == "push_token":
                db.table("users").update({"push_token": msg.get("token")}).eq("id", user_id).execute()

    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(user_id)
        db.table("users").update({"last_seen": datetime.now(timezone.utc).isoformat()})\
          .eq("id", user_id).execute()

# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def _safe_user(u: dict) -> dict:
    """Remove sensitive fields before sending to client."""
    return {k: v for k, v in u.items() if k not in ("email",)}

def _valid_username(u: str) -> bool:
    import re
    return bool(re.match(r'^[a-z0-9_]{3,20}$', u))

@app.get("/health")
async def health():
    return {"status": "ok", "service": "sage"}
