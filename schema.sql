CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT,
  email TEXT,
  kyc_status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance NUMERIC DEFAULT 0
);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  amount NUMERIC,
  type TEXT,
  ref TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);
