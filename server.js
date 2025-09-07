// server.js — Real Money Game backend starter

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { Pool } = require('pg');
const { createClient } = require('redis');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// Postgres setup
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Optional Redis
let redisClient = null;
(async () => {
  if (process.env.REDIS_URL && process.env.REDIS_URL !== '...') {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.error('Redis error', err));
    await redisClient.connect();
    console.log('Redis connected');
  }
})().catch(console.error);

// Optional Firebase Admin
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
  console.log('Firebase admin initialized');
}

// Helper: Postgres query
async function query(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); } 
  finally { client.release(); }
}

// JWT helper
function signJwt(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// Ensure user & wallet row
async function ensureUserRow(userId, phone = null) {
  const r = await query('SELECT id FROM users WHERE id=$1', [userId]);
  if (r.rowCount === 0) {
    await query('INSERT INTO users(id, phone, email, kyc_status) VALUES($1,$2,$3,$4)', [userId, phone, null, 'pending']);
    await query('INSERT INTO wallets(user_id, balance) VALUES($1, $2)', [userId, 0]);
  }
}

// Transaction wrapper
async function runTransaction(cb) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

// Auth middleware (Firebase ID token OR JWT)
async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No authorization header' });
  const token = auth.replace('Bearer ', '').trim();

  if (admin.apps.length) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { id: decoded.uid, phone: decoded.phone_number || decoded.email || decoded.uid, authType: 'firebase' };
      return next();
    } catch { /* fallback to JWT */ }
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, phone: decoded.phone, authType: 'jwt' };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* ====== Routes ====== */

// Healthcheck
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Register (demo)
app.post('/api/register', async (req, res) => {
  try {
    const { id, phone, email } = req.body;
    const userId = id || uuidv4();
    await ensureUserRow(userId, phone || null);
    const token = signJwt({ id: userId, phone: phone || null });
    return res.json({ success: true, token, user: { id: userId, phone, email } });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'register failed' }); }
});

// Login (demo)
app.post('/api/login', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Provide id for demo login' });
    await ensureUserRow(id, null);
    const token = signJwt({ id });
    return res.json({ success: true, token });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'login failed' }); }
});

// Wallet balance
app.get('/api/wallet', authMiddleware, async (req, res) => {
  try {
    await ensureUserRow(req.user.id, req.user.phone);
    const r = await query('SELECT balance FROM wallets WHERE user_id=$1', [req.user.id]);
    const balance = (r.rows[0] && r.rows[0].balance) ? Number(r.rows[0].balance) : 0;
    return res.json({ balance });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'wallet error' }); }
});

// Transactions
app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const r = await query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    return res.json({ transactions: r.rows });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'transactions error' }); }
});

// Place a bet
app.post('/api/bet', authMiddleware, async (req, res) => {
  const { betType, choice, stake, roundId } = req.body;
  if (!betType || !choice || !stake || stake <= 0) return res.status(400).json({ error: 'invalid bet' });

  try {
    await ensureUserRow(req.user.id, req.user.phone);

    await runTransaction(async (client) => {
      const rbal = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [req.user.id]);
      const balance = Number(rbal.rows[0].balance || 0);
      if (balance < stake) throw { status: 400, message: 'insufficient balance' };

      await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id=$2', [stake, req.user.id]);
      await client.query('INSERT INTO transactions(user_id, amount, type, ref, metadata) VALUES($1,$2,$3,$4,$5)', [
        req.user.id, -stake, 'bet', roundId || null, JSON.stringify({ betType, choice })
      ]);
      await client.query('INSERT INTO bets(user_id, round_id, bet_type, choice, stake, status) VALUES($1,$2,$3,$4,$5,$6)', [
        req.user.id, roundId || null, betType, choice, stake, 'placed'
      ]);
    });

    const newBalR = await query('SELECT balance FROM wallets WHERE user_id=$1', [req.user.id]);
    return res.json({ success: true, newBalance: Number(newBalR.rows[0].balance) });
  } catch (err) {
    console.error(err);
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'bet failed' });
  }
});

// Create order (Cashfree)
app.post('/api/create-order', authMiddleware, async (req, res) => {
  const { amount, currency = 'INR' } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const cfAppId = process.env.CASHFREE_APP_ID;
    const cfSecret = process.env.CASHFREE_SECRET_KEY;
    const envBase = process.env.CASHFREE_ENV === 'PROD' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';

    const orderId = `order_${Date.now()}_${req.user.id}`;
    const payload = {
      order_id: orderId,
      order_amount: String(amount),
      order_currency: currency,
      customer_details: {
        customer_id: req.user.id,
        customer_phone: req.user.phone || '',
        customer_email: (req.user.email || '') || `${req.user.id}@no-email.local`
      }
    };

    const r = await axios.post(`${envBase}/api/v2/cftoken/order`, payload, {
      headers: { 'x-client-id': cfAppId, 'x-client-secret': cfSecret, 'Content-Type': 'application/json' }
    });

    await query('INSERT INTO transactions(user_id, amount, type, ref, metadata) VALUES($1,$2,$3,$4,$5)', [
      req.user.id, amount, 'deposit_pending', orderId, JSON.stringify({ cashfree_response: r.data })
    ]);

    return res.json({ success: true, orderId, cf: r.data });
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'create-order failed' });
  }
});

// Payment webhook
app.post('/api/payment-webhook', async (req, res) => {
  try {
    const body = req.body;
    const { order_id, order_amount, order_status, reference_id, customer_details } = body;
    const userId = (customer_details && customer_details.customer_id) ? customer_details.customer_id : null;
    if (!userId) return res.json({ ok: false });

    if (order_status === 'PAID' || order_status === 'SUCCESS') {
      await runTransaction(async (client) => {
        await client.query('UPDATE wallets SET balance = balance + $1 WHERE user_id=$2', [Number(order_amount), userId]);
        await client.query('INSERT INTO transactions(user_id, amount, type, ref, metadata) VALUES($1,$2,$3,$4,$5)', [
          userId, Number(order_amount), 'deposit', order_id, JSON.stringify({ reference_id })
        ]);
      });
    }
    return res.json({ ok: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'webhook error' }); }
});

// Withdraw
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const { amount, beneficiary_name, account_number, ifsc } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'invalid amount' });

  try {
    await ensureUserRow(req.user.id, req.user.phone);
    const rbal = await query('SELECT balance FROM wallets WHERE user_id=$1', [req.user.id]);
    const bal = Number(rbal.rows[0].balance || 0);
    if (bal < amount) return res.status(400).json({ error: 'insufficient balance' });

    await runTransaction(async (client) => {
      await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id=$2', [amount, req.user.id]);
      const txRef = `payout_${Date.now()}_${req.user.id}`;
      await client.query('INSERT INTO transactions(user_id, amount, type, ref, metadata) VALUES($1,$2,$3,$4,$5)', [
        req.user.id, -amount, 'withdraw_pending', txRef, JSON.stringify({ beneficiary_name, account_number, ifsc })
      ]);
    });

    return res.json({ success: true, message: 'Withdraw requested (pending)', newBalance: bal - amount });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'withdraw failed' }); }
});

// Admin credit (dev only)
app.post('/api/admin/credit', async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: 'invalid' });
  try {
    await ensureUserRow(userId, null);
    await query('UPDATE wallets SET balance = balance + $1 WHERE user_id=$2', [Number(amount), userId]);
    await query('INSERT INTO transactions(user_id, amount, type, ref, metadata) VALUES($1,$2,$3,$4,$5)', [userId, Number(amount), 'admin_credit', null, JSON.stringify({})]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'admin credit failed' }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
