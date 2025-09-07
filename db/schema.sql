CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT,
  email TEXT,
  kyc_status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  amount NUMERIC,
  type TEXT,
  ref TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bets (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  round_id TEXT,
  bet_type TEXT,
  choice TEXT,
  stake NUMERIC,
  status TEXT DEFAULT 'placed',
  created_at TIMESTAMP DEFAULT now()
);
