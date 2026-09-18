const app = document.getElementById('app');
const nav = document.getElementById('nav');

let currentUser = null;

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function timeAgo(value) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин. назад`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч. назад`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} дн. назад`;
  return formatDate(value);
}

function roleLabel(role) {
  return role === 'admin' ? 'Админ' : role === 'moderator' ? 'Модератор' : 'Игрок';
}
function roleBadge(role) {
  return `<span class="role-badge role-${role}">${roleLabel(role)}</span>`;
}
function isMod(user) { return user && (user.role === 'moderator' || user.role === 'admin'); }
function isAdmin(user) { return user && user.role === 'admin'; }
function avatarHtml(user, size) {
  const s = size || 32;
  if (user && user.avatar) return `<img class="avatar-img" style="width:${s}px;height:${s}px" src="${user.avatar}" alt="">`;
  const letter = user && user.username ? user.username[0].toUpperCase() : '?';
  return `<span class="avatar-fallback" style="width:${s}px;height:${s}px;font-size:${Math.floor(s*0.45)}px">${letter}</span>`;
}

// ---------- Форматирование текста ----------

function inlineFormat(s) {
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_]+)__/g, '<u>$1</u>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function renderFormatted(raw) {
  const lines = escapeHtml(raw || '').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('&gt; ')) {
      const block = [];
      while (i < lines.length && lines[i].startsWith('&gt; ')) { block.push(lines[i].slice(5)); i++; }
      html += `<blockquote>${block.map(inlineFormat).join('<br>')}</blockquote>`;
    } else if (lines[i].startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++; }
      html += `<ul>${items.map(t => `<li>${inlineFormat(t)}</li>`).join('')}</ul>`;
    } else if (lines[i] === '') {
      html += '<br>'; i++;
    } else {
      html += `<p>${inlineFormat(lines[i])}</p>`; i++;
    }
  }
  return html;
}

function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || 'текст';
  textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
}

function linePrefix(textarea, prefix) {
  const start = textarea.selectionStart;
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  textarea.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
}

function buildToolbar(textareaId) {
  return `
    <div class="toolbar" data-target="${textareaId}">
      <button type="button" data-act="bold" title="Жирный"><b>Ж</b></button>
      <button type="button" data-act="italic" title="Курсив"><i>К</i></button>
      <button type="button" data-act="underline" title="Подчёркнутый"><u>Ч</u></button>
      <button type="button" data-act="strike" title="Зачёркнутый"><s>S</s></button>
      <button type="button" data-act="code" title="Код">&lt;/&gt;</button>
      <button type="button" data-act="quote" title="Цитата">❝</button>
      <button type="button" data-act="list" title="Список">☰</button>
      <button type="button" data-act="link" title="Ссылка">🔗</button>
    </div>
  `;
}

function bindToolbar(root) {
  root.querySelectorAll('.toolbar').forEach(bar => {
    const textarea = document.getElementById(bar.dataset.target);
    bar.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        if (act === 'bold') wrapSelection(textarea, '**', '**');
        else if (act === 'italic') wrapSelection(textarea, '*', '*');
        else if (act === 'underline') wrapSelection(textarea, '__', '__');
        else if (act === 'strike') wrapSelection(textarea, '~~', '~~');
        else if (act === 'code') wrapSelection(textarea, '`', '`');
        else if (act === 'quote') linePrefix(textarea, '> ');
        else if (act === 'list') linePrefix(textarea, '- ');
        else if (act === 'link') {
          const url = prompt('Ссылка (http:// или https://):');
          if (url) wrapSelection(textarea, '[', `](${url})`);
        }
      };
    });
  });
}

// ---------- Навигация ----------

function renderNav() {
  if (currentUser) {
    nav.innerHTML = `
      <a href="#/new-topic">+ Тема</a>
      ${isAdmin(currentUser) ? `<a href="#/admin">Админка</a>` : ''}
      <a class="nav-user" href="#/profile/${encodeURIComponent(currentUser.username)}">
        ${avatarHtml(currentUser, 24)} ${escapeHtml(currentUser.username)}
      </a>
      <a href="#" id="logout-link">Выход</a>
    `;
    document.getElementById('logout-link').onclick = async (e) => {
      e.preventDefault();
      await api('/api/logout', { method: 'POST' });
      currentUser = null;
      renderNav();
      location.hash = '#/';
    };
  } else {
    nav.innerHTML = `<a href="#/login">Вход</a><a href="#/register">Регистрация</a>`;
  }
}

async function refreshUser() {
  try { currentUser = (await api('/api/me')).user; } catch { currentUser = null; }
  renderNav();
}

// ---------- Страницы ----------

async function renderHome() {
  app.innerHTML = '<p class="muted">Загрузка...</p>';
  const { categories } = await api('/api/categories');
  if (!categories.length) {
    app.innerHTML = `
      <div class="empty-state">
        <p>На форуме пока нет категорий.</p>
        ${isAdmin(currentUser) ? `<a class="btn" href="#/admin">Создать категорию в админке</a>` : `<p class="muted">Загляните позже.</p>`}
      </div>
    `;
    return;
  }
  app.innerHTML = `
    <table class="board">
      <thead><tr><th>Категория</th><th>Тем</th><th>Сообщений</th><th>Последняя тема</th></tr></thead>
      <tbody>
        ${categories.map(c => `
          <tr>
            <td>
              <a class="cat-link" href="#/category/${c.id}">${escapeHtml(c.name)}</a>
              <div class="muted small">${escapeHtml(c.desc)}</div>
              ${c.minRoleToPost !== 'user' ? `<div class="small perm-note">Темы могут создавать: ${roleLabel(c.minRoleToPost)}+</div>` : ''}
            </td>
            <td>${c.topicsCount}</td>
            <td>${c.postsCount}</td>
            <td>${c.lastTopic ? `<a href="#/topic/${c.lastTopic.id}">${escapeHtml(c.lastTopic.title)}</a>` : '<span class="muted">нет тем</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function renderCategory(id) {
  app.innerHTML = '<p class="muted">Загрузка...</p>';
  const { category, topics } = await api(`/api/categories/${id}`);
  const canPost = currentUser && (
    (category.minRoleToPost === 'user') ||
    (category.minRoleToPost === 'moderator' && isMod(currentUser)) ||
    (category.minRoleToPost === 'admin' && isAdmin(currentUser))
  );
  app.innerHTML = `
    <div class="crumbs"><a href="#/">Форум</a> / ${escapeHtml(category.name)}</div>
    <div class="panel-head">
      <div>
        <h1>${escapeHtml(category.name)}</h1>
        ${category.desc ? `<p class="muted">${escapeHtml(category.desc)}</p>` : ''}
      </div>
      ${canPost ? `<a class="btn" href="#/new-topic/${category.id}">+ Новая тема</a>` : ''}
    </div>
    ${!canPost && currentUser ? `<p class="muted small">Создавать темы здесь могут только: ${roleLabel(category.minRoleToPost)}+</p>` : ''}
    <table class="board">
      <thead><tr><th>Тема</th><th>Автор</th><th>Ответов</th><th>Просмотров</th></tr></thead>
      <tbody>
        ${topics.length ? topics.map(t => `
          <tr>
            <td>
              ${t.pinned ? '<span title="Закреплено">📌</span> ' : ''}
              ${t.locked ? '<span title="Закрыта">🔒</span> ' : ''}
              <a href="#/topic/${t.id}">${escapeHtml(t.title)}</a>
            </td>
            <td><a href="#/profile/${encodeURIComponent(t.authorName)}">${escapeHtml(t.authorName)}</a></td>
            <td>${t.repliesCount}</td>
            <td>${t.views}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" class="muted">В этой категории пока нет тем</td></tr>`}
      </tbody>
    </table>
  `;
}

async function renderTopic(id) {
  app.innerHTML = '<p class="muted">Загрузка...</p>';
  const { topic, posts } = await api(`/api/topics/${id}`);
  const canModerate = isMod(currentUser);
  const canReply = currentUser && (!topic.locked || canModerate);

  app.innerHTML = `
    <div class="crumbs"><a href="#/">Форум</a> / <a href="#/category/${topic.categoryId}">Категория</a> / ${escapeHtml(topic.title)}</div>
    <div class="panel-head">
      <h1>${topic.pinned ? '📌 ' : ''}${topic.locked ? '🔒 ' : ''}${escapeHtml(topic.title)}</h1>
      ${canModerate ? `
        <div class="mod-actions">
          <button class="btn-mini" id="btn-pin">${topic.pinned ? 'Открепить' : 'Закрепить'}</button>
          <button class="btn-mini" id="btn-lock">${topic.locked ? 'Открыть' : 'Закрыть'}</button>
          <button class="btn-mini btn-danger" id="btn-del-topic">Удалить тему</button>
        </div>
      ` : ''}
    </div>
    <div class="posts">
      ${posts.map(p => `
        <div class="post" data-post-id="${p.id}">
          <div class="post-author">
            <a href="#/profile/${encodeURIComponent(p.authorName)}">
              ${avatarHtml({ avatar: p.authorAvatar, username: p.authorName }, 48)}
              <div>${escapeHtml(p.authorName)}</div>
            </a>
            ${roleBadge(p.authorRole)}
            <div class="muted small">сообщений: ${p.authorPosts}</div>
          </div>
          <div class="post-body">
            <div class="post-top">
              <span class="post-date muted small">${formatDate(p.createdAt)}</span>
              ${(currentUser && (currentUser.id === p.authorId || canModerate)) ? `<button class="btn-mini btn-danger post-del" data-id="${p.id}">Удалить</button>` : ''}
            </div>
            <div class="post-content">${renderFormatted(p.content)}</div>
            ${p.authorSignature ? `<div class="post-signature">${escapeHtml(p.authorSignature)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    ${currentUser ? (canReply ? `
      <form id="reply-form" class="panel">
        <label>Ваш ответ</label>
        ${buildToolbar('reply-content')}
        <textarea id="reply-content" required></textarea>
        <button class="btn" type="submit">Ответить</button>
        <div class="error" id="reply-error"></div>
      </form>
    ` : `<p class="muted">Тема закрыта для ответов.</p>`) : `<p class="muted"><a href="#/login">Войдите</a>, чтобы отвечать в темах.</p>`}
  `;

  bindToolbar(app);

  const form = document.getElementById('reply-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const content = document.getElementById('reply-content').value;
      try {
        await api(`/api/topics/${id}/posts`, { method: 'POST', body: JSON.stringify({ content }) });
        renderTopic(id);
      } catch (err) {
        document.getElementById('reply-error').textContent = err.message;
      }
    };
  }

  app.querySelectorAll('.post-del').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Удалить сообщение?')) return;
      try {
        await api(`/api/posts/${btn.dataset.id}`, { method: 'DELETE' });
        renderTopic(id);
      } catch (err) { alert(err.message); }
    };
  });

  const btnPin = document.getElementById('btn-pin');
  if (btnPin) btnPin.onclick = async () => {
    await api(`/api/topics/${id}`, { method: 'PUT', body: JSON.stringify({ pinned: !topic.pinned }) });
    renderTopic(id);
  };
  const btnLock = document.getElementById('btn-lock');
  if (btnLock) btnLock.onclick = async () => {
    await api(`/api/topics/${id}`, { method: 'PUT', body: JSON.stringify({ locked: !topic.locked }) });
    renderTopic(id);
  };
  const btnDelTopic = document.getElementById('btn-del-topic');
  if (btnDelTopic) btnDelTopic.onclick = async () => {
    if (!confirm('Удалить тему целиком вместе со всеми сообщениями?')) return;
    await api(`/api/topics/${id}`, { method: 'DELETE' });
    location.hash = `#/category/${topic.categoryId}`;
  };
}

async function renderNewTopic(categoryId) {
  if (!currentUser) { location.hash = '#/login'; return; }
  const { categories } = await api('/api/categories');
  if (!categories.length) {
    app.innerHTML = `<p class="muted">Сначала нужно создать хотя бы одну категорию.</p>`;
    return;
  }
  app.innerHTML = `
    <h1>Новая тема</h1>
    <form id="topic-form" class="panel">
      <label>Категория</label>
      <select id="topic-category">
        ${categories.map(c => `<option value="${c.id}" ${categoryId && Number(categoryId) === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <label>Заголовок</label>
      <input id="topic-title" type="text" maxlength="120" required>
      <label>Сообщение</label>
      ${buildToolbar('topic-content')}
      <textarea id="topic-content" required></textarea>
      <p class="muted small">Форматирование: **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~, \`код\`, "> цитата", "- список", [текст](ссылка)</p>
      <button class="btn" type="submit">Создать тему</button>
      <div class="error" id="topic-error"></div>
    </form>
  `;
  bindToolbar(app);
  document.getElementById('topic-form').onsubmit = async (e) => {
    e.preventDefault();
    const catId = document.getElementById('topic-category').value;
    const title = document.getElementById('topic-title').value;
    const content = document.getElementById('topic-content').value;
    try {
      const { topic } = await api(`/api/categories/${catId}/topics`, { method: 'POST', body: JSON.stringify({ title, content }) });
      location.hash = `#/topic/${topic.id}`;
    } catch (err) {
      document.getElementById('topic-error').textContent = err.message;
    }
  };
}

async function renderProfile(username) {
  app.innerHTML = '<p class="muted">Загрузка...</p>';
  let data;
  try { data = await api(`/api/users/${encodeURIComponent(username)}`); }
  catch (err) { app.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`; return; }
  const { user, topicsCreated } = data;
  const isMe = currentUser && currentUser.username === user.username;
  app.innerHTML = `
    <div class="profile-card">
      ${avatarHtml(user, 96)}
      <div class="profile-info">
        <h1>${escapeHtml(user.username)} ${roleBadge(user.role)}</h1>
        <div class="muted small">На форуме с ${formatDate(user.regDate)} · заходил ${timeAgo(user.lastSeen)}</div>
        <div class="muted small">Сообщений: ${user.postsCount} · Тем создано: ${topicsCreated}</div>
        ${(user.discord || user.steam) ? `
          <div class="profile-contacts">
            ${user.discord ? `<span>Discord: ${escapeHtml(user.discord)}</span>` : ''}
            ${user.steam ? `<span>Steam: ${escapeHtml(user.steam)}</span>` : ''}
          </div>
        ` : ''}
        ${user.signature ? `<div class="profile-signature">${escapeHtml(user.signature)}</div>` : ''}
        ${user.bio ? `<p class="bio">${renderFormatted(user.bio)}</p>` : ''}
        ${isMe ? `<a class="btn" href="#/edit-profile">Редактировать профиль</a>` : ''}
      </div>
    </div>
  `;
}

let pendingAvatarData = null;

function resizeImageFile(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
        else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function renderEditProfile() {
  if (!currentUser) { location.hash = '#/login'; return; }
  pendingAvatarData = null;
  app.innerHTML = `
    <h1>Редактировать профиль</h1>
    <form id="edit-form" class="panel">
      <label>Аватар</label>
      <div class="avatar-edit-row">
        <div id="avatar-preview">${avatarHtml(currentUser, 72)}</div>
        <input id="avatar-file" type="file" accept="image/*">
      </div>
      <label>О себе</label>
      ${buildToolbar('edit-bio')}
      <textarea id="edit-bio">${escapeHtml(currentUser.bio || '')}</textarea>
      <label>Подпись (показывается под каждым сообщением)</label>
      <input id="edit-signature" type="text" maxlength="150" value="${escapeHtml(currentUser.signature || '')}">
      <label>Discord</label>
      <input id="edit-discord" type="text" maxlength="40" value="${escapeHtml(currentUser.discord || '')}">
      <label>Steam</label>
      <input id="edit-steam" type="text" maxlength="100" value="${escapeHtml(currentUser.steam || '')}">
      <button class="btn" type="submit">Сохранить</button>
      <div class="error" id="edit-error"></div>
    </form>
  `;
  bindToolbar(app);

  document.getElementById('avatar-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingAvatarData = await resizeImageFile(file, 200);
      document.getElementById('avatar-preview').innerHTML =
        `<img class="avatar-img" style="width:72px;height:72px" src="${pendingAvatarData}" alt="">`;
    } catch {
      document.getElementById('edit-error').textContent = 'Не удалось загрузить изображение';
    }
  };

  document.getElementById('edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      bio: document.getElementById('edit-bio').value,
      signature: document.getElementById('edit-signature').value,
      discord: document.getElementById('edit-discord').value,
      steam: document.getElementById('edit-steam').value
    };
    if (pendingAvatarData) body.avatarData = pendingAvatarData;
    try {
      const { user } = await api('/api/profile', { method: 'PUT', body: JSON.stringify(body) });
      currentUser = user;
      renderNav();
      location.hash = `#/profile/${encodeURIComponent(user.username)}`;
    } catch (err) {
      document.getElementById('edit-error').textContent = err.message;
    }
  };
}

function renderLogin() {
  app.innerHTML = `
    <h1>Вход</h1>
    <form id="login-form" class="panel narrow">
      <label>Ник</label>
      <input id="login-username" type="text" required>
      <label>Пароль</label>
      <input id="login-password" type="password" required>
      <button class="btn" type="submit">Войти</button>
      <div class="error" id="login-error"></div>
    </form>
  `;
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
      const { user } = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      currentUser = user;
      renderNav();
      location.hash = '#/';
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  };
}

function renderRegister() {
  app.innerHTML = `
    <h1>Регистрация</h1>
    <form id="register-form" class="panel narrow">
      <label>Ник</label>
      <input id="reg-username" type="text" required>
      <label>Пароль</label>
      <input id="reg-password" type="password" required>
      <button class="btn" type="submit">Зарегистрироваться</button>
      <div class="error" id="register-error"></div>
    </form>
  `;
  document.getElementById('register-form').onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    try {
      const { user } = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
      currentUser = user;
      renderNav();
      location.hash = '#/';
    } catch (err) {
      document.getElementById('register-error').textContent = err.message;
    }
  };
}

// ---------- Админка ----------

async function renderAdmin() {
  if (!currentUser) { location.hash = '#/login'; return; }
  if (!isAdmin(currentUser)) { app.innerHTML = `<p class="error">Доступ только для администраторов</p>`; return; }

  app.innerHTML = '<p class="muted">Загрузка...</p>';
  const [{ categories }, { users }] = await Promise.all([
    api('/api/categories'),
    api('/api/admin/users')
  ]);

  app.innerHTML = `
    <h1>Админ-панель</h1>

    <h2>Категории</h2>
    <form id="cat-form" class="panel">
      <label>Название</label>
      <input id="cat-name" type="text" maxlength="60" required>
      <label>Описание</label>
      <input id="cat-desc" type="text" maxlength="200">
      <label>Кто может создавать темы</label>
      <select id="cat-role">
        <option value="user">Все пользователи</option>
        <option value="moderator">Модератор и выше</option>
        <option value="admin">Только админы</option>
      </select>
      <button class="btn" type="submit">Создать категорию</button>
      <div class="error" id="cat-error"></div>
    </form>

    <table class="board admin-table">
      <thead><tr><th>Категория</th><th>Права на темы</th><th></th></tr></thead>
      <tbody>
        ${categories.length ? categories.map(c => `
          <tr>
            <td><b>${escapeHtml(c.name)}</b><div class="muted small">${escapeHtml(c.desc)}</div></td>
            <td>${roleLabel(c.minRoleToPost)}+</td>
            <td><button class="btn-mini btn-danger cat-del" data-id="${c.id}">Удалить</button></td>
          </tr>
        `).join('') : `<tr><td colspan="3" class="muted">Категорий пока нет</td></tr>`}
      </tbody>
    </table>

    <h2>Пользователи</h2>
    <table class="board admin-table">
      <thead><tr><th>Ник</th><th>Роль</th><th>Сообщений</th><th>Регистрация</th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td><a href="#/profile/${encodeURIComponent(u.username)}">${escapeHtml(u.username)}</a> <span class="muted small">#${u.id}</span></td>
            <td>
              <select class="role-select" data-id="${u.id}">
                <option value="user" ${u.role === 'user' ? 'selected' : ''}>Игрок</option>
                <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>Модератор</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Админ</option>
              </select>
            </td>
            <td>${u.postsCount}</td>
            <td class="muted small">${formatDate(u.regDate)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('cat-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('cat-name').value;
    const desc = document.getElementById('cat-desc').value;
    const minRoleToPost = document.getElementById('cat-role').value;
    try {
      await api('/api/categories', { method: 'POST', body: JSON.stringify({ name, desc, minRoleToPost }) });
      renderAdmin();
    } catch (err) {
      document.getElementById('cat-error').textContent = err.message;
    }
  };

  app.querySelectorAll('.cat-del').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Удалить категорию вместе со всеми темами и сообщениями?')) return;
      await api(`/api/categories/${btn.dataset.id}`, { method: 'DELETE' });
      renderAdmin();
    };
  });

  app.querySelectorAll('.role-select').forEach(sel => {
    sel.onchange = async () => {
      try {
        await api(`/api/admin/users/${sel.dataset.id}/role`, { method: 'PUT', body: JSON.stringify({ role: sel.value }) });
      } catch (err) { alert(err.message); }
    };
  });
}

// ---------- Роутер ----------

async function router() {
  const hash = location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);

  try {
    if (parts.length === 0) return renderHome();
    if (parts[0] === 'category' && parts[1]) return renderCategory(parts[1]);
    if (parts[0] === 'topic' && parts[1]) return renderTopic(parts[1]);
    if (parts[0] === 'new-topic') return renderNewTopic(parts[1]);
    if (parts[0] === 'profile' && parts[1]) return renderProfile(decodeURIComponent(parts[1]));
    if (parts[0] === 'edit-profile') return renderEditProfile();
    if (parts[0] === 'admin') return renderAdmin();
    if (parts[0] === 'login') return renderLogin();
    if (parts[0] === 'register') return renderRegister();
    return renderHome();
  } catch (err) {
    app.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  await refreshUser();
  router();
});
