/**
 * 街の語り部 — admin.js
 *
 * ★ セキュリティ設計
 *   1. パスワードはこのファイルに書かない
 *      → GASに送信してサーバー側で検証（クライアントに答えを置かない）
 *   2. GAS URLはこのファイルの定数に書く
 *      → admin.html / admin.js はGitHubに公開されるが、GAS URLを
 *        知っていてもパスワードなしでは管理操作を実行できない
 *        （全リクエストをGAS側でトークン検証する）
 *   3. セッショントークンはサーバー発行・クライアントに保持
 *      → ログイン成功時にGASがワンタイムトークンを返し、
 *        以降の操作はそのトークンをヘッダーに付けて送る
 *   4. ブルートフォース対策はGAS側で実施（5回失敗でロック）
 *
 * ★ GAS URLの設定方法
 *   下記 GAS_URL の値を、デプロイしたGASのURLに変更してください。
 *   このURLを知っているだけでは管理操作はできません（GAS側でパスワード検証します）。
 */
'use strict';

/* ================================================
   ▼ ここだけ設定する（パスワードは書かない）
   ================================================ */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxQB0eMo8HMiJ_wpVv_eB84Q3EmP5G1zSXyLIB9ft1ZmAgJUKIEpEdeHbQBC4MZRUdb/exec';

/* ================================================
   状態
   ================================================ */
let SESSION_TOKEN = ''; // GASから発行されるワンタイムセッショントークン
let siteData      = null;

/* ================================================
   GAS APIコール共通
   ================================================ */
async function gasRequest(payload) {
  if (GAS_URL.includes('YOUR_SCRIPT_ID')) return demoHandler(payload);
  try {
    const res  = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token: SESSION_TOKEN }),
      redirect: 'follow',
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      const form = new FormData();
      form.append('payload', JSON.stringify({ ...payload, token: SESSION_TOKEN }));
      const res2  = await fetch(GAS_URL, { method: 'POST', body: form, redirect: 'follow' });
      const text2 = await res2.text();
      try { return JSON.parse(text2); } catch { return { result: 'success' }; }
    }
  } catch (err) {
    console.error('gasRequest error:', err);
    throw new Error('サーバーへの接続に失敗しました');
  }
}

async function gasGet(params = {}) {
  if (GAS_URL.includes('YOUR_SCRIPT_ID')) {
    return demoHandler({ action: 'get', ...params });
  }
  const qs  = new URLSearchParams({ ...params, token: SESSION_TOKEN }).toString();
  const res = await fetch(`${GAS_URL}?${qs}`);
  return res.json();
}

/* ================================================
   デモモード（GAS未接続時の動作確認用）
   ================================================ */
function demoHandler(payload) {
  if (payload.action === 'login')      return { result:'success', token:'demo-token-123' };
  if (payload.action === 'updateData') return { result:'success' };
  if (payload.action === 'getMembers') return { result:'success', members: [
    { row:2, registeredAt:'2025-06-01 10:00:00', name:'山田 太郎', kana:'やまだ たろう',
      email:'yamada@example.com', phone:'090-0000-0001', skills:'日本語解説、英語' },
    { row:3, registeredAt:'2025-06-05 14:30:00', name:'佐藤 花子', kana:'さとう はなこ',
      email:'sato@example.com',   phone:'080-0000-0002', skills:'日本語解説、中国語' },
  ]};
  if (payload.action === 'deleteMember') return { result:'success' };
  if (payload.action === 'register')     return { result:'success' };
  return { result:'error', message:'不明なアクション' };
}

/* ================================================
   ログイン（パスワードをGASに送り、サーバー側で検証）
   ================================================ */
function setupLogin() {
  const loginScreen = document.getElementById('login-screen');
  const adminScreen = document.getElementById('admin-screen');
  const loginForm   = document.getElementById('login-form');
  const loginError  = document.getElementById('login-error');
  const passInput   = document.getElementById('admin-pass');
  const logoutBtn   = document.getElementById('logout-btn');

  // セッション復元（タブ内のみ）
  const saved = sessionStorage.getItem('admin_token');
  if (saved) {
    SESSION_TOKEN = saved;
    loginScreen.hidden = true;
    adminScreen.hidden = false;
    adminInit();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = '確認中…';
    loginError.hidden     = true;

    try {
      // パスワードをGAS側で検証 → トークンを受け取る
      const json = await gasRequest({
        action:   'login',
        password: passInput.value,
      });

      if (json.result === 'success' && json.token) {
        SESSION_TOKEN = json.token;
        sessionStorage.setItem('admin_token', SESSION_TOKEN);
        loginScreen.hidden = true;
        adminScreen.hidden = false;
        adminInit();
      } else {
        loginError.hidden     = false;
        loginError.textContent = json.message || 'パスワードが違います';
        passInput.value       = '';
        passInput.focus();
      }
    } catch (err) {
      loginError.hidden     = false;
      loginError.textContent = '接続エラーが発生しました。再度お試しください。';
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'ログイン';
    }
  });

  logoutBtn.addEventListener('click', () => {
    SESSION_TOKEN = '';
    sessionStorage.removeItem('admin_token');
    location.reload();
  });
}

/* ================================================
   管理画面の初期化
   ================================================ */
async function adminInit() {
  setupTabs();
  siteData = await loadAdminData();
  if (!siteData) return;

  renderAdminNews(siteData.news || []);
  renderAdminSchedule(siteData.schedule || []);
  setupNewsForm();
  setupScheduleForm();
  setupMembersTab();
  setupDeleteModal();
}

async function loadAdminData() {
  try {
    const res = await fetch('./data.json?' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.error('data.json 読み込みエラー:', e);
    return null;
  }
}

/* ================================================
   タブ切り替え
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
   削除確認モーダル
   ================================================ */
let pendingDeleteFn = null;
function setupDeleteModal() {
  document.getElementById('delete-confirm-btn').addEventListener('click', () => {
    if (pendingDeleteFn) { pendingDeleteFn(); pendingDeleteFn = null; }
    document.getElementById('delete-modal').hidden = true;
  });
  document.getElementById('delete-cancel-btn').addEventListener('click', () => {
    pendingDeleteFn = null;
    document.getElementById('delete-modal').hidden = true;
  });
}
function openDeleteModal(msg, onConfirm) {
  document.getElementById('delete-modal-msg').textContent = msg;
  pendingDeleteFn = onConfirm;
  document.getElementById('delete-modal').hidden = false;
}

/* ================================================
   ユーティリティ
   ================================================ */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
function newId(list) {
  if (!list?.length) return 1;
  return Math.max(...list.map(i => Number(i.id)||0)) + 1;
}
function showToast(msg) {
  let t = document.getElementById('admin-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'admin-toast';
    t.style.cssText = `position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);
      background:#1a1208;color:#f7f3eb;padding:.75rem 1.5rem;border-radius:4px;
      font-size:.88rem;z-index:9999;border-left:3px solid #b5861e;
      box-shadow:0 4px 16px rgba(0,0,0,.3);opacity:0;transition:opacity .3s;pointer-events:none;`;
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

/* ================================================
   お知らせ管理
   ================================================ */
function renderAdminNews(list) {
  const c = document.getElementById('news-admin-list');
  if (!list.length) { c.innerHTML = '<p class="loading-msg">お知らせはありません。</p>'; return; }
  c.innerHTML = list.map(item => `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-meta">
          <span class="admin-item-date">${esc(item.date)}</span>
          <span class="admin-item-cat">${esc(item.category)}</span>
        </div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">${esc(item.body)}</p>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm news-edit-btn" data-id="${esc(String(item.id))}">編集</button>
        <button class="btn btn-danger  btn-sm news-del-btn"  data-id="${esc(String(item.id))}">削除</button>
      </div>
    </div>`).join('');
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
    if (!date || !category || !title || !body) { alert('すべての必須項目を入力してください。'); return; }
    if (editId) {
      const idx = siteData.news.findIndex(n => n.id === Number(editId));
      if (idx !== -1) siteData.news[idx] = { id: Number(editId), date, category, title, body };
    } else {
      siteData.news.unshift({ id: newId(siteData.news), date, category, title, body });
    }
    const res = await gasRequest({ action: 'updateData', data: siteData });
    if (res.result !== 'success') { alert('保存に失敗しました: ' + (res.message||'')); return; }
    renderAdminNews(siteData.news);
    card.hidden = true;
    showToast(editId ? 'お知らせを更新しました' : 'お知らせを追加しました');
  });
}

function openNewsForm(id) {
  const card = document.getElementById('news-form-card');
  document.getElementById('news-form-title').textContent = id !== null ? 'お知らせを編集' : '新規お知らせ';
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
  siteData.news = siteData.news.filter(n => n.id !== id);
  const res = await gasRequest({ action: 'updateData', data: siteData });
  if (res.result !== 'success') { alert('削除に失敗しました'); return; }
  renderAdminNews(siteData.news);
  showToast('削除しました');
}

/* ================================================
   スケジュール管理
   ================================================ */
function renderAdminSchedule(list) {
  const c = document.getElementById('schedule-admin-list');
  if (!list.length) { c.innerHTML = '<p class="loading-msg">スケジュールはありません。</p>'; return; }
  c.innerHTML = list.map(item => `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-meta"><span class="admin-item-date">${esc(item.date)}</span></div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">📍 ${esc(item.location)}　${esc(item.detail)}</p>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm sch-edit-btn" data-id="${esc(String(item.id))}">編集</button>
        <button class="btn btn-danger  btn-sm sch-del-btn"  data-id="${esc(String(item.id))}">削除</button>
      </div>
    </div>`).join('');
  c.querySelectorAll('.sch-edit-btn').forEach(b => b.addEventListener('click', () => openScheduleForm(Number(b.dataset.id))));
  c.querySelectorAll('.sch-del-btn').forEach(b => b.addEventListener('click', () => {
    const item = siteData.schedule.find(s => s.id === Number(b.dataset.id));
    openDeleteModal(`「${item?.title ?? ''}」を削除しますか？`, () => deleteSchedule(Number(b.dataset.id)));
  }));
}

function setupScheduleForm() {
  const card = document.getElementById('schedule-form-card');
  document.getElementById('schedule-add-btn').addEventListener('click', () => openScheduleForm(null));
  document.getElementById('schedule-form-cancel').addEventListener('click', () => { card.hidden = true; });
  document.getElementById('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId   = document.getElementById('schedule-edit-id').value;
    const date     = document.getElementById('schedule-date').value;
    const location = document.getElementById('schedule-location').value.trim();
    const title    = document.getElementById('schedule-title').value.trim();
    const detail   = document.getElementById('schedule-detail').value.trim();
    if (!date || !location || !title) { alert('日付・場所・タイトルは必須です。'); return; }
    if (editId) {
      const idx = siteData.schedule.findIndex(s => s.id === Number(editId));
      if (idx !== -1) siteData.schedule[idx] = { id: Number(editId), date, title, location, detail };
    } else {
      siteData.schedule.push({ id: newId(siteData.schedule), date, title, location, detail });
      siteData.schedule.sort((a,b) => a.date.localeCompare(b.date));
    }
    const res = await gasRequest({ action: 'updateData', data: siteData });
    if (res.result !== 'success') { alert('保存に失敗しました: ' + (res.message||'')); return; }
    renderAdminSchedule(siteData.schedule);
    card.hidden = true;
    showToast(editId ? 'スケジュールを更新しました' : 'スケジュールを追加しました');
  });
}

function openScheduleForm(id) {
  const card = document.getElementById('schedule-form-card');
  document.getElementById('schedule-form-title').textContent = id !== null ? 'スケジュールを編集' : '新規スケジュール';
  document.getElementById('schedule-edit-id').value = id !== null ? String(id) : '';
  if (id !== null) {
    const item = siteData.schedule.find(s => s.id === id); if (!item) return;
    document.getElementById('schedule-date').value     = item.date;
    document.getElementById('schedule-location').value = item.location;
    document.getElementById('schedule-title').value    = item.title;
    document.getElementById('schedule-detail').value   = item.detail;
  } else {
    document.getElementById('schedule-form').reset();
    document.getElementById('schedule-date').value = new Date().toISOString().slice(0,10);
  }
  card.hidden = false;
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

async function deleteSchedule(id) {
  siteData.schedule = siteData.schedule.filter(s => s.id !== id);
  const res = await gasRequest({ action: 'updateData', data: siteData });
  if (res.result !== 'success') { alert('削除に失敗しました'); return; }
  renderAdminSchedule(siteData.schedule);
  showToast('削除しました');
}

/* ================================================
   会員一覧
   ================================================ */
function setupMembersTab() {
  document.getElementById('members-refresh-btn').addEventListener('click', loadMembers);
  document.querySelector('[data-tab="members"]')?.addEventListener('click', loadMembers);
}

async function loadMembers() {
  const c = document.getElementById('members-admin-list');
  c.innerHTML = '<p class="loading-msg">読み込み中…</p>';
  try {
    const json = await gasGet({ action: 'getMembers' });
    if (json.result !== 'success') throw new Error(json.message);
    renderMembers(json.members || []);
  } catch (e) {
    c.innerHTML = GAS_URL.includes('YOUR_SCRIPT_ID')
      ? `<div style="text-align:center;padding:2rem;color:#5a4e3c;font-size:.9rem;line-height:2">
           <p>デモ表示：GAS URLを設定すると実際の会員データが表示されます。</p>
           <p style="margin-top:1rem"><button class="btn btn-outline btn-sm" onclick="loadMembers()">デモデータを表示</button></p>
         </div>`
      : `<p class="error-msg">読み込みエラー：${esc(e.message)}</p>`;
  }
}

function renderMembers(members) {
  const c = document.getElementById('members-admin-list');
  if (!members.length) { c.innerHTML = '<p class="loading-msg">登録会員はいません。</p>'; return; }
  c.innerHTML = `
    <div class="members-table-wrap">
      <table class="members-table">
        <thead><tr><th>#</th><th>登録日</th><th>お名前</th><th>ふりがな</th><th>メール</th><th>電話</th><th>スキル</th><th>操作</th></tr></thead>
        <tbody>${members.map((m,i) => `
          <tr>
            <td>${i+1}</td>
            <td>${esc(m.registeredAt??'')}</td>
            <td>${esc(m.name??'')}</td>
            <td>${esc(m.kana??'')}</td>
            <td><a href="mailto:${esc(m.email??'')}" style="color:#b5861e">${esc(m.email??'')}</a></td>
            <td>${esc(m.phone??'')}</td>
            <td style="max-width:160px;white-space:normal">${esc(m.skills??'')}</td>
            <td><button class="btn btn-danger btn-sm member-del-btn" data-row="${esc(String(m.row??i))}">削除</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  c.querySelectorAll('.member-del-btn').forEach(b => {
    b.addEventListener('click', () => openDeleteModal('この会員を削除しますか？', () => deleteMember(b.dataset.row)));
  });
}

async function deleteMember(row) {
  const res = await gasRequest({ action: 'deleteMember', row });
  if (res.result !== 'success') { alert('削除に失敗しました：' + (res.message||'')); return; }
  showToast('会員を削除しました');
  loadMembers();
}

/* ================================================
   起動
   ================================================ */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // モーダルを確実に非表示にしてからログイン処理
    const modal = document.getElementById('delete-modal');
    if (modal) modal.hidden = true;
    setupLogin();
  });
} else {
  const modal = document.getElementById('delete-modal');
  if (modal) modal.hidden = true;
  setupLogin();
}
