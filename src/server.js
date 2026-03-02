require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validUrl = require('valid-url');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH || './linksnap.db';

// ── Base de données ──────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    code      TEXT    UNIQUE NOT NULL,
    url       TEXT    NOT NULL,
    clicks    INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_click DATETIME
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    referer    TEXT,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
  CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks(code);
`);

// ── Middleware ───────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting : 30 créations / 15 min par IP
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' }
});

// ── Helpers ──────────────────────────────────────────────────────
function isValidCode(code) {
  return /^[a-zA-Z0-9\-_]{3,30}$/.test(code);
}

// ── API Routes ───────────────────────────────────────────────────

// POST /api/links — Créer un lien court
app.post('/api/links', createLimiter, (req, res) => {
  const { url, alias } = req.body;

  if (!url) return res.status(400).json({ error: 'URL requise.' });
  if (!validUrl.isUri(url)) return res.status(400).json({ error: 'URL invalide.' });

  let code = alias ? alias.trim() : nanoid(6);

  if (alias) {
    if (!isValidCode(alias)) {
      return res.status(400).json({ error: 'Alias invalide (3-30 caractères, lettres/chiffres/-_).' });
    }
    const existing = db.prepare('SELECT code FROM links WHERE code = ?').get(alias);
    if (existing) return res.status(409).json({ error: `L'alias "${alias}" est déjà pris.` });
  }

  // Déduplique les URLs sans alias
  if (!alias) {
    const dup = db.prepare('SELECT code FROM links WHERE url = ?').get(url);
    if (dup) {
      const link = db.prepare('SELECT * FROM links WHERE code = ?').get(dup.code);
      return res.json({ ...link, short_url: `${BASE_URL}/${link.code}` });
    }
  }

  const stmt = db.prepare('INSERT INTO links (code, url) VALUES (?, ?)');
  try {
    stmt.run(code, url);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Code déjà utilisé.' });
    throw e;
  }

  const link = db.prepare('SELECT * FROM links WHERE code = ?').get(code);
  res.status(201).json({ ...link, short_url: `${BASE_URL}/${link.code}` });
});

// GET /api/links — Lister tous les liens (paginé)
app.get('/api/links', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  const where = search ? `WHERE code LIKE ? OR url LIKE ?` : '';
  const params = search ? [`%${search}%`, `%${search}%`] : [];

  const total = db.prepare(`SELECT COUNT(*) as n FROM links ${where}`).get(...params).n;
  const rows  = db.prepare(`SELECT * FROM links ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
                   .all(...params, limit, offset);

  const links = rows.map(r => ({ ...r, short_url: `${BASE_URL}/${r.code}` }));
  res.json({ links, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/links/:code — Détail + analytics d'un lien
app.get('/api/links/:code', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE code = ?').get(req.params.code);
  if (!link) return res.status(404).json({ error: 'Lien introuvable.' });

  const recentClicks = db.prepare(
    'SELECT clicked_at, referer FROM clicks WHERE code = ? ORDER BY clicked_at DESC LIMIT 20'
  ).all(req.params.code);

  res.json({ ...link, short_url: `${BASE_URL}/${link.code}`, recent_clicks: recentClicks });
});

// DELETE /api/links/:code — Supprimer un lien
app.delete('/api/links/:code', (req, res) => {
  const result = db.prepare('DELETE FROM links WHERE code = ?').run(req.params.code);
  if (result.changes === 0) return res.status(404).json({ error: 'Lien introuvable.' });
  db.prepare('DELETE FROM clicks WHERE code = ?').run(req.params.code);
  res.json({ success: true });
});

// GET /api/stats — Statistiques globales
app.get('/api/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_links,
      SUM(clicks) as total_clicks,
      MAX(clicks) as max_clicks,
      (SELECT code FROM links ORDER BY clicks DESC LIMIT 1) as top_link
    FROM links
  `).get();
  res.json(stats);
});

// ── Redirection ──────────────────────────────────────────────────
app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (code === 'api') return res.status(404).json({ error: 'Not found' });

  const link = db.prepare('SELECT * FROM links WHERE code = ?').get(code);
  if (!link) return res.status(404).sendFile(path.join(__dirname, '../public/404.html'), () => {
    res.status(404).send('<h1>Lien introuvable</h1>');
  });

  // Enregistrer le clic
  db.prepare('UPDATE links SET clicks = clicks + 1, last_click = CURRENT_TIMESTAMP WHERE code = ?').run(code);
  db.prepare('INSERT INTO clicks (code, ip, user_agent, referer) VALUES (?, ?, ?, ?)').run(
    code,
    req.ip,
    req.headers['user-agent'] || null,
    req.headers['referer'] || null
  );

  res.redirect(301, link.url);
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ⚡ LinkSnap démarré !
  ┌─────────────────────────────────────┐
  │  App    → http://localhost:${PORT}      │
  │  API    → http://localhost:${PORT}/api  │
  │  Base   → ${DB_PATH}               │
  └─────────────────────────────────────┘
  `);
});
