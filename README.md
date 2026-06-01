# Karamat Idara Management System (KIMS)
### Ashara Mubaraka 1448H — London

A shared web application for managing khidmatguzar scheduling, tasks, and issue reporting during Ashara Mubaraka.

---

## Deploy to Railway (Free — 5 minutes)

### Step 1 — Create a GitHub repository

1. Go to [github.com](https://github.com) and sign in (or create a free account)
2. Click **New repository** → name it `kims` → click **Create repository**
3. On your computer, open a terminal in this folder and run:

```bash
git init
git add .
git commit -m "Initial KIMS deployment"
git remote add origin https://github.com/YOUR_USERNAME/kims.git
git push -u origin main
```

### Step 2 — Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `kims` repository
4. Railway auto-detects Node.js and deploys — takes about 2 minutes

### Step 3 — Set environment variables (important!)

In your Railway project dashboard:
1. Click on your service → **Variables** tab
2. Add these variables:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | Choose a strong password |
| `SESSION_SECRET` | Any long random string (e.g. 32+ random characters) |
| `NODE_ENV` | `production` |

### Step 4 — Get your URL

1. In Railway, click **Settings** → **Domains**
2. Click **Generate Domain** — you'll get a URL like `kims-production.up.railway.app`
3. Share this URL with your team

---

## First login

- Open your Railway URL
- Log in with the `ADMIN_PASSWORD` you set in environment variables
- Go to the **Khidmatguzars** tab and import your CSV or add people manually
- Each person's ITS number becomes their login password

---

## Persistent storage on Railway

Railway's free tier uses an **ephemeral filesystem** — the SQLite database resets on redeploy.

To make data permanent, add a **Railway Volume**:
1. In your project dashboard, click **New** → **Volume**
2. Mount it at `/app/data`
3. Your database will now survive redeploys

---

## Local development

```bash
npm install
node server.js
# Opens on http://localhost:3000
```

Default admin password locally: `admin123`
