"""
auth.py — Email OTP Authentication via Brevo
"""

import os, secrets, string, hashlib, requests
from datetime import datetime, timedelta, timezone
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
BREVO_API_KEY = os.getenv("BREVO_API_KEY")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "noreply@sage.app")
BREVO_SENDER_NAME = os.getenv("BREVO_SENDER_NAME", "Sage")

db = create_client(SUPABASE_URL, SUPABASE_KEY)


def generate_otp() -> str:
    """Cryptographically secure 6-digit OTP."""
    return "".join(secrets.choice(string.digits) for _ in range(6))


def send_otp_email(email: str) -> bool:
    """
    Generate OTP, store in DB, send via Brevo.
    Returns True on success.
    """
    code = generate_otp()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()

    # Store OTP — invalidate old ones for this email first
    db.table("otp_codes").update({"used": True}).eq("email", email).eq("used", False).execute()
    db.table("otp_codes").insert({
        "email": email,
        "code": code,
        "expires_at": expires_at,
        "used": False
    }).execute()

    # Send via Brevo Transactional Email API
    payload = {
        "sender": {"name": BREVO_SENDER_NAME, "email": BREVO_SENDER_EMAIL},
        "to": [{"email": email}],
        "subject": f"{code} is your Sage code",
        "htmlContent": f"""
        <div style="background:#000;color:#fff;font-family:monospace;padding:40px;max-width:480px;margin:0 auto;">
          <h1 style="color:#f0c040;letter-spacing:4px;font-size:28px;">SAGE</h1>
          <p style="font-size:14px;color:#aaa;">Your one-time login code:</p>
          <h2 style="font-size:48px;letter-spacing:12px;margin:20px 0;color:#fff;">{code}</h2>
          <p style="color:#555;font-size:12px;">Expires in 10 minutes. Do not share this code.</p>
          <p style="color:#333;font-size:11px;margin-top:40px;">If you didn't request this, ignore this email.</p>
        </div>
        """
    }

    resp = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        json=payload,
        headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"}
    )
    return resp.status_code == 201


def verify_otp(email: str, code: str) -> bool:
    """
    Check OTP is valid, not expired, not used.
    Marks it as used on success.
    """
    now = datetime.now(timezone.utc).isoformat()
    result = db.table("otp_codes").select("*").eq("email", email).eq("code", code)\
               .eq("used", False).gt("expires_at", now).limit(1).execute()

    if not result.data:
        return False

    # Mark used
    db.table("otp_codes").update({"used": True}).eq("id", result.data[0]["id"]).execute()
    return True


def get_or_create_user(email: str) -> dict | None:
    """Return existing user by email, or None if not registered yet."""
    result = db.table("users").select("*").eq("email", email).limit(1).execute()
    return result.data[0] if result.data else None


def create_user(email: str, username: str, timezone_str: str = "UTC") -> dict:
    """
    Create new user with unique username and generated hash_id.
    Raises ValueError if username taken.
    """
    # Check username uniqueness
    existing = db.table("users").select("id").eq("username", username).limit(1).execute()
    if existing.data:
        raise ValueError("Username already taken")

    # Generate unique sage hash ID
    hash_id = _generate_hash_id()

    user = {
        "email": email,
        "username": username,
        "hash_id": hash_id,
        "display_name": username,
        "timezone": timezone_str,
    }
    result = db.table("users").insert(user).execute()
    return result.data[0]


def change_username(user_id: str, new_username: str) -> dict:
    """
    Change username — only allowed once.
    Raises ValueError if already changed or username taken.
    """
    user = db.table("users").select("*").eq("id", user_id).single().execute().data
    if user["username_changed_at"] is not None:
        raise ValueError("Username can only be changed once.")

    existing = db.table("users").select("id").eq("username", new_username).limit(1).execute()
    if existing.data:
        raise ValueError("Username already taken.")

    result = db.table("users").update({
        "username": new_username,
        "display_name": new_username,
        "username_changed_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", user_id).execute()
    return result.data[0]


def _generate_hash_id() -> str:
    """Generate unique sage-xxxxxxxx ID."""
    while True:
        candidate = "sage-" + secrets.token_hex(4)  # sage-a3f7b2c9
        existing = db.table("users").select("id").eq("hash_id", candidate).limit(1).execute()
        if not existing.data:
            return candidate
