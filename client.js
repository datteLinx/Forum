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

function renderNav() {
  if (currentUser) {
    nav.innerHTML = `
      <a href="#/new-topic">+ Тема</a>
      <a href="#/profile/${encodeURIComponent(currentUser.username)}">${escapeHtml(currentUser.username)}</a>
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
  try {
    const data = await api('/api/me');
    currentUser = data.user;
  } catch {
    currentUser = null;
  }
  renderNav();
}

// ---------- Страницы ----------

async function renderHome() {
  app.innerHTML = '<p class="muted">Загрузка...</p>';
  const { categories } = await api('/api/categories');
  app.innerHTML = `
    <table class="board">
      <thead><tr><th>Категория</th><th>Тем</th><th>Сообщений</th><th>Последняя тема</th></tr></thead>
      <tbody>
        ${categories.map(c => `
          <tr>
            <td>
              <a class="cat-link" href="#/category/${c.id}">${escapeHtml(c.name)}</a>
              <div class="muted small">${escapeHtml(c.desc)}</div>
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
  app.innerHTML = `
    <div class="crumbs"><a href="#/">Форум</a> / ${escapeHtml(category.name)}</div>
    <div class="panel-head">
      <h1>${escapeHtml(category.name)}</h1>
      ${currentUser ? `<a class="btn" href="#/new-topic/${category.id}">+ Новая тема</a>` : ''}
    </div>
    <table class="board">
      <thead><tr><th>Тема</th><th>Автор</th><th>Ответов</th><th>Просмотров</th></tr></thead>
      <tbody>
        ${topics.length ? topics.map(t => `
          <tr>
            <td><a href="#/topic/${t.id}">${escapeHtml(t.title)}</a></td>
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
  app.innerHTML = `
    <div class="crumbs"><a href="#/">Форум</a> / <a href="#/category/${topic.categoryId}">Категория</a> / ${escapeHtml(topic.title)}</div>
    <h1>${escapeHtml(topic.title)}</h1>
    <div class="posts">
      ${posts.map(p => `
        <div class="post">
          <div class="post-author">
            <a href="#/profile/${encodeURIComponent(p.authorName)}">${escapeHtml(p.authorName)}</a>
            <div class="muted small">сообщений: ${p.authorPosts}</div>
          </div>
          <div class="post-body">
            <div class="post-date muted small">${formatDate(p.createdAt)}</div>
            <div class="post-content">${escapeHtml(p.content)}</div>
          </div>
        </div>
      `).join('')}
    </div>
    ${currentUser ? `
      <form id="reply-form" class="panel">
        <textarea id="reply-content" placeholder="Ваш ответ..." required></textarea>
        <button class="btn" type="submit">Ответить</button>
        <div class="error" id="reply-error"></div>
      </form>
    ` : `<p class="muted"><a href="#/login">Войдите</a>, чтобы отвечать в темах.</p>`}
  `;

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
}

async function renderNewTopic(categoryId) {
  if (!currentUser) { location.hash = '#/login'; return; }
  const { categories } = await api('/api/categories');
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
      <textarea id="topic-content" required></textarea>
      <button class="btn" type="submit">Создать тему</button>
      <div class="error" id="topic-error"></div>
    </form>
  `;
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
  try {
    data = await api(`/api/users/${encodeURIComponent(username)}`);
  } catch (err) {
    app.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    return;
  }
  const { user, topicsCreated } = data;
  const isMe = currentUser && currentUser.username === user.username;
  app.innerHTML = `
    <div class="profile-card">
      <div class="avatar">${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : escapeHtml(user.username[0].toUpperCase())}</div>
      <div>
        <h1>${escapeHtml(user.username)}</h1>
        <div class="muted">Роль: ${escapeHtml(user.role)}</div>
        <div class="muted">На форуме с ${formatDate(user.regDate)}</div>
        <div class="muted">Сообщений: ${user.postsCount} · Тем создано: ${topicsCreated}</div>
        ${user.bio ? `<p class="bio">${escapeHtml(user.bio)}</p>` : ''}
        ${isMe ? `<a class="btn" href="#/edit-profile">Редактировать профиль</a>` : ''}
      </div>
    </div>
  `;
}

async function renderEditProfile() {
  if (!currentUser) { location.hash = '#/login'; return; }
  app.innerHTML = `
    <h1>Редактировать профиль</h1>
    <form id="edit-form" class="panel">
      <label>Ссылка на аватар</label>
      <input id="edit-avatar" type="text" value="${escapeHtml(currentUser.avatar || '')}">
      <label>О себе</label>
      <textarea id="edit-bio">${escapeHtml(currentUser.bio || '')}</textarea>
      <button class="btn" type="submit">Сохранить</button>
      <div class="error" id="edit-error"></div>
    </form>
  `;
  document.getElementById('edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const avatar = document.getElementById('edit-avatar').value;
    const bio = document.getElementById('edit-bio').value;
    try {
      const { user } = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ avatar, bio }) });
      currentUser = user;
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
