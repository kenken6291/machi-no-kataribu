/**
 * 街の語り部 — admin.js（管理者ページ）
 *   - データはGASのスプレッドシートから取得（data.jsonは使わない）
 *   - 追加・編集・削除は項目単位でGASへ送信（会員の投稿を上書きしない）
 * ※ config.js → common.js の後に読み込むこと
 */
'use strict';

let SESSION_TOKEN = '';
let siteData = { news: [], schedule: [] };
let membersCache = [];
const $ = id => document.getElementById(id);

/* ================================================
   管理者API
   ================================================ */
async function api(payload) {
  const json = await gasPost({ ...payload, token: SESSION_TOKEN });
  if (json.result !== 'success') {
    if (isSessionError(json.message)) forceLogout(json.message);
    throw new Error(json.message || 'エラーが発生しました');
  }
  return json;
}
function forceLogout(msg) {
  SESSION_TOKEN = '';
  sessionStorage.removeItem('admin_token');
  $('admin-screen').hidden = true;
  $('login-screen').hidden = false;
  $('login-error').textContent = msg || '再度ログインしてください';
  $('login-error').hidden = false;
}
function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = text || '処理中…'; btn.disabled = true; }
  else      { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* ================================================
   ログイン
   ================================================ */
function setupLogin() {
  const loginForm = $('login-form');
  const loginError = $('login-error');
  const passInput = $('admin-pass');

  const saved = sessionStorage.getItem('admin_token');
  if (saved) { SESSION_TOKEN = saved; showAdmin(); }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    loginError.hidden = true;
    setBusy(btn, true, '確認中…');
    try {
      const json = await gasPost({ action: 'adminLogin', password: passInput.value });
      if (json.result !== 'success' || !json.token) throw new Error(json.message || 'パスワードが違います');
      SESSION_TOKEN = json.token;
      sessionStorage.setItem('admin_token', SESSION_TOKEN);
      passInput.value = '';
      showAdmin();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
      passInput.value = '';
      passInput.focus();
    } finally { setBusy(btn, false); }
  });

  $('logout-btn').addEventListener('click', () => {
    SESSION_TOKEN = '';
    sessionStorage.removeItem('admin_token');
    location.reload();
  });
}

let initialized = false;
function showAdmin() {
  $('login-screen').hidden = true;
  $('admin-screen').hidden = false;
  if (!initialized) {
    initialized = true;
    setupTabs();
    setupNewsForm();
    setupScheduleForm();
    setupMembersTab();
    setupDeleteModal();
  }
  loadAdminData();
}

async function loadAdminData() {
  ['news-admin-list', 'schedule-admin-list'].forEach(id => { $(id).innerHTML = '<p class="loading-msg">読み込み中…</p>'; });
  try {
    const json = await api({ action: 'getSiteDataFull' });
    applyData(json.data);
  } catch (e) {
    ['news-admin-list', 'schedule-admin-list'].forEach(id => {
      $(id).innerHTML = `<p class="error-msg">読み込みエラー：${esc(e.message)}</p>`;
    });
  }
}
function applyData(data) {
  siteData = data || { news: [], schedule: [] };
  siteData.news = siteData.news || [];
  siteData.schedule = siteData.schedule || [];
  renderAdminNews();
  renderAdminSchedule();
  renderStats();
}

function renderStats(memberCount) {
  if (typeof memberCount === 'number') renderStats.members = memberCount;
  const today = todayStr();
  const upcoming = siteData.schedule.filter(s => s.date >= today).length;
  $('admin-stats').innerHTML = `
    <div class="admin-stat"><b>${renderStats.members ?? '—'}</b><span>登録会員</span></div>
    <div class="admin-stat"><b>${siteData.news.length}</b><span>お知らせ</span></div>
    <div class="admin-stat"><b>${upcoming}</b><span>これからのイベント</span></div>`;
}

/* ================================================
   タブ・削除モーダル
   ================================================ */
function setupTabs() {
  const tabs = document.querySelectorAll('.admin-tab');
  const panels = document.querySelectorAll('.admin-panel');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    panels.forEach(p => { const on = p.id === 'tab-' + tab.dataset.tab; p.classList.toggle('active', on); p.hidden = !on; });
  }));
  panels.forEach((p, i) => { p.hidden = i !== 0; p.classList.toggle('active', i === 0); });
}

let pendingDeleteFn = null;
function setupDeleteModal() {
  $('delete-confirm-btn').addEventListener('click', () => {
    const fn = pendingDeleteFn; pendingDeleteFn = null;
    $('delete-modal').hidden = true;
    if (fn) fn();
  });
  $('delete-cancel-btn').addEventListener('click', () => { pendingDeleteFn = null; $('delete-modal').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('delete-cancel-btn').click(); });
}
function openDeleteModal(msg, onConfirm) {
  $('delete-modal-msg').textContent = msg;
  pendingDeleteFn = onConfirm;
  $('delete-modal').hidden = false;
}

async function adminPost(type, method, item, okMsg) {
  try {
    const json = await api({ action: 'adminPost', type, method, item });
    applyData(json.data);
    showToast(okMsg, '#4a6741');
    return true;
  } catch (err) {
    showToast('失敗しました：' + err.message, '#8a2c1e');
    return false;
  }
}

/* ================================================
   お知らせ管理
   ================================================ */
function renderAdminNews() {
  const c = $('news-admin-list');
  const list = [...siteData.news].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.id - a.id));
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
        <p style="font-size:.75rem;color:#888;margin-top:.3rem">投稿者：${esc(item.authorName || '事務局')}</p>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm" data-act="edit" data-id="${item.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-act="del" data-id="${item.id}">削除</button>
      </div>
    </div>`).join('');
}

function setupNewsForm() {
  const card = $('news-form-card');
  $('news-add-btn').addEventListener('click', () => openNewsForm(null));
  $('news-form-cancel').addEventListener('click', () => { card.hidden = true; });
  $('news-admin-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'edit') openNewsForm(id);
    if (b.dataset.act === 'del') {
      const item = siteData.news.find(n => n.id === id);
      openDeleteModal(`「${item?.title ?? ''}」を削除しますか？`, () => adminPost('news', 'delete', { id }, '削除しました'));
    }
  });
  $('news-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('news-edit-id').value;
    const item = {
      id: editId ? Number(editId) : undefined,
      date: $('news-date').value, category: $('news-category').value,
      title: $('news-title').value.trim(), body: $('news-body').value.trim(),
    };
    if (!item.date || !item.title || !item.body) { showToast('すべての必須項目を入力してください', '#8a2c1e'); return; }
    const btn = $('news-form').querySelector('button[type="submit"]');
    setBusy(btn, true, '保存中…');
    if (await adminPost('news', editId ? 'edit' : 'add', item, editId ? 'お知らせを更新しました' : 'お知らせを追加しました')) card.hidden = true;
    setBusy(btn, false);
  });
}

function openNewsForm(id) {
  const card = $('news-form-card');
  $('news-form-title').textContent = id !== null ? 'お知らせを編集' : '新規お知らせ';
  $('news-edit-id').value = id !== null ? String(id) : '';
  if (id !== null) {
    const item = siteData.news.find(n => n.id === id); if (!item) return;
    $('news-date').value = item.date; $('news-category').value = item.category;
    $('news-title').value = item.title; $('news-body').value = item.body;
  } else {
    $('news-form').reset();
    $('news-date').value = todayStr();
  }
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================
   スケジュール管理
   ================================================ */
function renderAdminSchedule() {
  const c = $('schedule-admin-list');
  const list = [...siteData.schedule].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!list.length) { c.innerHTML = '<p class="loading-msg">スケジュールはありません。</p>'; return; }
  const today = todayStr();
  c.innerHTML = list.map(item => `
    <div class="admin-item"${item.date < today ? ' style="opacity:.65"' : ''}>
      <div class="admin-item-info">
        <div class="admin-item-meta"><span class="admin-item-date">${esc(item.date)}${item.time ? ' ' + esc(item.time) + '〜' : ''}</span>${item.date < today ? '<span class="admin-item-cat">終了</span>' : ''}</div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">📍 ${esc(item.location)}　${esc(item.detail)}</p>
        <p style="font-size:.75rem;color:#888;margin-top:.3rem">企画：${esc(item.organizerName || '事務局')}　👥 ${item.participantCount || 0}名${item.capacity ? ' ／ 定員' + item.capacity + '名' : ''}</p>
        ${item.participantNames?.length ? `<p style="font-size:.75rem;color:#4a6741;margin-top:.2rem">参加者：${item.participantNames.map(esc).join('、')}</p>` : ''}
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm" data-act="edit" data-id="${item.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-act="del" data-id="${item.id}">削除</button>
      </div>
    </div>`).join('');
}

function setupScheduleForm() {
  const card = $('schedule-form-card');
  $('schedule-add-btn').addEventListener('click', () => openScheduleForm(null));
  $('schedule-form-cancel').addEventListener('click', () => { card.hidden = true; });
  $('schedule-admin-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'edit') openScheduleForm(id);
    if (b.dataset.act === 'del') {
      const item = siteData.schedule.find(s => s.id === id);
      openDeleteModal(`「${item?.title ?? ''}」を削除しますか？${item?.participantCount ? `（参加予定 ${item.participantCount}名）` : ''}`,
        () => adminPost('schedule', 'delete', { id }, '削除しました'));
    }
  });
  $('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('schedule-edit-id').value;
    const item = {
      id: editId ? Number(editId) : undefined,
      date: $('schedule-date').value, time: $('schedule-time').value,
      location: $('schedule-location').value.trim(), capacity: Number($('schedule-capacity').value) || 0,
      title: $('schedule-title').value.trim(), detail: $('schedule-detail').value.trim(),
    };
    if (!item.date || !item.location || !item.title) { showToast('日付・場所・タイトルは必須です', '#8a2c1e'); return; }
    const btn = $('schedule-form').querySelector('button[type="submit"]');
    setBusy(btn, true, '保存中…');
    if (await adminPost('schedule', editId ? 'edit' : 'add', item, editId ? 'スケジュールを更新しました' : 'スケジュールを追加しました')) card.hidden = true;
    setBusy(btn, false);
  });
}

function openScheduleForm(id) {
  const card = $('schedule-form-card');
  $('schedule-form-title').textContent = id !== null ? 'スケジュールを編集' : '新規スケジュール';
  $('schedule-edit-id').value = id !== null ? String(id) : '';
  if (id !== null) {
    const item = siteData.schedule.find(s => s.id === id); if (!item) return;
    $('schedule-date').value = item.date; $('schedule-time').value = item.time || '';
    $('schedule-location').value = item.location; $('schedule-capacity').value = item.capacity || 0;
    $('schedule-title').value = item.title; $('schedule-detail').value = item.detail || '';
  } else {
    $('schedule-form').reset();
    $('schedule-date').value = todayStr();
    $('schedule-capacity').value = 0;
  }
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================
   会員一覧
   ================================================ */
function setupMembersTab() {
  $('members-refresh-btn').addEventListener('click', loadMembers);
  document.querySelector('[data-tab="members"]')?.addEventListener('click', () => { if (!membersCache.length) loadMembers(); });
  $('members-search').addEventListener('input', () => renderMembers());
  $('members-csv-btn').addEventListener('click', downloadMembersCsv);
  $('members-admin-list').addEventListener('click', e => {
    const b = e.target.closest('.member-del-btn'); if (!b) return;
    const m = membersCache.find(x => String(x.row) === b.dataset.row);
    openDeleteModal(`会員「${m?.nickname || m?.name || ''}」を削除しますか？この操作は取り消せません。`, () => deleteMember(m));
  });
  // 会員数を統計に出すため最初に1回読み込む
  loadMembers();
}

async function loadMembers() {
  const c = $('members-admin-list');
  c.innerHTML = '<p class="loading-msg">読み込み中…</p>';
  try {
    const json = await gasGet({ action: 'getMembers', token: SESSION_TOKEN });
    if (json.result !== 'success') {
      if (isSessionError(json.message)) forceLogout(json.message);
      throw new Error(json.message);
    }
    membersCache = json.members || [];
    renderStats(membersCache.length);
    renderMembers();
  } catch (e) {
    c.innerHTML = `<p class="error-msg">読み込みエラー：${esc(e.message)}</p>`;
  }
}

function renderMembers() {
  const c = $('members-admin-list');
  const q = $('members-search').value.trim().toLowerCase();
  const list = membersCache.filter(m => !q ||
    [m.name, m.kana, m.nickname, m.email, m.skills].some(v => String(v ?? '').toLowerCase().includes(q)));
  if (!membersCache.length) { c.innerHTML = '<p class="loading-msg">登録会員はいません。</p>'; return; }
  if (!list.length) { c.innerHTML = '<p class="loading-msg">該当する会員はいません。</p>'; return; }
  c.innerHTML = `
    <p style="font-size:.8rem;color:#5a4e3c;margin-bottom:.5rem">${list.length}名を表示中</p>
    <div class="members-table-wrap">
      <table class="members-table">
        <thead><tr><th>#</th><th>登録日</th><th>お名前</th><th>ふりがな</th><th>ニックネーム</th><th>メール</th><th>電話</th><th>スキル</th><th>メッセージ</th><th>状態</th><th>操作</th></tr></thead>
        <tbody>${list.map((m, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${esc(String(m.registeredAt ?? '').slice(0, 10))}</td>
            <td>${esc(m.name ?? '')}</td>
            <td>${esc(m.kana ?? '')}</td>
            <td>${esc(m.nickname ?? '')}</td>
            <td><a href="mailto:${esc(m.email ?? '')}" style="color:#b5861e">${esc(m.email ?? '')}</a></td>
            <td>${esc(m.phone ?? '')}</td>
            <td style="max-width:160px;white-space:normal">${esc(m.skills ?? '')}</td>
            <td style="max-width:200px;white-space:normal;font-size:.78rem">${esc(m.message ?? '')}</td>
            <td>${m.mustChangePassword ? '<span class="status-pill">仮パスワード</span>' : ''}</td>
            <td><button class="btn btn-danger btn-sm member-del-btn" data-row="${esc(String(m.row))}">削除</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function deleteMember(m) {
  if (!m) return;
  try {
    await api({ action: 'deleteMember', row: m.row, email: m.email });
    showToast('会員を削除しました', '#4a6741');
  } catch (err) { showToast('削除に失敗しました：' + err.message, '#8a2c1e'); }
  loadMembers();
}

function downloadMembersCsv() {
  if (!membersCache.length) { showToast('会員データがありません'); return; }
  const cols = [['registeredAt', '登録日時'], ['name', 'お名前'], ['kana', 'ふりがな'], ['nickname', 'ニックネーム'],
    ['email', 'メール'], ['phone', '電話'], ['skills', 'スキル'], ['message', 'メッセージ']];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(c => cell(c[1])).join(','),
    ...membersCache.map(m => cols.map(c => cell(m[c[0]])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `kataribu-members-${todayStr()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ================================================
   起動
   ================================================ */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupLogin);
else setupLogin();
