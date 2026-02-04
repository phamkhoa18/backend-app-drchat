const express = require('express');
const https = require('https');

const router = express.Router();

// Simple in-memory cache to reduce Xirsys calls
let cache = {
  expiresAt: 0,
  iceServers: null,
};

const getFallbackIceServers = () => [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const xirsysPut = (url, auth, body, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const req = https.request(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });

    req.write(payload);
    req.end();
  });

router.get('/ice', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.iceServers && cache.expiresAt > now) {
      return res.json({ ok: true, source: 'cache', iceServers: cache.iceServers });
    }

    const ident = process.env.XIRSYS_IDENT;
    const secret = process.env.XIRSYS_SECRET;
    const channel = process.env.XIRSYS_CHANNEL;

    if (!ident || !secret || !channel) {
      return res.json({ ok: true, source: 'fallback_env_missing', iceServers: getFallbackIceServers() });
    }

    const auth = Buffer.from(`${ident}:${secret}`).toString('base64');
    const url = `https://global.xirsys.net/_turn/${encodeURIComponent(channel)}`;
    let result;
    try {
      result = await xirsysPut(url, auth, { format: 'urls' }, 5000);
    } catch (err) {
      const code = err?.code || (err?.message === 'timeout' ? 'TIMEOUT' : 'ERROR');
      // Keep response safe (no secrets), but include a small hint for server debugging.
      return res.json({
        ok: true,
        source: `fallback_xirsys_error_${String(code)}`,
        iceServers: getFallbackIceServers(),
      });
    }
    if (result.status < 200 || result.status >= 300) {
      return res.json({
        ok: true,
        source: `fallback_xirsys_http_${result.status || 0}`,
        iceServers: getFallbackIceServers(),
      });
    }

    const iceServers = result?.json?.v?.iceServers;

    if (Array.isArray(iceServers) && iceServers.length > 0) {
      // Cache for 5 minutes (Xirsys creds are dynamic; keep cache short)
      cache = {
        expiresAt: Date.now() + 5 * 60 * 1000,
        iceServers,
      };
      return res.json({ ok: true, source: 'xirsys', iceServers });
    }

    return res.json({ ok: true, source: 'fallback_empty', iceServers: getFallbackIceServers() });
  } catch (e) {
    const code = e?.code || 'ERROR';
    return res.json({ ok: true, source: `fallback_error_${String(code)}`, iceServers: getFallbackIceServers() });
  }
});

module.exports = router;

