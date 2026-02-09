# YSS Attendance System

A GPS-verified, tamper-proof staff attendance system with salary calculation.

## Features

- 🔐 GPS-verified clock in/out for staff
- 👤 Staff & Admin login with PIN/Password
- 💷 Automatic salary calculation (Bank + Cash split)
- 📊 Real-time dashboard with attendance overview
- 📅 Backdated entry support for admin
- 💰 Payment tracking with pending amounts
- 📥 CSV export for attendance and salary data
- 🔄 Real-time sync across devices via Supabase

---

## Deployment Instructions

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note down your **Project URL** and **Anon Key** from Settings → API

### Step 2: Create Database Tables

Go to **SQL Editor** in your Supabase dashboard and run this SQL:

```sql
-- YSS Attendance System - Supabase Schema

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS yss_employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT DEFAULT 'General',
  pin TEXT NOT NULL,
  pay_type TEXT DEFAULT 'bank_cash',
  on_hour_rate DECIMAL(10,2) DEFAULT 12.21,
  off_hour_rate DECIMAL(10,2) DEFAULT 12.21,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Attendance Records Table
CREATE TABLE IF NOT EXISTS yss_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES yss_employees(id) ON DELETE CASCADE,
  employee_name TEXT NOT NULL,
  date TEXT NOT NULL,
  clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
  clock_out TIMESTAMP WITH TIME ZONE,
  hash TEXT,
  backdated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Payments Table
CREATE TABLE IF NOT EXISTS yss_payments (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES yss_employees(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  amount DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

-- Enable Row Level Security
ALTER TABLE yss_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE yss_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE yss_payments ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations
CREATE POLICY "Allow all on yss_employees" ON yss_employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on yss_records" ON yss_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on yss_payments" ON yss_payments FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_records_employee_id ON yss_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_records_date ON yss_records(date);
CREATE INDEX IF NOT EXISTS idx_payments_employee_id ON yss_payments(employee_id);
```

### Step 3: Enable Realtime

1. Go to **Database → Replication** in Supabase
2. Enable realtime for these tables:
   - yss_employees
   - yss_records
   - yss_payments

### Step 4: Configure the App

Edit `src/supabase.js` and replace with your credentials:

```javascript
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY'
```

### Step 5: Install & Run Locally

```bash
npm install
npm run dev
```

### Step 6: Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your GitHub repository
4. Deploy!

Or use Vercel CLI:
```bash
npm install -g vercel
vercel
```

---

## Login Credentials

- **Staff Password:** `6891`
- **Admin Password:** `L0nd0nC1ty@2022`

Staff members also have individual 4-digit PINs set by admin.

---

## GPS Location

The GPS verification is set to:
- **Latitude:** 51.617404
- **Longitude:** -0.311809
- **Radius:** 0.1 miles (160.934 metres)

To change this, edit `GEO_FENCE` in `src/App.jsx`.

---

## Tech Stack

- React 18
- Vite
- Supabase (PostgreSQL + Realtime)
- Montserrat Font
