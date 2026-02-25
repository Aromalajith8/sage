# SAGE — Complete Deployment Guide
Everything free. Step by step. No prior experience needed.

---

## PART 1 — Supabase (Database) [~10 minutes]

**1.** Go to https://supabase.com → click "Start your project" → sign up (free)

**2.** Click "New project"
- Name: `sage`
- Database Password: create a strong password, SAVE IT
- Region: pick closest to you
- Click "Create new project" (takes ~2 minutes)

**3.** Once ready: click "SQL Editor" in the left sidebar

**4.** Paste the entire contents of `backend/schema.sql` into the editor

**5.** Click "Run" — you should see "Success. No rows returned"

**6.** Go to: Settings → API (left sidebar)
- Copy "Project URL" → this is your `SUPABASE_URL`
- Under "Project API Keys" → copy the `service_role` key → this is your `SUPABASE_SERVICE_KEY`
- ⚠️ Keep the service_role key secret — it has full database access

---

## PART 2 — Brevo (Email OTP) [~5 minutes]

**1.** Go to https://app.brevo.com → sign up (free, 300 emails/day)

**2.** Verify your email address

**3.** Go to: Account → SMTP & API → API Keys → Generate a new API key
- Name it "sage"
- Copy the key → this is your `BREVO_API_KEY`

**4.** Go to: Senders & IP → Senders → Add a new sender
- Name: `Sage`
- Email: use your own email (e.g. `yourname@gmail.com`) or buy a domain
- This is your `BREVO_SENDER_EMAIL`

---

## PART 3 — Deploy Backend to Render [~10 minutes]

**1.** Push your code to GitHub:
```bash
git init
git add .
git commit -m "sage initial commit"
# Go to github.com → New repository → create one
git remote add origin https://github.com/YOUR_USERNAME/sage.git
git push -u origin main
```

**2.** Go to https://render.com → sign up (free) → "New Web Service"

**3.** Connect your GitHub account → select your `sage` repo

**4.** Configure:
- Name: `sage-backend`
- Region: pick closest to you
- Branch: `main`
- Root Directory: `backend`
- Runtime: `Python 3`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Plan: **Free**

**5.** Click "Advanced" → "Add Environment Variables":

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | your supabase url |
| `SUPABASE_SERVICE_KEY` | your service_role key |
| `BREVO_API_KEY` | your brevo api key |
| `BREVO_SENDER_EMAIL` | your sender email |
| `BREVO_SENDER_NAME` | Sage |
| `SECRET_KEY` | generate with: `python3 -c "import secrets; print(secrets.token_hex(32))"` |

**6.** Click "Create Web Service" — wait ~3 minutes

**7.** Your backend URL will be: `https://sage-backend.onrender.com`
Test it: open `https://sage-backend.onrender.com/health` in browser — should show `{"status":"ok"}`

⚠️ **Render free tier note:** The server sleeps after 15 minutes of inactivity and takes ~30 seconds to wake up on first request. For 20 concurrent users this is fine — the WebSocket keeps it alive while people are chatting.

---

## PART 4 — Build the Android APK [~15 minutes]

**1.** Install Node.js from https://nodejs.org (LTS version)

**2.** Install Expo CLI:
```bash
npm install -g @expo/eas-cli
```

**3.** Go into the frontend folder:
```bash
cd sage/frontend
npm install
```

**4.** Set your backend URL — create a file called `.env` in the frontend folder:
```
EXPO_PUBLIC_API_URL=https://sage-backend.onrender.com
```

**5.** Log in to Expo (free account):
```bash
eas login
# Sign up at expo.dev if you don't have an account
```

**6.** Initialize EAS:
```bash
eas build:configure
# When asked, say YES to everything, choose Android
```

**7.** Build the APK:
```bash
eas build --platform android --profile preview
```
This runs in the cloud — you don't need Android Studio.
Takes 10-15 minutes. You'll get a download link when done.

**8.** Download the `.apk` file from the link

**9.** To install on Android:
- Transfer the APK to your phone (email it to yourself, or use a cable)
- On Android: Settings → Security → Unknown Sources → Enable
- Open the APK file → Install

---

## PART 5 — Web Version (Laptop + Mobile Browser)

The app runs in the browser automatically. To deploy the web version:

**1.** Build for web:
```bash
cd sage/frontend
npx expo export --platform web
```

**2.** Deploy to Netlify (free):
- Go to https://netlify.com → sign up
- Drag the `dist` folder onto the Netlify dashboard
- Get a free URL like `https://sage-chat.netlify.app`

That's it. Users can open this URL on any laptop or phone browser.

---

## PART 6 — Share Sage with Your Friends

Send them:
- **Android:** the `.apk` file
- **Browser:** your Netlify URL
- **How to join:** "sign up with your email, get the OTP code, pick a username, done"

---

## Troubleshooting

**"Cannot connect to server"**
→ Check that your Render backend is awake. Open the `/health` URL in browser first.
→ Make sure `EXPO_PUBLIC_API_URL` in your `.env` points to your Render URL exactly.

**"OTP not arriving"**
→ Check Brevo dashboard → Logs → see if email was attempted
→ Check spam folder
→ Make sure your sender email is verified in Brevo

**"Username already taken"**
→ Someone else has that username. Try adding numbers or underscore.

**"Decryption failed"**
→ Usually happens if user logs in on a new device (new RSA keys generated).
→ Old messages from previous key pair won't decrypt — this is expected and secure.

**Render wakes up slowly**
→ Free tier — normal behavior. The first message after idle takes ~30 seconds.
→ Upgrade to Render Starter ($7/mo) to eliminate cold starts.

---

## Updating the App

When you make changes:

**Backend:** push to GitHub → Render auto-deploys (1-2 minutes)

**Android APK:** run `eas build --platform android --profile preview` again → new APK download link

**Web:** run `npx expo export --platform web` → drag new `dist` folder to Netlify

---

## Security Notes

- Your `SUPABASE_SERVICE_KEY` must NEVER be committed to GitHub. Add `.env` to `.gitignore`.
- The server cannot decrypt any messages — only clients can.
- Private RSA keys are stored in the device's secure keychain (iOS Keychain / Android Keystore).
- All messages are wiped at midnight. Server stores only encrypted blobs during the day.
