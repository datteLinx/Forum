const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(__dirname));

// ---------- Хранилище данных ----------
// Пока храним в JSON-файле на сервере. Позже можно заменить
// loadData()/save() на обращения к реальной БД, не трогая роуты.

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  return {
    users: [],
    categories: [
      { id: 1, name: 'Новости сервера', desc: 'Объявления, обновления, ивенты' },
      { id: 2, name: 'Правила проекта', desc: 'Правила сервера и форума' },
      { id: 3, name: 'Общение', desc: 'Общий раздел для игроков' },
      { id: 4, name: 'Жалобы', desc: 'Жалобы на игроков и администрацию' },
      { id: 5, name: 'Тех. поддержка', desc: 'Технические вопросы и проблемы' },
      { id: 6, name: 'Предложения', desc: 'Идеи по развитию сервера' }
    ],
    topics: [],
    posts: [],
    nextUserId: 1,
    nextTopicId: 1,
    nextPostId: 1
  };
}

let db = loadData();
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

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
  return db.users.find(u => u.id === sessions.get(token)) || null;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, regDate: u.regDate,
    avatar: u.avatar, bio: u.bio, postsCount: u.postsCount, role: u.role
  };
}

function auth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  req.user = user;
  next();
}

// ---------- Регистрация / вход ----------

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Ник от 3 до 20 символов' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Такой ник уже занят' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: db.nextUserId++,
    username, salt,
    passwordHash: hashPassword(password, salt),
    regDate: new Date().toISOString(),
    avatar: '', bio: '', postsCount: 0, role: 'user'
  };
  db.users.push(user);
  save();

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
  res.json({ user: publicUser(getUserFromReq(req)) });
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
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map(t => ({ ...t, repliesCount: db.posts.filter(p => p.topicId === t.id).length - 1 }));
  res.json({ category: cat, topics });
});

app.post('/api/categories/:id/topics', auth, (req, res) => {
  const cat = db.categories.find(c => c.id === Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
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
    views: 0
  };
  db.topics.push(topic);
  db.posts.push({
    id: db.nextPostId++,
    topicId: topic.id,
    authorId: req.user.id,
    authorName: req.user.username,
    content: content.trim(),
    createdAt: now
  });
  req.user.postsCount++;
  save();
  res.json({ topic });
});

// ---------- Темы и сообщения ----------

app.get('/api/topics/:id', (req, res) => {
  const topic = db.topics.find(t => t.id === Number(req.params.id));
  if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
  topic.views++;
  save();
  const posts = db.posts.filter(p => p.topicId === topic.id).map(p => {
    const author = db.users.find(u => u.id === p.authorId);
    return { ...p, authorAvatar: author ? author.avatar : '', authorPosts: author ? author.postsCount : 0 };
  });
  res.json({ topic, posts });
});

app.post('/api/topics/:id/posts', auth, (req, res) => {
  const topic = db.topics.find(t => t.id === Number(req.params.id));
  if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Введите текст сообщения' });
  const post = {
    id: db.nextPostId++,
    topicId: topic.id,
    authorId: req.user.id,
    authorName: req.user.username,
    content: content.trim(),
    createdAt: Date.now()
  };
  db.posts.push(post);
  topic.lastActivity = post.createdAt;
  req.user.postsCount++;
  save();
  res.json({ post });
});

// ---------- Профиль ----------

app.get('/api/users/:username', (req, res) => {
  const user = db.users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const topicsCreated = db.topics.filter(t => t.authorId === user.id).length;
  res.json({ user: publicUser(user), topicsCreated });
});

app.put('/api/profile', auth, (req, res) => {
  const { avatar, bio } = req.body || {};
  if (typeof avatar === 'string') req.user.avatar = avatar.slice(0, 300);
  if (typeof bio === 'string') req.user.bio = bio.slice(0, 500);
  save();
  res.json({ user: publicUser(req.user) });
});

app.listen(PORT, () => console.log(`Форум запущен: http://localhost:${PORT}`));
