// api.js - frontend helper
const API_BASE = 'http://localhost:4000'; // **CHANGE** to your server URL (or use relative path)

async function apiFetch(path, method='GET', body=null, token=null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const j = await res.json().catch(()=>({}));
  if (!res.ok) throw j;
  return j;
}

async function registerDemo(id, phone) {
  return apiFetch('/api/register', 'POST', { id, phone });
}
async function loginDemo(id) {
  return apiFetch('/api/login', 'POST', { id });
}
async function getWallet(token) {
  return apiFetch('/api/wallet', 'GET', null, token);
}
async function createOrder(token, amount) {
  return apiFetch('/api/create-order', 'POST', { amount }, token);
}
async function withdrawRequest(token, amount, beneficiary_name, account_number, ifsc) {
  return apiFetch('/api/withdraw', 'POST', { amount, beneficiary_name, account_number, ifsc }, token);
}
async function placeBet(token, betType, choice, stake, roundId=null) {
  return apiFetch('/api/bet', 'POST', { betType, choice, stake, roundId }, token);
}
async function getTransactions(token) {
  return apiFetch('/api/transactions', 'GET', null, token);
}
