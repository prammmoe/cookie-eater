import express from 'express';
import 'dotenv/config';
import { loginToWeb } from './loginToWeb'; // move your logic to this file

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.ENVIRONMENT || 'PRODUCTION';

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/login-to-web', async (req, res) => {
  try {
    const  myCookies = await loginToWeb();
    res.status(200).json(myCookies);
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Web login failed', details: String(err) });
  }
});

console.log(`Running in directory: ${process.cwd()}`);
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
