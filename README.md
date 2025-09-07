# Real Money Game — Starter

## Structure
- backend/ : Node.js + Express backend
- frontend/ : HTML + JS client (demo)

## Quick start
1. Backend:
   - `cd real-money-game/backend`
   - `npm install`
   - Copy `.env.example` → `.env` and fill values.
   - Setup Postgres and run `schema.sql`:
     ```
     psql -U <dbuser> -d <dbname> -f schema.sql
     ```
   - Run server:
     ```
     npm run dev
     ```

2. Frontend:
   - Open `real-money-game/frontend/index.html` in browser.
   - Edit `frontend/api.js` → `API_BASE` to point to your server (e.g., `http://localhost:4000`).

## Notes
- Use Cashfree Sandbox first; add real keys only after testing.
- Validate Cashfree webhook signatures in production.
- This starter is for development/testing. For production add security, KYC flows, legal compliance.
