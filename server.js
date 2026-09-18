const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------- Настройка админов ----------
// ID пользователей, которые всегда получают роль admin (айди видно в /api/admin/users
// после регистрации, либо это порядковый номер регистрации: первый юзер = 1).
const ADMIN_IDS = [1];

const ROLE_LEVEL = { user: 0, moderator: 1, admin: 2 };
function roleAtLeast(user, role) {
  return (ROLE_LEVEL[user.role] ?? 0) >= (ROLE_LEVEL[role] ?? 0);
}

app.use(express.json({ limit: '3mb' })); // лимит побольше — храним аватар как base64
app.use(express.static(__dirname));

// ---------- Хранилище данных ----------
// Пока JSON-файл на сервере. Позже loadData()/save() можно заменить на БД,
// не трогая роуты.

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  return {
    users: [],
    categories: [],
    topics: [],
    posts: [],
    nextUserId: 1,
    nextCategoryId: 1,
    nextTopicId: 1,
    nextPostId: 1
  };
}

let db = loadData();
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function syncAdmins() {
  let changed = false;
  db.users.forEach(u => {
    if (ADMIN_IDS.includes(u.id) && u.role !== 'admin') { u.role = 'admin'; changed = true; }
  });
  if (changed) save();
}
syncAdmins();

const sessions = new Map(); // token -> userId

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function getUserFromReq(req) {
  const token = parseCookies(req).session;
  if (!token || !sessions.has(token)) return null;
  const user = db.users.find(u => u.id === sessions.get(token)) || null;
  if (user) user.lastSeen = new Date().toISOString();
  return user;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, regDate: u.regDate, lastSeen: u.lastSeen,
    avatar: u.avatar, bio: u.bio, signature: u.signature,
    discord: u.discord, steam: u.steam,
    postsCount: u.postsCount, role: u.role
  };
}

function requireRole(minRole) {
  return (req, res, next) => {
    const user = getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (!roleAtLeast(user, minRole)) return res.status(403).json({ error: 'Недостаточно прав' });
    req.user = user;
    next();
  };
}

// ---------- Регистрация / вход ----------

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Ник от 3 до 20 символов' });
  if (!/^[a-zA-Zа-яА-Я0-9_\-]+$/.test(username)) return res.status(400).json({ error: 'Ник может содержать только буквы, цифры, _ и -' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Такой ник уже занят' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const user = {
    id: db.nextUserId++,
    username, salt,
    passwordHash: hashPassword(password, salt),
    regDate: now,
    lastSeen: now,
    avatar: '', bio: '', signature: '', discord: '', steam: '',
    postsCount: 0, role: 'user'
  };
  db.users.push(user);
  save();
  syncAdmins();

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=2592000`);
  res.json({ user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(400).json({ error: 'Неверный ник или пароль' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=2592000`);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = getUserFromReq(req);
  res.json({ user: publicUser(user) });
});

// ---------- Категории ----------

app.get('/api/categories', (req, res) => {
  const result = db.categories.map(c => {
    const topics = db.topics.filter(t => t.categoryId === c.id);
    const postsCount = topics.reduce((sum, t) => sum + db.posts.filter(p => p.topicId === t.id).length, 0);
    const lastTopic = topics.slice().sort((a, b) => b.lastActivity - a.lastActivity)[0];
    return {
      ...c,
      topicsCount: topics.length,
      postsCount,
      lastTopic: lastTopic ? { id: lastTopic.id, title: lastTopic.title } : null
    };
  });
  res.json({ categories: result });
});

app.get('/api/categories/:id', (req, res) => {
  const cat = db.categories.find(c => c.id === Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  const topics = db.topics
    .filter(t => t.categoryId === cat.id)
    .slice()
    .sort((a, b) => (b.pinned - a.pinned) || (b.lastActivity - a.lastActivity))
    .map(t => ({ ...t, repliesCount: db.posts.filter(p => p.topicId === t.id).length - 1 }));
  res.json({ category: cat, topics });
});

app.post('/api/categories', requireRole('admin'), (req, res) => {
  const { name, desc, minRoleToPost } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название категории' });
  const role = ['user', 'moderator', 'admin'].includes(minRoleToPost) ? minRoleToPost : 'user';
  const category = { id: db.nextCategoryId++, name: name.trim().slice(0, 60), desc: (desc || '').trim().slice(0, 200), minRoleToPost: role };
  db.categories.push(category);
  save();
  res.json({ category });
});

app.put('/api/categories/:id', requireRole('admin'), (req, res) => {
  const cat = db.categories.find(c => c.id === Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  const { name, desc, minRoleToPost } = req.body || {};
  if (typeof name === 'string' && name.trim()) cat.name = name.trim().slice(0, 60);
  if (typeof desc === 'string') cat.desc = desc.trim().slice(0, 200);
  if (['user', 'moderator', 'admin'].includes(minRoleToPost)) cat.minRoleToPost = minRoleToPost;
  save();
  res.json({ category: cat });
});

app.delete('/api/categories/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const cat = db.categories.find(c => c.id === id);
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  const topicIds = db.topics.filter(t => t.categoryId === id).map(t => t.id);
  db.posts = db.posts.filter(p => !topicIds.includes(p.topicId));
  db.topics = db.topics.filter(t => t.categoryId !== id);
  db.categories = db.categories.filter(c => c.id !== id);
  save();
  res.json({ ok: true });
});

// ---------- Темы и сообщения ----------

app.post('/api/categories/:id/topics', requireRole('user'), (req, res) => {
  const cat = db.categories.find(c => c.id === Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  if (!roleAtLeast(req.user, cat.minRoleToPost)) {
    return res.status(403).json({ error: 'У вас нет прав создавать темы в этой категории' });
  }
  const { title, content } = req.body || {};
  if (!title || !title.trim() || !content || !content.trim()) {
    return res.status(400).json({ error: 'Заполните заголовок и текст' });
  }
  const now = Date.now();
  const topic = {
    id: db.nextTopicId++,
    categoryId: cat.id,
    title: title.trim().slice(0, 120),
    authorId: req.user.id,
    authorName: req.user.username,
    createdAt: now,
    lastActivity: now,
    views: 0,
    pinned: false,
    locked: false
  };
  db.topics.push(topic);
  db.posts.push({
    id: db.nextPostId++,
    topicId: topic.id,
    authorId: req.user.id,
    authorName: req.user.username,
    content: content.trim().slice(0, 10000),
    createdAt: now
  });
  req.user.postsCount++;
  save();
  res.json({ topic });
});

app.get('/api/topics/:id', (req, res) => {
  const topic = db.topics.find(t => t.id === Number(req.params.id));
  if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
  topic.views++;
  save();
  const posts = db.posts.filter(p => p.topicId === topic.id).map(p => {
    const author = db.users.find(u => u.id === p.authorId);
    return {
      ...p,
      authorAvatar: author ? author.avatar : '',
      authorRole: author ? author.role : 'user',
      authorPosts: author ? author.postsCount : 0,
      authorSignature: author ? author.signature : ''
    };
  });
  res.json({ topic, posts });
});

app.put('/api/topics/:id', requireRole('moderator'), (req, res) => {
  const topic = db.topics.find(t => t.id === Number(req.params.id));
  if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
  const { pinned, locked } = req.body || {};
  if (typeof pinned === 'boolean') topic.pinned = pinned;
  if (typeof locked === 'boolean') topic.locked = locked;
  save();
  res.json({ topic });
});

app.delete('/api/topics/:id', requireRole('moderator'), (req, res) => {
  const id = Number(req.params.id);
  const topic = db.topics.find(t => t.id === id);
  if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
  db.posts = db.posts.filter(p => p.topicId !== id);
  db.topics = db.topics.filter(t => t.id !== id);
  save();
  res.json({ ok: true });
});

app.post('/api/topics/:id/posts', requireRole('user'), (req, res) => {
  const topic = db.topics.find(t => t.id === Number(req.params.id));
  if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
  if (topic.locked && !roleAtLeast(req.user, 'moderator')) {
    return res.status(403).json({ error: 'Тема закрыта для ответов' });
  }
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Введите текст сообщения' });
  const post = {
    id: db.nextPostId++,
    topicId: topic.id,
    authorId: req.user.id,
    authorName: req.user.username,
    content: content.trim().slice(0, 10000),
    createdAt: Date.now()
  };
  db.posts.push(post);
  topic.lastActivity = post.createdAt;
  req.user.postsCount++;
  save();
  res.json({ post });
});

app.delete('/api/posts/:id', requireRole('user'), (req, res) => {
  const id = Number(req.params.id);
  const post = db.posts.find(p => p.id === id);
  if (!post) return res.status(404).json({ error: 'Сообщение не найдено' });
  const topicPosts = db.posts.filter(p => p.topicId === post.topicId).sort((a, b) => a.createdAt - b.createdAt);
  if (topicPosts[0] && topicPosts[0].id === post.id) {
    return res.status(400).json({ error: 'Это первое сообщение темы — удалите тему целиком' });
  }
  const canDelete = post.authorId === req.user.id || roleAtLeast(req.user, 'moderator');
  if (!canDelete) return res.status(403).json({ error: 'Недостаточно прав' });
  db.posts = db.posts.filter(p => p.id !== id);
  save();
  res.json({ ok: true });
});

// ---------- Профиль ----------

app.get('/api/users/:username', (req, res) => {
  const user = db.users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const topicsCreated = db.topics.filter(t => t.authorId === user.id).length;
  res.json({ user: publicUser(user), topicsCreated });
});

app.put('/api/profile', requireRole('user'), (req, res) => {
  const { bio, signature, discord, steam, avatarData } = req.body || {};
  if (typeof bio === 'string') req.user.bio = bio.slice(0, 500);
  if (typeof signature === 'string') req.user.signature = signature.slice(0, 150);
  if (typeof discord === 'string') req.user.discord = discord.slice(0, 40);
  if (typeof steam === 'string') req.user.steam = steam.slice(0, 100);
  if (typeof avatarData === 'string' && avatarData) {
    if (!avatarData.startsWith('data:image/')) return res.status(400).json({ error: 'Некорректный формат изображения' });
    if (avatarData.length > 1_500_000) return res.status(400).json({ error: 'Изображение слишком большое' });
    req.user.avatar = avatarData;
  }
  save();
  res.json({ user: publicUser(req.user) });
});

// ---------- Админка ----------

app.get('/api/admin/users', requireRole('admin'), (req, res) => {
  const users = db.users.map(u => ({
    id: u.id, username: u.username, role: u.role, regDate: u.regDate,
    lastSeen: u.lastSeen, postsCount: u.postsCount
  }));
  res.json({ users });
});

app.put('/api/admin/users/:id/role', requireRole('admin'), (req, res) => {
  const target = db.users.find(u => u.id === Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  const { role } = req.body || {};
  if (!['user', 'moderator', 'admin'].includes(role)) return res.status(400).json({ error: 'Некорректная роль' });
  target.role = role;
  save();
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Форум запущен: http://localhost:${PORT}`));
