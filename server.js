// minimal server with auth (firebase token verification), wallet endpoints, cashfree integration
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin SDK (for verifying phone auth tokens)
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // replace escaped newlines for private key
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;

// Mock DB functions (replace with real DB queries)
const db = {
  users: new Map(), // userId -> userObject
  wallets: new Map(), // userId -> {balance}
};

function ensureUser(userId, phone) {
  if (!db.users.has(userId)) {
    db.users.set(userId, { id: userId, phone });
    db.wallets.set(userId, { balance: 0 });
  }
}

// Middleware: verify Firebase ID token
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No auth token' });
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, phone: decoded.phone_number };
    ensureUser(req.user.uid, req.user.phone);
    next();
  } catch (err) {
    console.error('auth error', err);
    res.status(401).json({ error: 'Invalid auth token' });
  }
}

// Create Cashfree order (Add money) — Server creates order and returns orderToken or payment link to client
app.post('/api/create-order', authMiddleware, async (req, res) => {
  const { amount, currency='INR' } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    // Cashfree: create order API (example endpoint - check Cashfree docs for exact URL for your env)
    const cfAppId = process.env.CASHFREE_APP_ID;
    const cfSecret = process.env.CASHFREE_SECRET_KEY;
    const env = process.env.CASHFREE_ENV === 'PROD' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';

    const orderPayload = {
      customer_details: {
        customer_id: req.user.uid,
        customer_email: req.user.uid + '@no-email.local',
        customer_phone: req.user.phone
      },
      order_amount: amount,
      order_currency: currency,
      order_id: `order_${Date.now()}_${req.user.uid}`
    };

    const r = await axios.post(`${env}/api/v2/cftoken/order`, orderPayload, {
      headers: {
        'x-client-id': cfAppId,
        'x-client-secret': cfSecret,
        'Content-Type': 'application/json'
      }
    });

    // r.data will contain token / payment link depending on API
    return res.json({ success: true, cf_response: r.data });
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'Cashfree error', detail: err.response ? err.response.data : err.message });
  }
});

// Webhook / verify-payment (Cashfree will call your webhook after payment)
app.post('/api/payment-webhook', async (req, res) => {
  // Validate signature per Cashfree docs
  // Then update user's wallet
  try {
    const { order_id, order_amount, reference_id, order_status, customer_details } = req.body;
    // For demo: find user by customer_id
    const uid = customer_details.customer_id;
    if (order_status === 'PAID') {
      const wallet = db.wallets.get(uid) || { balance: 0 };
      wallet.balance = (wallet.balance || 0) + Number(order_amount);
      db.wallets.set(uid, wallet);
      // create transaction record in real DB
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'webhook error' });
  }
});

// Get wallet balance
app.get('/api/wallet', authMiddleware, (req, res) => {
  const wallet = db.wallets.get(req.user.uid) || { balance: 0 };
  res.json({ balance: wallet.balance });
});

// Withdraw (payout) — user provides bank details (account, ifsc)
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const { amount, beneficiary_name, account_number, ifsc } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const wallet = db.wallets.get(req.user.uid) || { balance: 0 };
  if (wallet.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  try {
    // Call Cashfree Payouts API: add beneficiary (if not added) and then transfer
    const payoutEnv = process.env.CASHFREE_ENV === 'PROD' ? 'https://payout-api.cashfree.com' : 'https://sandbox.payout-api.cashfree.com';
    // Example: create beneficiary
    const beneficiaryPayload = {
      beneId: `bene_${req.user.uid}_${Date.now()}`,
      name: beneficiary_name,
      email: req.user.uid + '@no-email.local',
      contact: req.user.phone,
      bankAccount: account_number,
      ifsc: ifsc,
      address1: '',
      city: '',
      state: '',
      pincode: ''
    };

    const tokenResp = await axios.post(`${payoutEnv}/payout/v1/authorize`, {
      // Cashfree payout auth flow depends on account type — check docs for exact method
    });

    // NOTE: Payout flows and endpoints may change — refer to Cashfree docs.

    // For demo, we just debit wallet and return a mock transfer
    wallet.balance -= amount;
    db.wallets.set(req.user.uid, wallet);

    // create transaction record
    return res.json({ success: true, transferred: amount, tx_ref: `tx_${Date.now()}` });
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'Payout error', detail: err.response ? err.response.data : err.message });
  }
});

app.listen(PORT, () => console.log('Server running on', PORT));
