/**
 * 街の語り部 — member.js
 * 会員ログイン・お知らせ投稿・イベント企画・参加
 */
'use strict';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxQB0eMo8HMiJ_wpVv_eB84Q3EmP5G1zSXyLIB9ft1ZmAgJUKIEpEdeHbQBC4MZRUdb/exec';

/* ================================================
   状態
   ================================================ */
let SESSION_TOKEN = '';
let MEMBER_INFO   = null; // { name, email, row }
let siteData      = null;

/* ================================================
   GASリクエスト
   ================================================ */
async function gasPost(payload) {
  const form = new FormData();
  form.append('payload', JSON.stringify({ ...payload, token: SESSION_TOKEN }));
  const res  = await fetch(GAS_URL, { method: 'POST', body: form });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { result:'success' }; }
}

/* ================================================
   ユーティリティ
   ================================================ */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
function formatDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日`;
}
function showToast(msg, color='#1a1208') {
  let t = document.getElementById('member-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'member-toast';
    t.style.cssText = `position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);
      color:#f7f3eb;padding:.75rem 1.5rem;border-radius:4px;font-size:.88rem;z-index:9999;
      box-shadow:0 4px 16px rgba(0,0,0,.3);opacity:0;transition:opacity .3s;pointer-events:none;
      border-left:3px solid #b5861e;min-width:200px;text-align:center;`;
    document.body.appendChild(t);
  }
  t.style.background = color;
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

/* ================================================
   data.json 読み込み
   ================================================ */
async function loadData() {
  const res  = await fetch('./data.json?' + Date.now());
  return res.json();
}

/* ================================================
   ログイン
   ================================================ */
function setupLogin() {
  const loginScreen  = document.getElementById('login-screen');
  const memberScreen = document.getElementById('member-screen');
  const loginForm    = document.getElementById('login-form');
  const loginError   = document.getElementById('login-error');
  const logoutBtn    = document.getElementById('logout-btn');

  // セッション復元
  const saved = sessionStorage.getItem('member_token');
  const info  = sessionStorage.getItem('member_info');
  if (saved && info) {
    SESSION_TOKEN = saved;
    MEMBER_INFO   = JSON.parse(info);
    loginScreen.hidden  = true;
    memberScreen.hidden = false;
    memberInit();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = '確認中…';
    loginError.hidden     = true;

    const email    = document.getElementById('member-email').value.trim();
    const password = document.getElementById('member-pass').value;

    try {
      const json = await gasPost({ action: 'memberLogin', email, password });
      if (json.result === 'success') {
        SESSION_TOKEN = json.token;
        MEMBER_INFO   = { name: json.name, email: json.email, row: json.row };
        sessionStorage.setItem('member_token', SESSION_TOKEN);
        sessionStorage.setItem('member_info',  JSON.stringify(MEMBER_INFO));
        loginScreen.hidden  = true;
        memberScreen.hidden = false;
        memberInit();
      } else {
        loginError.hidden     = false;
        loginError.textContent = json.message || 'ログインに失敗しました';
      }
    } catch (err) {
      loginError.hidden     = false;
      loginError.textContent = '接続エラーが発生しました';
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'ログイン';
    }
  });

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('member_token');
    sessionStorage.removeItem('member_info');
    location.reload();
  });
}

/* ================================================
   会員画面初期化
   ================================================ */
async function memberInit() {
  // 名前表示
  const nameEl = document.getElementById('member-name-display');
  if (nameEl && MEMBER_INFO) nameEl.textContent = MEMBER_INFO.name + ' さん';

  setupTabs();
  setupDeleteModal();

  siteData = await loadData();
  renderMemberNews(siteData.news || []);
  renderMemberSchedule(siteData.schedule || []);
  renderJoinList(siteData.schedule || []);
  setupNewsForm();
  setupScheduleForm();
  setupNotifyModal();
  setupPasswordForm();

  // 企画者メールのデフォルト値を設定
  const orgEmail = document.getElementById('schedule-organizer-email');
  if (orgEmail && MEMBER_INFO) orgEmail.value = MEMBER_INFO.email;
}

/* ================================================
   タブ
   ================================================ */
function setupTabs() {
  const tabs   = document.querySelectorAll('.admin-tab');
  const panels = document.querySelectorAll('.admin-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => { p.classList.remove('active'); p.hidden = true; });
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      if (target) { target.classList.add('active'); target.hidden = false; }
    });
  });
  panels.forEach((p, i) => { p.hidden = i !== 0; if (i === 0) p.classList.add('active'); });
}

/* ================================================
   削除モーダル
   ================================================ */
let pendingDeleteFn = null;
function setupDeleteModal() {
  const modal = document.getElementById('delete-modal');
  if (modal) modal.hidden = true;
  document.getElementById('delete-confirm-btn').addEventListener('click', () => {
    if (pendingDeleteFn) { pendingDeleteFn(); pendingDeleteFn = null; }
    document.getElementById('delete-modal').hidden = true;
  });
  document.getElementById('delete-cancel-btn').addEventListener('click', () => {
    pendingDeleteFn = null;
    document.getElementById('delete-modal').hidden = true;
  });
}
function openDeleteModal(msg, fn) {
  document.getElementById('delete-modal-msg').textContent = msg;
  pendingDeleteFn = fn;
  document.getElementById('delete-modal').hidden = false;
  document.getElementById('delete-modal').style.display = '';
}

/* ================================================
   お知らせ一覧（会員用）
   ================================================ */
function renderMemberNews(list) {
  const c = document.getElementById('news-member-list');
  if (!list.length) { c.innerHTML = '<p class="loading-msg">投稿はありません。</p>'; return; }

  c.innerHTML = list.map(item => {
    const isMine = item.authorEmail === MEMBER_INFO?.email;
    return `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-meta">
          <span class="admin-item-date">${esc(item.date)}</span>
          <span class="admin-item-cat">${esc(item.category)}</span>
          ${isMine ? '<span class="my-post-badge">自分の投稿</span>' : ''}
        </div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">${esc(item.body)}</p>
        ${item.authorName ? `<p style="font-size:.75rem;color:#888;margin-top:.3rem">投稿者：${esc(item.authorName)}</p>` : ''}
      </div>
      ${isMine ? `
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm news-edit-btn" data-id="${item.id}">編集</button>
        <button class="btn btn-danger  btn-sm news-del-btn"  data-id="${item.id}">削除</button>
      </div>` : ''}
    </div>`;
  }).join('');

  c.querySelectorAll('.news-edit-btn').forEach(b => b.addEventListener('click', () => openNewsForm(Number(b.dataset.id))));
  c.querySelectorAll('.news-del-btn').forEach(b => b.addEventListener('click', () => {
    const item = siteData.news.find(n => n.id === Number(b.dataset.id));
    openDeleteModal(`「${item?.title ?? ''}」を削除しますか？`, () => deleteNews(Number(b.dataset.id)));
  }));
}

function setupNewsForm() {
  const card = document.getElementById('news-form-card');
  document.getElementById('news-add-btn').addEventListener('click', () => openNewsForm(null));
  document.getElementById('news-form-cancel').addEventListener('click', () => { card.hidden = true; });

  document.getElementById('news-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId   = document.getElementById('news-edit-id').value;
    const date     = document.getElementById('news-date').value;
    const category = document.getElementById('news-category').value;
    const title    = document.getElementById('news-title').value.trim();
    const body     = document.getElementById('news-body').value.trim();
    if (!date || !title || !body) { alert('必須項目を入力してください'); return; }

    const res = await gasPost({
      action: 'memberPost',
      type:   'news',
      method: editId ? 'edit' : 'add',
      item:   { id: editId ? Number(editId) : undefined, date, category, title, body },
    });
    if (res.result !== 'success') { alert('エラー: ' + (res.message||'')); return; }

    // ローカル更新
    if (editId) {
      const idx = siteData.news.findIndex(n => n.id === Number(editId));
      if (idx !== -1) siteData.news[idx] = { ...siteData.news[idx], date, category, title, body };
    } else {
      siteData.news.unshift({ id: Date.now(), date, category, title, body, authorName: MEMBER_INFO.name, authorEmail: MEMBER_INFO.email });
    }
    renderMemberNews(siteData.news);
    card.hidden = true;
    showToast(editId ? '更新しました' : '投稿しました');
  });
}

function openNewsForm(id) {
  const card = document.getElementById('news-form-card');
  document.getElementById('news-form-title').textContent = id !== null ? '投稿を編集' : '新規お知らせ投稿';
  document.getElementById('news-edit-id').value = id !== null ? String(id) : '';
  if (id !== null) {
    const item = siteData.news.find(n => n.id === id); if (!item) return;
    document.getElementById('news-date').value     = item.date;
    document.getElementById('news-category').value = item.category;
    document.getElementById('news-title').value    = item.title;
    document.getElementById('news-body').value     = item.body;
  } else {
    document.getElementById('news-form').reset();
    document.getElementById('news-date').value = new Date().toISOString().slice(0,10);
  }
  card.hidden = false;
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

async function deleteNews(id) {
  const res = await gasPost({ action:'memberPost', type:'news', method:'delete', item:{ id } });
  if (res.result !== 'success') { alert('削除エラー: ' + (res.message||'')); return; }
  siteData.news = siteData.news.filter(n => n.id !== id);
  renderMemberNews(siteData.news);
  showToast('削除しました');
}

/* ================================================
   スケジュール一覧（会員用）
   ================================================ */
function renderMemberSchedule(list) {
  const c = document.getElementById('schedule-member-list');
  if (!list.length) { c.innerHTML = '<p class="loading-msg">イベントはありません。</p>'; return; }

  c.innerHTML = list.map(item => {
    const isMine = item.organizerEmail === MEMBER_INFO?.email;
    const count  = item.participants?.length ?? 0;
    return `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-meta">
          <span class="admin-item-date">${esc(item.date)}</span>
          ${isMine ? '<span class="my-post-badge">自分の企画</span>' : ''}
        </div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">📍 ${esc(item.location)}　${esc(item.detail)}</p>
        ${item.organizerName ? `<p style="font-size:.75rem;color:#888;margin-top:.3rem">企画者：${esc(item.organizerName)}</p>` : ''}
        <span class="participant-badge">👥 参加予定 ${count}名</span>
      </div>
      ${isMine ? `
      <div class="admin-item-actions">
        ${count > 0 ? `<button class="btn btn-sm notify-btn" data-id="${item.id}" style="background:#4a6741;color:#fff;border-color:#4a6741">📧 参加者に連絡</button>` : ''}
        <button class="btn btn-outline btn-sm sch-edit-btn" data-id="${item.id}">編集</button>
        <button class="btn btn-danger  btn-sm sch-del-btn"  data-id="${item.id}">削除</button>
      </div>` : ''}
    </div>`;
  }).join('');

  c.querySelectorAll('.sch-edit-btn').forEach(b => b.addEventListener('click', () => openScheduleForm(Number(b.dataset.id))));
  c.querySelectorAll('.sch-del-btn').forEach(b => b.addEventListener('click', () => {
    const item = siteData.schedule.find(s => s.id === Number(b.dataset.id));
    openDeleteModal(`「${item?.title ?? ''}」を削除しますか？`, () => deleteSchedule(Number(b.dataset.id)));
  }));
  c.querySelectorAll('.notify-btn').forEach(b => b.addEventListener('click', () => {
    openNotifyModal(Number(b.dataset.id));
  }));
}

function setupScheduleForm() {
  const card = document.getElementById('schedule-form-card');
  document.getElementById('schedule-add-btn').addEventListener('click', () => openScheduleForm(null));
  document.getElementById('schedule-form-cancel').addEventListener('click', () => { card.hidden = true; });

  document.getElementById('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId         = document.getElementById('schedule-edit-id').value;
    const date           = document.getElementById('schedule-date').value;
    const location       = document.getElementById('schedule-location').value.trim();
    const title          = document.getElementById('schedule-title').value.trim();
    const detail         = document.getElementById('schedule-detail').value.trim();
    const organizerEmail = document.getElementById('schedule-organizer-email').value.trim();
    if (!date || !location || !title || !organizerEmail) { alert('必須項目を入力してください'); return; }

    const submitBtn = document.querySelector('#schedule-form button[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = '送信中…';

    const res = await gasPost({
      action: 'memberPost',
      type:   'schedule',
      method: editId ? 'edit' : 'add',
      item:   { id: editId ? Number(editId) : undefined, date, title, location, detail, organizerEmail },
    });

    submitBtn.disabled    = false;
    submitBtn.textContent = editId ? '更新する' : '企画を投稿する';

    if (res.result !== 'success') { alert('エラー: ' + (res.message||'')); return; }

    if (editId) {
      const idx = siteData.schedule.findIndex(s => s.id === Number(editId));
      if (idx !== -1) siteData.schedule[idx] = { ...siteData.schedule[idx], date, title, location, detail };
    } else {
      siteData.schedule.push({
        id: Date.now(), date, title, location, detail,
        organizerName: MEMBER_INFO.name, organizerEmail, participants: []
      });
      siteData.schedule.sort((a,b) => a.date.localeCompare(b.date));
    }
    renderMemberSchedule(siteData.schedule);
    renderJoinList(siteData.schedule);
    card.hidden = true;
    showToast(editId ? '更新しました' : '企画を投稿しました！', '#4a6741');
  });
}

function openScheduleForm(id) {
  const card = document.getElementById('schedule-form-card');
  document.getElementById('schedule-form-title').textContent = id !== null ? 'イベントを編集' : '新規イベント企画';
  document.getElementById('schedule-edit-id').value = id !== null ? String(id) : '';
  if (id !== null) {
    const item = siteData.schedule.find(s => s.id === id); if (!item) return;
    document.getElementById('schedule-date').value             = item.date;
    document.getElementById('schedule-location').value         = item.location;
    document.getElementById('schedule-title').value            = item.title;
    document.getElementById('schedule-detail').value           = item.detail;
    document.getElementById('schedule-organizer-email').value  = item.organizerEmail ?? MEMBER_INFO.email;
  } else {
    document.getElementById('schedule-form').reset();
    document.getElementById('schedule-date').value            = new Date().toISOString().slice(0,10);
    document.getElementById('schedule-organizer-email').value = MEMBER_INFO?.email ?? '';
  }
  card.hidden = false;
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

async function deleteSchedule(id) {
  const res = await gasPost({ action:'memberPost', type:'schedule', method:'delete', item:{ id } });
  if (res.result !== 'success') { alert('削除エラー: ' + (res.message||'')); return; }
  siteData.schedule = siteData.schedule.filter(s => s.id !== id);
  renderMemberSchedule(siteData.schedule);
  renderJoinList(siteData.schedule);
  showToast('削除しました');
}

/* ================================================
   参加者へのメール通知モーダル
   ================================================ */
let notifyTargetId = null;

function openNotifyModal(scheduleId) {
  const item = siteData.schedule.find(s => s.id === scheduleId);
  if (!item) return;
  notifyTargetId = scheduleId;
  const count = item.participants?.length ?? 0;
  document.getElementById('notify-modal-event').textContent     = `イベント：${item.title}（${item.date}）`;
  document.getElementById('notify-participant-count').textContent = `送信先：参加者 ${count}名`;
  document.getElementById('notify-message').value               = '';
  document.getElementById('notify-error').hidden                = true;
  const modal = document.getElementById('notify-modal');
  modal.hidden = false;
  modal.style.display = '';
  document.getElementById('notify-message').focus();
}

function setupNotifyModal() {
  document.getElementById('notify-cancel-btn').addEventListener('click', () => {
    document.getElementById('notify-modal').hidden = true;
    notifyTargetId = null;
  });
  document.getElementById('notify-send-btn').addEventListener('click', async () => {
    const message = document.getElementById('notify-message').value.trim();
    const errEl   = document.getElementById('notify-error');
    if (!message) { errEl.textContent = 'メッセージを入力してください'; errEl.hidden = false; return; }
    const sendBtn       = document.getElementById('notify-send-btn');
    sendBtn.disabled    = true;
    sendBtn.textContent = '送信中…';
    errEl.hidden        = true;
    try {
      const res = await gasPost({ action:'notifyParticipants', scheduleId: notifyTargetId, message });
      if (res.result !== 'success') throw new Error(res.message || 'エラーが発生しました');
      document.getElementById('notify-modal').hidden = true;
      notifyTargetId = null;
      showToast(`参加者 ${res.count}名 にメールを送信しました`, '#4a6741');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.hidden      = false;
    } finally {
      sendBtn.disabled    = false;
      sendBtn.textContent = '送信する';
    }
  });
}

/* ================================================
   参加するイベント
   ================================================ */
function renderJoinList(list) {
  const c = document.getElementById('join-list');
  if (!list.length) { c.innerHTML = '<p class="loading-msg">イベントはありません。</p>'; return; }

  c.innerHTML = list.map(item => {
    const joined  = item.participants?.includes(MEMBER_INFO?.email);
    const isMine  = item.organizerEmail === MEMBER_INFO?.email;
    const count   = item.participants?.length ?? 0;
    return `
    <div class="join-item">
      <div class="join-item-header">
        <div class="join-item-info">
          <p class="join-item-date">${esc(item.date)}</p>
          <p class="join-item-title">${esc(item.title)}</p>
          <p class="join-item-location">📍 ${esc(item.location)}</p>
          <p class="join-item-detail">${esc(item.detail)}</p>
          ${item.organizerName ? `<p class="join-item-organizer">企画者：${esc(item.organizerName)}</p>` : ''}
          <span class="participant-badge">👥 参加予定 ${count}名</span>
        </div>
        <div style="flex-shrink:0">
          ${isMine
            ? '<span class="btn btn-sm btn-joined">自分の企画</span>'
            : joined
              ? '<span class="btn btn-sm btn-joined">参加済み ✓</span>'
              : `<button class="btn btn-join btn-sm join-btn" data-id="${item.id}">参加する</button>`
          }
        </div>
      </div>
    </div>`;
  }).join('');

  c.querySelectorAll('.join-btn').forEach(b => {
    b.addEventListener('click', () => joinEvent(Number(b.dataset.id), b));
  });
}

async function joinEvent(scheduleId, btn) {
  btn.disabled    = true;
  btn.textContent = '送信中…';
  const res = await gasPost({ action:'joinEvent', scheduleId });
  if (res.result !== 'success') {
    alert('エラー: ' + (res.message||''));
    btn.disabled    = false;
    btn.textContent = '参加する';
    return;
  }
  // ローカル更新
  const item = siteData.schedule.find(s => s.id === scheduleId);
  if (item) {
    if (!item.participants) item.participants = [];
    if (!item.participants.includes(MEMBER_INFO.email)) item.participants.push(MEMBER_INFO.email);
  }
  renderJoinList(siteData.schedule);
  showToast('参加しました！企画者にメールで通知されました', '#4a6741');
}

/* ================================================
   パスワード表示/非表示（全ページ共通）
   ================================================ */
function setupPasswordToggles() {
  document.querySelectorAll('.pass-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input    = document.getElementById(targetId);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type     = isHidden ? 'text' : 'password';
      btn.classList.toggle('active', isHidden);
      btn.setAttribute('aria-label', isHidden ? 'パスワードを隠す' : 'パスワードを表示');
      btn.querySelector('.eye-icon').textContent = isHidden ? '🙈' : '👁';
    });
  });
}

/* ================================================
   パスワード変更
   ================================================ */
function setupPasswordForm() {
  const form = document.getElementById('password-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPass = document.getElementById('current-pass').value;
    const newPass     = document.getElementById('new-pass').value;
    const confirmPass = document.getElementById('new-pass-confirm').value;
    const errEl       = document.getElementById('pass-error');
    const successEl   = document.getElementById('pass-success');

    errEl.textContent    = '';
    successEl.style.display = 'none';

    if (!currentPass || !newPass || !confirmPass) {
      errEl.textContent = 'すべての項目を入力してください'; return;
    }
    if (newPass.length < 8) {
      errEl.textContent = '新しいパスワードは8文字以上にしてください'; return;
    }
    if (newPass !== confirmPass) {
      errEl.textContent = '新しいパスワードが一致しません'; return;
    }
    if (currentPass === newPass) {
      errEl.textContent = '新しいパスワードは現在と異なるものにしてください'; return;
    }

    const submitBtn       = document.getElementById('pass-submit-btn');
    submitBtn.disabled    = true;
    submitBtn.textContent = '変更中…';

    try {
      const res = await gasPost({
        action:          'changePassword',
        currentPassword: currentPass,
        newPassword:     newPass,
      });
      if (res.result !== 'success') throw new Error(res.message || 'エラーが発生しました');
      form.reset();
      // 表示/非表示ボタンをリセット
      form.querySelectorAll('.pass-toggle-btn').forEach(btn => {
        const input = document.getElementById(btn.dataset.target);
        if (input) input.type = 'password';
        btn.classList.remove('active');
        btn.querySelector('.eye-icon').textContent = '👁';
      });
      successEl.style.display = 'block';
      showToast('パスワードを変更しました', '#4a6741');
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'パスワードを変更する';
    }
  });
}

/* ================================================
   起動
   ================================================ */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('delete-modal');
    if (modal) modal.hidden = true;
    setupPasswordToggles();
    setupLogin();
  });
} else {
  const modal = document.getElementById('delete-modal');
  if (modal) modal.hidden = true;
  setupPasswordToggles();
  setupLogin();
}
