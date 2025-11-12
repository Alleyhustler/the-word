// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;
const DBFILE = path.join(__dirname,'db.json');

// load or init db
let db = { clicks: {}, logs: [], totalClicks: 0 };
if(fs.existsSync(DBFILE)){
  try { db = JSON.parse(fs.readFileSync(DBFILE,'utf8')) } catch(e){ console.warn('db read err',e) }
}

function saveDB(){ fs.writeFileSync(DBFILE, JSON.stringify(db,null,2)) }

// simple rate limiter to avoid flood
const limiter = rateLimit({
  windowMs: 10 * 1000, // 10s
  max: 10,
  message: 'Too many requests'
});
app.use(limiter);

// helper: fingerprint-ish dedupe by ip+ua (basic)
function fingerprint(req){
  return require('crypto').createHash('sha256')
    .update((req.ip||'') + '|' + (req.headers['user-agent']||''))
    .digest('hex').slice(0,12);
}

// redirect route that logs a click
app.get('/r/:ref', (req,res) => {
  const { ref } = req.params;
  // simple bot filter: ignore likely bots (headless UAs)
  const ua = req.headers['user-agent'] || '';
  if(/facebookexternalhit|Twitterbot|Discordbot|bot|crawler|spider/i.test(ua)){
    // non-human, just redirect quietly
    return res.redirect('/?utm_source=bot');
  }

  const fp = fingerprint(req);
  // dedupe: don't count duplicate click from same fingerprint within 24h
  const now = Date.now();
  const recent = db.logs.find(l => l.ref===ref && l.fp===fp && (now - l.ts) < (24*3600*1000));
  if(!recent){
    db.clicks[ref] = (db.clicks[ref]||0) + 1;
    db.totalClicks = (db.totalClicks||0) + 1;
    db.logs.push({ ref, ts: now, ip: req.ip, ua, fp });
    // basic pruning to keep logs short
    if(db.logs.length > 5000) db.logs.splice(0, db.logs.length - 4000);
    saveDB();
  }
  // redirect users to main site entry (or a special landing)
  return res.redirect('/');
});

// API: get score for a ref
app.get('/api/score/:ref', (req,res) => {
  const ref = req.params.ref;
  const clicks = db.clicks[ref] || 0;
  res.json({ ref, clicks, total: db.totalClicks || 0 });
});

// API: leaderboard
app.get('/api/leaderboard', (req,res) => {
  const arr = Object.keys(db.clicks).map(ref => ({ ref, clicks: db.clicks[ref] }));
  arr.sort((a,b)=>b.clicks - a.clicks);
  res.json(arr);
});

app.listen(PORT, ()=>console.log('listening', PORT));
