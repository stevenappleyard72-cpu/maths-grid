const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4173;
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_FILE = path.join(__dirname, 'scores.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([
      { name: 'Ari', score: 120, streak: 4, mode: 'normal', dailyKey: '2025-01-01' },
      { name: 'Jules', score: 95, streak: 3, mode: 'streak', dailyKey: '2025-01-01' },
      { name: 'Mina', score: 75, streak: 2, mode: 'daily', dailyKey: '2025-01-01' }
    ], null, 2));
  }
}

function readScores() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeScores(entries) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
}

function sortEntries(entries) {
  return entries
    .slice()
    .sort((a, b) => {
      const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const streakDiff = Number(b.streak || 0) - Number(a.streak || 0);
      if (streakDiff !== 0) return streakDiff;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'MathsGrid service online' });
});

app.get('/api/leaderboard', (req, res) => {
  const modeFilter = String(req.query.mode || '').trim();
  const dailyFilter = String(req.query.dailyKey || '').trim();

  let entries = readScores();
  if (modeFilter) {
    entries = entries.filter((entry) => String(entry.mode || 'normal') === modeFilter);
  }
  if (dailyFilter) {
    entries = entries.filter((entry) => String(entry.dailyKey || '') === dailyFilter);
  }

  const sorted = sortEntries(entries).slice(0, 10);
  res.json({ entries: sorted });
});

app.post('/api/score', (req, res) => {
  const payload = req.body || {};
  const trimmedName = String(payload.name || 'Player').trim().slice(0, 18) || 'Player';
  const score = Number(payload.score || 0);
  const streak = Number(payload.streak || 0);
  const mode = String(payload.mode || 'normal');
  const dailyKey = String(payload.dailyKey || '').slice(0, 10);

  if (!Number.isFinite(score) || score <= 0) {
    return res.status(400).json({ error: 'Score must be a positive number.' });
  }

  const entries = readScores();
  const nextEntry = {
    name: trimmedName,
    score,
    streak,
    mode,
    dailyKey,
  };

  entries.push(nextEntry);
  const sorted = sortEntries(entries).slice(0, 15);
  writeScores(sorted);
  return res.json({ ok: true, entries: sorted });
});

app.use(express.static(DIST_DIR));

app.get('*', (req, res) => {
  const filePath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  return res.send(`
    <html>
      <body>
        <h1>MathsGrid</h1>
        <p>Build the app with npm run build before starting the server.</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`MathsGrid server listening on http://localhost:${PORT}`);
});
