// Clears the admin session cookie. No password or Apps Script call
// needed - the cookie is the only thing that proves a session, so
// expiring it client-side (via Set-Cookie with Max-Age=0) is enough.

const { clearSessionCookie } = require('./_lib/adminSession');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(200).json({ ok: true });
};
