const router = require('express').Router();
const Post   = require('../models/Post');
const User   = require('../models/User');

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} · Abyss</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#020509;color:#e8f4f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
    a{color:inherit;text-decoration:none}
    .bar{background:rgba(0,229,204,0.05);border-bottom:1px solid rgba(255,255,255,0.08);padding:14px 20px;display:flex;align-items:center;gap:10}
    .logo{color:#00e5cc;font-weight:900;font-size:17px;letter-spacing:3px}
    .logo-dot{width:7px;height:7px;border-radius:50%;background:#00e5cc;flex-shrink:0}
    .wrap{max-width:600px;margin:28px auto;padding:0 16px}
    .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden}
    .p16{padding:16px 20px}
    .p20{padding:20px}
    .row{display:flex;align-items:center;gap:12}
    .av{width:44px;height:44px;border-radius:22px;background:rgba(0,229,204,0.12);border:1px solid rgba(0,229,204,0.25);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:18px;font-weight:800;color:#00e5cc}
    .av img{width:100%;height:100%;object-fit:cover}
    .av-lg{width:72px;height:72px;border-radius:36px;font-size:28px}
    .uname{color:#e8f4f3;font-weight:700;font-size:14px}
    .dim{color:rgba(255,255,255,0.4);font-size:11px;margin-top:2px}
    .text{color:#e8f4f3;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word;margin-top:14px}
    .post-img{width:100%;max-height:440px;object-fit:cover;display:block;border-radius:10px;margin-top:12px}
    .divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0}
    .stats{display:flex;gap:20px;color:rgba(255,255,255,0.45);font-size:13px}
    .xp{color:#00e5cc;font-size:12px;font-weight:700}
    .stats-grid{display:flex;justify-content:space-around;padding:16px 0}
    .stat-val{color:#e8f4f3;font-size:20px;font-weight:800;display:block;text-align:center}
    .stat-lbl{color:rgba(255,255,255,0.35);font-size:11px;display:block;text-align:center;margin-top:3px}
    .post-row{display:block;padding:14px 20px;border-top:1px solid rgba(255,255,255,0.06)}
    .post-row:hover{background:rgba(255,255,255,0.02)}
    .post-preview{color:rgba(255,255,255,0.75);font-size:13px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .thumb{width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:6px;display:block}
    .btn-wrap{text-align:center;margin:24px 0}
    .btn{display:inline-block;padding:12px 32px;background:linear-gradient(90deg,#006b63,#00e5cc);color:#001a18;font-weight:800;font-size:14px;border-radius:12px}
    .not-found{text-align:center;padding:80px 20px;color:rgba(255,255,255,0.35);font-size:15px}
    .profile-head{text-align:center;padding:24px 20px 0}
    .bio{color:rgba(255,255,255,0.6);font-size:13px;line-height:1.5;margin-top:8px;padding:0 20px 16px;text-align:center}
  </style>
</head>
<body>
  <div class="bar">
    <div class="logo-dot"></div>
    <span class="logo">ABYSS</span>
  </div>
  <div class="wrap">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// ── GET /post/:id ─────────────────────────────────────────────────────────────
router.get('/post/:id', async (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'unsafe-inline'; img-src * data:; script-src 'none'; font-src 'self'");
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username avatarUrl xp')
      .populate('comments.user', 'username avatarUrl')
      .lean();

    if (!post) {
      return res.send(page('Post no encontrado',
        `<div class="not-found">Este post no existe o fue eliminado.</div>`));
    }

    const a = post.author || {};
    const avatarHtml = a.avatarUrl
      ? `<img src="${esc(a.avatarUrl)}" alt="${esc(a.username)}"/>`
      : (a.username?.[0] || '?').toUpperCase();

    const date = new Date(post.createdAt).toLocaleDateString('es-MX',
      { year: 'numeric', month: 'long', day: 'numeric' });

    const likes    = (post.reactions || []).filter(r => r.type === 'like').length;
    const comments = (post.comments || []).length;

    const imgHtml = post.imageUrl
      ? `<img class="post-img" src="${esc(post.imageUrl)}" alt=""/>`
      : '';

    const body = `
      <div class="card">
        <div class="p16">
          <div class="row">
            <div class="av">${avatarHtml}</div>
            <div>
              <div class="uname">${esc(a.username || 'Usuario')}</div>
              <div class="dim">${date}</div>
            </div>
          </div>
          ${post.text ? `<p class="text">${esc(post.text)}</p>` : ''}
          ${imgHtml}
        </div>
        <hr class="divider"/>
        <div class="p16">
          <div class="stats">
            <span>❤️ ${likes} reacciones</span>
            <span>💬 ${comments} comentarios</span>
          </div>
        </div>
      </div>
      <div class="btn-wrap">
        <a class="btn" href="abyss://post/${post._id}">Abrir en Abyss</a>
      </div>`;

    res.send(page(`Post de ${a.username || 'Abyss'}`, body));
  } catch {
    res.status(500).send(page('Error', `<div class="not-found">Error al cargar el post.</div>`));
  }
});

// ── GET /user/:username ───────────────────────────────────────────────────────
router.get('/user/:username', async (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'unsafe-inline'; img-src * data:; script-src 'none'; font-src 'self'");
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-passwordHash -blocked')
      .lean();

    if (!user) {
      return res.send(page('Usuario no encontrado',
        `<div class="not-found">Este usuario no existe.</div>`));
    }

    const avatarHtml = user.avatarUrl
      ? `<img src="${esc(user.avatarUrl)}" alt="${esc(user.username)}"/>`
      : (user.username?.[0] || '?').toUpperCase();

    const posts = await Post.find({ author: user._id })
      .sort({ createdAt: -1 })
      .limit(6)
      .select('text imageUrl createdAt reactions comments')
      .lean();

    const postsHtml = posts.map(p => {
      const likes   = (p.reactions || []).filter(r => r.type === 'like').length;
      const preview = (p.text || '').slice(0, 140) + (p.text?.length > 140 ? '…' : '');
      const thumb   = p.imageUrl
        ? `<img class="thumb" src="${esc(p.imageUrl)}" alt=""/>`
        : '';
      return `<a class="post-row" href="/post/${p._id}">
        ${thumb}
        ${preview ? `<p class="post-preview">${esc(preview)}</p>` : ''}
        <p class="dim" style="margin-top:6px">❤️ ${likes} · 💬 ${(p.comments || []).length}</p>
      </a>`;
    }).join('');

    const bioHtml = user.bio
      ? `<p class="bio">${esc(user.bio)}</p>`
      : '';

    const body = `
      <div class="card">
        <div class="profile-head">
          <div class="av av-lg" style="margin:0 auto 12px">${avatarHtml}</div>
          <div class="uname" style="font-size:17px">${esc(user.username)}</div>
          ${user.displayName ? `<div class="dim" style="margin-top:3px">${esc(user.displayName)}</div>` : ''}
          <div class="xp" style="margin-top:8px">XP ${user.xp || 0}</div>
        </div>
        ${bioHtml}
        <div class="stats-grid">
          <div><span class="stat-val">${(user.followers || []).length}</span><span class="stat-lbl">seguidores</span></div>
          <div><span class="stat-val">${(user.following || []).length}</span><span class="stat-lbl">siguiendo</span></div>
          <div><span class="stat-val">${posts.length}</span><span class="stat-lbl">posts</span></div>
        </div>
        ${postsHtml ? `<hr class="divider"/>${postsHtml}` : ''}
      </div>
      <div class="btn-wrap">
        <a class="btn" href="abyss://user/${esc(user.username)}">Abrir en Abyss</a>
      </div>`;

    res.send(page(user.username, body));
  } catch {
    res.status(500).send(page('Error', `<div class="not-found">Error al cargar el perfil.</div>`));
  }
});

// ── Helpers compartidos para paneles mod ──────────────────────────────────────
async function verifyAdmin(token) {
  if (!token) return null;
  const jwt = require('jsonwebtoken');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const u = await User.findById(decoded.id).select('role username').lean();
    return u?.role === 'admin' ? u : null;
  } catch { return null; }
}

function modNavBar(token, active) {
  const links = [
    { href: `/mod/bugs?token=${encodeURIComponent(token)}`,     label: 'Bugs' },
    { href: `/mod/reports?token=${encodeURIComponent(token)}`,  label: 'Reportes' },
  ];
  return `<div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">
    ${links.map(l => `<a href="${l.href}" style="padding:7px 20px;border-radius:20px;border:1px solid ${active===l.label?'#00e5cc':'rgba(255,255,255,0.12)'};color:${active===l.label?'#00e5cc':'rgba(255,255,255,0.5)'};font-size:13px;font-weight:600;text-decoration:none">${l.label}</a>`).join('')}
  </div>`;
}

function fmtDate(d) {
  const dt = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function pagerLinks(base, page, hasMore) {
  const prev = page > 1 ? `<a href="${base}&page=${page-1}" style="padding:6px 18px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);font-size:13px;text-decoration:none">← Anterior</a>` : '';
  const next = hasMore   ? `<a href="${base}&page=${page+1}" style="padding:6px 18px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);font-size:13px;text-decoration:none">Siguiente →</a>` : '';
  if (!prev && !next) return '';
  return `<div style="display:flex;gap:10px;justify-content:center;margin-top:24px">${prev}${next}</div>`;
}

// ── GET /mod/bugs ─────────────────────────────────────────────────────────────
router.get('/mod/bugs', async (req, res) => {
  const BugReport = require('../models/BugReport');
  const { token, status: filterStatus, page: pageQ } = req.query;

  if (!token) return res.status(401).send('<p style="color:#fff;font-family:sans-serif;padding:24px">Token requerido.</p>');
  const adminUser = await verifyAdmin(token);
  if (!adminUser) return res.status(403).send('<p style="color:#fff;font-family:sans-serif;padding:24px">Acceso denegado.</p>');

  try {
    const PAGE = 20;
    const pg   = Math.max(1, parseInt(pageQ) || 1);
    const filter = filterStatus ? { status: filterStatus } : {};
    const [bugs, total] = await Promise.all([
      BugReport.find(filter).sort({ createdAt: -1 }).skip((pg-1)*PAGE).limit(PAGE)
        .populate('user', 'username avatarUrl').lean(),
      BugReport.countDocuments(filter),
    ]);

    const STATUS_LABEL = { new: 'Nuevo', reviewing: 'Revisando', resolved: 'Resuelto' };
    const STATUS_COLOR = { new: '#ef4444', reviewing: '#f59e0b', resolved: '#00e5cc' };

    const rows = bugs.map(b => {
      const avatar = b.user?.avatarUrl
        ? `<img src="${esc(b.user.avatarUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0"/>`
        : `<div style="width:36px;height:36px;border-radius:50%;background:rgba(0,229,204,0.12);display:flex;align-items:center;justify-content:center;color:#00e5cc;font-weight:700;font-size:14px;flex-shrink:0">${esc((b.username || b.user?.username || '?')[0].toUpperCase())}</div>`;
      const sc = STATUS_COLOR[b.status] || '#fff';
      const sl = STATUS_LABEL[b.status] || b.status;
      const nextMap = { new: 'reviewing', reviewing: 'resolved', resolved: 'new' };
      const nextStatus = nextMap[b.status] || 'new';
      const imgTag = b.imageUrl
        ? `<a href="${esc(b.imageUrl)}" target="_blank"><img src="${esc(b.imageUrl)}" style="width:120px;height:80px;border-radius:8px;object-fit:cover;display:block;margin-top:8px;border:1px solid rgba(255,255,255,0.1)"/></a>`
        : '';
      return `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;display:flex;gap:12px;align-items:flex-start">
          ${avatar}
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="color:#e8f4f8;font-weight:700;font-size:14px">${esc(b.username || b.user?.username || 'usuario')}</span>
              <span style="color:rgba(255,255,255,0.3);font-size:11px">${fmtDate(b.createdAt)}</span>
              ${b.screen ? `<span style="font-size:11px;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:6px;color:rgba(255,255,255,0.5)">${esc(b.screen)}</span>` : ''}
              ${b.deviceInfo ? `<span style="font-size:11px;color:rgba(255,255,255,0.25)">${esc(b.deviceInfo)}</span>` : ''}
              <span style="font-size:11px;font-weight:700;color:${sc};background:${sc}22;padding:2px 10px;border-radius:20px">${sl}</span>
            </div>
            <p style="color:#cbd5e1;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${esc(b.description)}</p>
            ${imgTag}
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <button onclick="bugStatus('${b._id}','${nextStatus}')" style="padding:5px 14px;border-radius:8px;border:1px solid ${sc}44;background:${sc}18;color:${sc};font-size:12px;cursor:pointer;font-weight:600">
                Marcar: ${STATUS_LABEL[nextStatus]}
              </button>
              <button onclick="bugDelete('${b._id}')" style="padding:5px 14px;border-radius:8px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.1);color:#ef4444;font-size:12px;cursor:pointer;font-weight:600">
                Eliminar
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    const baseUrl = `/mod/bugs?token=${encodeURIComponent(token)}${filterStatus ? '&status='+filterStatus : ''}`;
    const filterLinks = ['', 'new', 'reviewing', 'resolved'].map(s => {
      const label = s ? (STATUS_LABEL[s] || s) : 'Todos';
      const active = (filterStatus || '') === s;
      return `<a href="/mod/bugs?token=${encodeURIComponent(token)}${s?'&status='+s:''}" style="padding:6px 16px;border-radius:20px;border:1px solid ${active?'#00e5cc':'rgba(255,255,255,0.12)'};color:${active?'#00e5cc':'rgba(255,255,255,0.5)'};font-size:13px;text-decoration:none">${label}</a>`;
    }).join('');

    const body = `
      ${modNavBar(token, 'Bugs')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10">
        <h2 style="color:#e8f4f8;font-size:18px;font-weight:800">Reportes de Bugs <span style="color:rgba(255,255,255,0.35);font-size:13px;font-weight:400">${total} total · pag. ${pg}</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${filterLinks}</div>
      </div>
      ${bugs.length === 0
        ? '<p style="color:rgba(255,255,255,0.35);text-align:center;padding:40px 0">Sin reportes.</p>'
        : `<div style="display:flex;flex-direction:column;gap:10px">${rows}</div>`}
      ${pagerLinks(baseUrl, pg, bugs.length === PAGE)}
      <script>
        const tok = new URLSearchParams(location.search).get('token');
        async function bugStatus(id, status) {
          const r = await fetch('/api/bug-reports/'+id+'/status',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:JSON.stringify({status})});
          if(r.ok) location.reload(); else alert('Error');
        }
        async function bugDelete(id) {
          if(!confirm('Eliminar este reporte?')) return;
          const r = await fetch('/api/bug-reports/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+tok}});
          if(r.ok) location.reload(); else alert('Error');
        }
      </script>`;

    res.send(page('Bugs — Admin', `<div style="max-width:900px;margin:28px auto;padding:0 16px">${body}</div>`));
  } catch (err) {
    res.status(500).send(page('Error', `<div class="not-found">Error: ${esc(err.message)}</div>`));
  }
});

// ── GET /mod/reports ──────────────────────────────────────────────────────────
router.get('/mod/reports', async (req, res) => {
  const Report = require('../models/Report');
  const { token, status: filterStatus, type: filterType, page: pageQ } = req.query;

  if (!token) return res.status(401).send('<p style="color:#fff;font-family:sans-serif;padding:24px">Token requerido.</p>');
  const adminUser = await verifyAdmin(token);
  if (!adminUser) return res.status(403).send('<p style="color:#fff;font-family:sans-serif;padding:24px">Acceso denegado.</p>');

  try {
    const PAGE = 20;
    const pg   = Math.max(1, parseInt(pageQ) || 1);
    const filter = {};
    if (filterStatus && filterStatus !== 'all') filter.status = filterStatus;
    if (filterType   && filterType   !== 'all') filter.type   = filterType;

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip((pg-1)*PAGE).limit(PAGE)
        .populate('reporter',       'username avatarUrl')
        .populate('targetAuthorId', 'username')
        .populate('resolvedBy',     'username')
        .lean(),
      Report.countDocuments(filter),
    ]);

    const STATUS_LABEL = { pending: 'Pendiente', reviewed: 'Revisado', dismissed: 'Descartado' };
    const STATUS_COLOR = { pending: '#ef4444', reviewed: '#00e5cc', dismissed: '#6b7280' };
    const TYPE_LABEL   = { post: 'Post', user: 'Usuario', group: 'Grupo' };
    const TYPE_COLOR   = { post: '#2979ff', user: '#a855f7', group: '#f59e0b' };

    const rows = reports.map(r => {
      const avatar = r.reporter?.avatarUrl
        ? `<img src="${esc(r.reporter.avatarUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0"/>`
        : `<div style="width:36px;height:36px;border-radius:50%;background:rgba(0,229,204,0.12);display:flex;align-items:center;justify-content:center;color:#00e5cc;font-weight:700;font-size:14px;flex-shrink:0">${esc((r.reporter?.username||'?')[0].toUpperCase())}</div>`;

      const sc  = STATUS_COLOR[r.status] || '#fff';
      const sl  = STATUS_LABEL[r.status] || r.status;
      const tc  = TYPE_COLOR[r.type]   || '#fff';
      const tl  = TYPE_LABEL[r.type]   || r.type;

      const evidenceImgs = (r.images||[]).map(img =>
        `<a href="${esc(img.url)}" target="_blank"><img src="${esc(img.url)}" style="width:90px;height:60px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.1)"/></a>`
      ).join('');

      const actionBtns = [];
      if (r.status === 'pending') {
        actionBtns.push(`<button onclick="repAction('${r._id}','reviewed')" style="padding:5px 12px;border-radius:8px;border:1px solid #00e5cc44;background:#00e5cc18;color:#00e5cc;font-size:12px;cursor:pointer;font-weight:600">Revisado</button>`);
        actionBtns.push(`<button onclick="repAction('${r._id}','dismissed')" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(107,114,128,0.4);background:rgba(107,114,128,0.1);color:#9ca3af;font-size:12px;cursor:pointer;font-weight:600">Descartar</button>`);
      }
      if (r.type === 'post') {
        actionBtns.push(`<button onclick="delPost('${r._id}')" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.1);color:#ef4444;font-size:12px;cursor:pointer;font-weight:600">Eliminar post</button>`);
      }
      if (r.type === 'post' || r.type === 'user') {
        actionBtns.push(`<button onclick="banUser('${r._id}')" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.15);color:#fca5a5;font-size:12px;cursor:pointer;font-weight:600">Banear usuario</button>`);
      }
      actionBtns.push(`<button onclick="repDelete('${r._id}')" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;cursor:pointer">Eliminar reporte</button>`);

      return `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;display:flex;gap:12px;align-items:flex-start">
          ${avatar}
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
              <span style="color:#e8f4f8;font-weight:700;font-size:14px">${esc(r.reporter?.username||'?')}</span>
              <span style="font-size:11px;font-weight:700;color:${tc};background:${tc}22;padding:2px 8px;border-radius:6px">${tl}</span>
              <span style="font-size:11px;font-weight:700;color:${sc};background:${sc}22;padding:2px 10px;border-radius:20px">${sl}</span>
              <span style="color:rgba(255,255,255,0.3);font-size:11px">${fmtDate(r.createdAt)}</span>
            </div>
            ${r.targetName ? `<div style="color:rgba(255,255,255,0.55);font-size:12px;margin-bottom:6px">Objetivo: <span style="color:#e8f4f8;font-weight:600">${esc(r.targetName)}</span>${r.targetAuthorId?.username ? ` · autor: <span style="color:#e8f4f8">${esc(r.targetAuthorId.username)}</span>` : ''}</div>` : ''}
            <div style="margin-bottom:6px"><span style="color:#f59e0b;font-weight:600;font-size:12px">${esc(r.reason)}</span></div>
            ${r.details ? `<p style="color:#94a3b8;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin-bottom:8px">${esc(r.details)}</p>` : ''}
            ${evidenceImgs ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${evidenceImgs}</div>` : ''}
            ${r.resolvedBy ? `<div style="color:rgba(255,255,255,0.3);font-size:11px;margin-bottom:8px">Resuelto por @${esc(r.resolvedBy.username)} · ${r.modNotes ? esc(r.modNotes) : ''}</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap">${actionBtns.join('')}</div>
          </div>
        </div>`;
    }).join('');

    const baseUrl = `/mod/reports?token=${encodeURIComponent(token)}${filterStatus?'&status='+filterStatus:''}${filterType?'&type='+filterType:''}`;

    const statusFilters = ['all','pending','reviewed','dismissed'].map(s => {
      const label = s === 'all' ? 'Todos' : (STATUS_LABEL[s]||s);
      const active = (filterStatus||'all') === s;
      return `<a href="/mod/reports?token=${encodeURIComponent(token)}&status=${s}${filterType?'&type='+filterType:''}" style="padding:5px 14px;border-radius:20px;border:1px solid ${active?'#00e5cc':'rgba(255,255,255,0.12)'};color:${active?'#00e5cc':'rgba(255,255,255,0.5)'};font-size:12px;text-decoration:none">${label}</a>`;
    }).join('');

    const typeFilters = ['all','post','user','group'].map(t => {
      const label = t === 'all' ? 'Todos' : (TYPE_LABEL[t]||t);
      const active = (filterType||'all') === t;
      return `<a href="/mod/reports?token=${encodeURIComponent(token)}${filterStatus?'&status='+filterStatus:''}&type=${t}" style="padding:5px 14px;border-radius:20px;border:1px solid ${active?(TYPE_COLOR[t]||'#00e5cc'):'rgba(255,255,255,0.12)'};color:${active?(TYPE_COLOR[t]||'#00e5cc'):'rgba(255,255,255,0.5)'};font-size:12px;text-decoration:none">${label}</a>`;
    }).join('');

    const body = `
      ${modNavBar(token, 'Reportes')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10">
        <h2 style="color:#e8f4f8;font-size:18px;font-weight:800">Reportes <span style="color:rgba(255,255,255,0.35);font-size:13px;font-weight:400">${total} total · pag. ${pg}</span></h2>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${statusFilters}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">${typeFilters}</div>
      ${reports.length === 0
        ? '<p style="color:rgba(255,255,255,0.35);text-align:center;padding:40px 0">Sin reportes.</p>'
        : `<div style="display:flex;flex-direction:column;gap:10px">${rows}</div>`}
      ${pagerLinks(baseUrl, pg, reports.length === PAGE)}
      <script>
        const tok = new URLSearchParams(location.search).get('token');
        async function repAction(id, status) {
          const r = await fetch('/api/reports/'+id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:JSON.stringify({status})});
          if(r.ok) location.reload(); else alert('Error al actualizar');
        }
        async function delPost(id) {
          if(!confirm('Eliminar el post reportado?')) return;
          const r = await fetch('/api/reports/'+id+'/action/post',{method:'DELETE',headers:{Authorization:'Bearer '+tok}});
          if(r.ok) location.reload(); else alert('Error al eliminar el post');
        }
        async function banUser(id) {
          const reason = prompt('Razon del ban (opcional):');
          if(reason === null) return;
          const r = await fetch('/api/reports/'+id+'/action/ban',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:JSON.stringify({reason})});
          if(r.ok) { const d = await r.json(); alert('Usuario @'+d.username+' baneado.'); location.reload(); }
          else alert('Error al banear');
        }
        async function repDelete(id) {
          if(!confirm('Eliminar este reporte?')) return;
          const r = await fetch('/api/reports/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+tok}});
          if(r.ok) location.reload(); else alert('Error al eliminar reporte');
        }
      </script>`;

    res.send(page('Reportes — Admin', `<div style="max-width:900px;margin:28px auto;padding:0 16px">${body}</div>`));
  } catch (err) {
    res.status(500).send(page('Error', `<div class="not-found">Error: ${esc(err.message)}</div>`));
  }
});

module.exports = router;
