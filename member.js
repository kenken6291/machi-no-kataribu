/**
 * 街の語り部 — member.js（会員ページ）
 * ログイン・パスワード再発行・お知らせ投稿・イベント企画/参加・AIアシスタント・アカウント設定
 * ※ config.js → common.js の後に読み込むこと
 */
'use strict';

/* ================================================
   状態
   ================================================ */
let SESSION_TOKEN = '';
let MEMBER_INFO   = null; // { name, nickname, email, row, mustChangePassword }
let siteData      = { news: [], schedule: [] };
const $ = id => document.getElementById(id);

/* ================================================
   会員API（セッション切れは自動でログイン画面へ）
   ================================================ */
async function api(payload, timeoutMs) {
  const json = await gasPost({ ...payload, token: SESSION_TOKEN }, timeoutMs);
  if (json.result !== 'success') {
    if (isSessionError(json.message)) forceLogout(json.message);
    throw new Error(json.message || 'エラーが発生しました');
  }
  return json;
}

function forceLogout(msg) {
  sessionStorage.removeItem('member_token');
  sessionStorage.removeItem('member_info');
  SESSION_TOKEN = '';
  $('member-screen').hidden = true;
  $('login-screen').hidden  = false;
  const err = $('login-error');
  err.textContent = msg || '再度ログインしてください';
  err.hidden = false;
}

/* 確認モーダル（Promise） */
function confirmDialog(msg, { title = '確認', ok = 'OK', danger = true } = {}) {
  return new Promise(resolve => {
    $('confirm-modal-title').textContent = title;
    $('confirm-modal-msg').textContent   = msg;
    const okBtn = $('confirm-ok-btn');
    okBtn.textContent = ok;
    okBtn.className = 'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-primary');
    $('confirm-modal').hidden = false;
    const done = v => {
      $('confirm-modal').hidden = true;
      okBtn.onclick = null; $('confirm-cancel-btn').onclick = null;
      resolve(v);
    };
    okBtn.onclick = () => done(true);
    $('confirm-cancel-btn').onclick = () => done(false);
  });
}

function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = busyText || '処理中…'; btn.disabled = true; }
  else      { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* ================================================
   ログイン・再発行
   ================================================ */
function setupLogin() {
  const loginForm  = $('login-form');
  const forgotForm = $('forgot-form');
  const loginError = $('login-error');

  // セッション復元
  const saved = sessionStorage.getItem('member_token');
  const info  = sessionStorage.getItem('member_info');
  if (saved && info) {
    try {
      SESSION_TOKEN = saved;
      MEMBER_INFO   = JSON.parse(info);
      showMemberScreen();
    } catch (e) {
      sessionStorage.removeItem('member_token');
      sessionStorage.removeItem('member_info');
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    loginError.hidden = true;
    const email    = $('member-email').value.trim();
    const password = $('member-pass').value;
    if (!email || !password) { loginError.textContent = 'メールアドレスとパスワードを入力してください'; loginError.hidden = false; return; }

    setBusy(btn, true, '確認中…');
    try {
      const json = await gasPost({ action: 'memberLogin', email, password });
      if (json.result !== 'success') throw new Error(json.message || 'ログインに失敗しました');
      SESSION_TOKEN = json.token;
      MEMBER_INFO = {
        name: json.name, nickname: json.nickname, email: json.email, row: json.row,
        mustChangePassword: !!json.mustChangePassword,
      };
      sessionStorage.setItem('member_token', SESSION_TOKEN);
      sessionStorage.setItem('member_info',  JSON.stringify(MEMBER_INFO));
      $('member-pass').value = '';
      showMemberScreen();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    } finally { setBusy(btn, false); }
  });

  $('forgot-open').addEventListener('click', () => {
    loginForm.hidden = true; forgotForm.hidden = false;
    $('forgot-email').value = $('member-email').value;
    $('forgot-msg').hidden = true;
  });
  $('forgot-close').addEventListener('click', () => { forgotForm.hidden = true; loginForm.hidden = false; });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('forgot-msg');
    const email = $('forgot-email').value.trim();
    msg.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.className = 'forgot-msg is-error'; msg.textContent = '正しいメールアドレスを入力してください'; msg.hidden = false; return;
    }
    const btn = $('forgot-submit');
    setBusy(btn, true, '送信中…');
    try {
      const json = await gasPost({ action: 'requestPasswordReset', email });
      if (json.result !== 'success') throw new Error(json.message);
      msg.className = 'forgot-msg'; msg.textContent = json.message + '。メールが届かない場合は迷惑メールフォルダもご確認ください。';
    } catch (err) {
      msg.className = 'forgot-msg is-error'; msg.textContent = err.message;
    } finally { msg.hidden = false; setBusy(btn, false); }
  });

  $('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('member_token');
    sessionStorage.removeItem('member_info');
    location.reload();
  });
}

let initialized = false;
function showMemberScreen() {
  $('login-screen').hidden  = true;
  $('member-screen').hidden = false;
  $('member-name-display').textContent = (MEMBER_INFO.nickname || MEMBER_INFO.name) + ' さん';
  if (!initialized) { initialized = true; memberInit(); }
  else refreshData();
}

/* ================================================
   会員画面初期化
   ================================================ */
async function memberInit() {
  setupTabs();
  setupNewsForm();
  setupScheduleForm();
  setupNotifyModal();
  setupJoinTab();
  setupAiTab();
  setupPasswordForm();
  setupNicknameForm();
  if (MEMBER_INFO?.mustChangePassword) { applyForcedPasswordChange(); return; }
  await refreshData();
}

async function refreshData() {
  ['news-member-list', 'schedule-member-list', 'join-list'].forEach(id => {
    $(id).innerHTML = '<p class="loading-msg">読み込み中…</p>';
  });
  try {
    const json = await api({ action: 'getMemberData' });
    siteData = json.data || { news: [], schedule: [] };
  } catch (e) {
    ['news-member-list', 'schedule-member-list', 'join-list'].forEach(id => {
      $(id).innerHTML = `<p class="error-msg">読み込みに失敗しました：${esc(e.message)}<br><button class="btn btn-outline btn-sm retry-btn">再読み込み</button></p>`;
    });
    document.querySelectorAll('.retry-btn').forEach(b => b.addEventListener('click', refreshData));
    return;
  }
  renderAll();
}

function renderAll() {
  renderMemberNews();
  renderMemberSchedule();
  renderJoinList();
}

/* ================================================
   初回ログイン時のパスワード変更強制
   ================================================ */
function applyForcedPasswordChange() {
  $('force-pass-banner').hidden = false;
  document.querySelectorAll('.admin-tab').forEach(tab => {
    if (tab.dataset.tab !== 'account') tab.setAttribute('disabled', 'disabled');
  });
  activateTab('account');
}
async function clearForcedPasswordChange() {
  MEMBER_INFO.mustChangePassword = false;
  sessionStorage.setItem('member_info', JSON.stringify(MEMBER_INFO));
  $('force-pass-banner').hidden = true;
  document.querySelectorAll('.admin-tab').forEach(tab => tab.removeAttribute('disabled'));
  await refreshData();
  activateTab('news');
}

/* ================================================
   タブ
   ================================================ */
function activateTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.admin-panel').forEach(p => {
    const on = p.id === 'tab-' + name;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
  try { sessionStorage.setItem('member_tab', name); } catch (e) { /* ignore */ }
}
function setupTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
  let last = 'news';
  try { last = sessionStorage.getItem('member_tab') || 'news'; } catch (e) { /* ignore */ }
  activateTab(document.getElementById('tab-' + last) ? last : 'news');
}

/* ================================================
   お知らせ
   ================================================ */
function renderMemberNews() {
  const c = $('news-member-list');
  const list = siteData.news || [];
  if (!list.length) { c.innerHTML = '<p class="loading-msg">投稿はまだありません。最初のお知らせを書いてみましょう。</p>'; return; }
  const sorted = [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.id - a.id));
  c.innerHTML = sorted.map(item => `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-meta">
          <span class="admin-item-date">${esc(item.date)}</span>
          <span class="admin-item-cat">${esc(item.category)}</span>
          ${item.mine ? '<span class="my-post-badge">自分の投稿</span>' : ''}
        </div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">${esc(item.body)}</p>
        ${item.authorName ? `<p class="item-author">投稿者：${esc(item.authorName)}</p>` : ''}
      </div>
      ${item.mine ? `
      <div class="admin-item-actions">
        <button class="btn btn-outline btn-sm" data-act="edit" data-id="${item.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-act="del" data-id="${item.id}">削除</button>
      </div>` : ''}
    </div>`).join('');
}

function setupNewsForm() {
  const card = $('news-form-card');
  $('news-add-btn').addEventListener('click', () => openNewsForm(null));
  $('news-form-cancel').addEventListener('click', () => { card.hidden = true; });

  $('news-member-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'edit') openNewsForm(id);
    if (b.dataset.act === 'del') {
      const item = siteData.news.find(n => n.id === id);
      if (!await confirmDialog(`「${item?.title ?? ''}」を削除しますか？`, { title: '削除の確認', ok: '削除する' })) return;
      try {
        await api({ action: 'memberPost', type: 'news', method: 'delete', item: { id } });
        showToast('削除しました');
        refreshData();
      } catch (err) { showToast('削除エラー：' + err.message, '#8a2c1e'); }
    }
  });

  $('news-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('news-edit-id').value;
    const item = {
      id: editId ? Number(editId) : undefined,
      date: $('news-date').value,
      category: $('news-category').value,
      title: $('news-title').value.trim(),
      body: $('news-body').value.trim(),
    };
    if (!item.date || !item.title || !item.body) { showToast('日付・タイトル・本文を入力してください', '#8a2c1e'); return; }
    const btn = e.submitter || $('news-form').querySelector('button[type="submit"]');
    setBusy(btn, true, '送信中…');
    try {
      await api({ action: 'memberPost', type: 'news', method: editId ? 'edit' : 'add', item });
      card.hidden = true;
      showToast(editId ? '更新しました' : '投稿しました', '#4a6741');
      refreshData();
    } catch (err) { showToast('エラー：' + err.message, '#8a2c1e'); }
    finally { setBusy(btn, false); }
  });

  // AIで文章を整える
  let undo = null;
  $('news-ai-btn').addEventListener('click', async () => {
    const body = $('news-body').value.trim();
    if (!body) { showToast('本文（メモ書きでOK）を入力してください', '#8a2c1e'); return; }
    const btn = $('news-ai-btn');
    setBusy(btn, true, '✨ AIが作成中…');
    try {
      const r = await aiRequest('news', { title: $('news-title').value, body, category: $('news-category').value });
      undo = { title: $('news-title').value, body: $('news-body').value };
      const m = r.text.match(/タイトル[:：]\s*(.+)\n+本文[:：]\s*\n?([\s\S]+)/);
      if (m) { $('news-title').value = m[1].trim().slice(0, 100); $('news-body').value = m[2].trim(); }
      else   { $('news-body').value = r.text; }
      $('news-ai-undo').hidden = false;
      showToast('文章を整えました。内容を確認してから投稿してください', '#4a6741');
    } catch (err) { showToast(err.message, '#8a2c1e'); }
    finally { setBusy(btn, false); }
  });
  $('news-ai-undo').addEventListener('click', () => {
    if (!undo) return;
    $('news-title').value = undo.title; $('news-body').value = undo.body;
    undo = null; $('news-ai-undo').hidden = true;
  });
}

function openNewsForm(id, preset) {
  const card = $('news-form-card');
  $('news-form-title').textContent = id !== null ? '投稿を編集' : '新規お知らせ投稿';
  $('news-edit-id').value = id !== null ? String(id) : '';
  $('news-ai-undo').hidden = true;
  if (id !== null) {
    const item = siteData.news.find(n => n.id === id); if (!item) return;
    $('news-date').value     = item.date;
    $('news-category').value = item.category;
    $('news-title').value    = item.title;
    $('news-body').value     = item.body;
  } else {
    $('news-form').reset();
    $('news-date').value = todayStr();
    if (preset) { $('news-title').value = preset.title || ''; $('news-body').value = preset.body || ''; $('news-category').value = preset.category || 'お知らせ'; }
  }
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================
   イベント企画（自分の企画の管理）
   ================================================ */
function scheduleWhen(item) { return `${esc(item.date)}${item.time ? ' ' + esc(item.time) + '〜' : ''}`; }
function countBadge(item) {
  const cap = Number(item.capacity) || 0;
  const full = cap && item.participantCount >= cap;
  return `<span class="participant-badge${full ? ' is-full' : ''}">👥 参加予定 ${item.participantCount}名${cap ? ` ／ 定員${cap}名` : ''}${full ? '（満員）' : ''}</span>`;
}

function renderMemberSchedule() {
  const c = $('schedule-member-list');
  const list = siteData.schedule || [];
  if (!list.length) { c.innerHTML = '<p class="loading-msg">イベントはまだありません。</p>'; return; }
  // 自分の企画を先頭に、日付の新しい順
  const sorted = [...list].sort((a, b) => (b.mine - a.mine) || String(b.date).localeCompare(String(a.date)));
  c.innerHTML = sorted.map(item => `
    <div class="admin-item${item.mine ? ' is-mine' : ''}">
      <div class="admin-item-info">
        <div class="admin-item-meta">
          <span class="admin-item-date">${scheduleWhen(item)}</span>
          ${item.date < todayStr() ? '<span class="past-badge">終了</span>' : ''}
          ${item.mine ? '<span class="my-post-badge">自分の企画</span>' : ''}
        </div>
        <p class="admin-item-title">${esc(item.title)}</p>
        <p class="admin-item-body">📍 ${esc(item.location)}　${esc(item.detail)}</p>
        ${item.organizerName ? `<p class="item-author">企画者：${esc(item.organizerName)}</p>` : ''}
        ${countBadge(item)}
        ${item.mine && item.participantNames?.length ? `<p class="participant-names">参加者：${item.participantNames.map(esc).join('、')}</p>` : ''}
      </div>
      ${item.mine ? `
      <div class="admin-item-actions">
        ${item.participantCount > 0 ? `<button class="btn btn-sm btn-join" data-act="notify" data-id="${item.id}">📧 参加者に連絡</button>` : ''}
        <button class="btn btn-outline btn-sm" data-act="edit" data-id="${item.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-act="del" data-id="${item.id}">削除</button>
      </div>` : ''}
    </div>`).join('');
}

function setupScheduleForm() {
  const card = $('schedule-form-card');
  $('schedule-add-btn').addEventListener('click', () => openScheduleForm(null));
  $('schedule-form-cancel').addEventListener('click', () => { card.hidden = true; });

  $('schedule-member-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id);
    const item = siteData.schedule.find(s => s.id === id);
    if (b.dataset.act === 'edit') openScheduleForm(id);
    if (b.dataset.act === 'notify') openNotifyModal(id);
    if (b.dataset.act === 'del') {
      const extra = item?.participantCount ? `\n参加予定の${item.participantCount}名には自動で連絡されません。必要なら先に「参加者に連絡」してください。` : '';
      if (!await confirmDialog(`「${item?.title ?? ''}」を削除しますか？${extra}`, { title: '削除の確認', ok: '削除する' })) return;
      try {
        await api({ action: 'memberPost', type: 'schedule', method: 'delete', item: { id } });
        showToast('削除しました');
        refreshData();
      } catch (err) { showToast('削除エラー：' + err.message, '#8a2c1e'); }
    }
  });

  $('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('schedule-edit-id').value;
    const item = {
      id: editId ? Number(editId) : undefined,
      date: $('schedule-date').value,
      time: $('schedule-time').value,
      location: $('schedule-location').value.trim(),
      capacity: Number($('schedule-capacity').value) || 0,
      title: $('schedule-title').value.trim(),
      detail: $('schedule-detail').value.trim(),
      organizerEmail: $('schedule-organizer-email').value.trim(),
    };
    if (!item.date || !item.location || !item.title || !item.organizerEmail) { showToast('必須項目を入力してください', '#8a2c1e'); return; }
    const btn = $('schedule-submit');
    setBusy(btn, true, '送信中…');
    try {
      await api({ action: 'memberPost', type: 'schedule', method: editId ? 'edit' : 'add', item });
      card.hidden = true;
      showToast(editId ? '更新しました' : '企画を投稿しました！', '#4a6741');
      refreshData();
    } catch (err) { showToast('エラー：' + err.message, '#8a2c1e'); }
    finally { setBusy(btn, false); }
  });

  // AIで案内文を作る
  let undo = null;
  $('schedule-ai-btn').addEventListener('click', async () => {
    const input = {
      title: $('schedule-title').value, date: $('schedule-date').value, time: $('schedule-time').value,
      location: $('schedule-location').value, capacity: $('schedule-capacity').value, detail: $('schedule-detail').value,
    };
    if (!input.title.trim() && !input.detail.trim()) { showToast('タイトルかメモを入力してください', '#8a2c1e'); return; }
    const btn = $('schedule-ai-btn');
    setBusy(btn, true, '✨ AIが作成中…');
    try {
      const r = await aiRequest('event', input);
      undo = $('schedule-detail').value;
      $('schedule-detail').value = r.text;
      $('schedule-ai-undo').hidden = false;
      showToast('案内文を作成しました。内容を確認してください', '#4a6741');
    } catch (err) { showToast(err.message, '#8a2c1e'); }
    finally { setBusy(btn, false); }
  });
  $('schedule-ai-undo').addEventListener('click', () => {
    if (undo === null) return;
    $('schedule-detail').value = undo; undo = null; $('schedule-ai-undo').hidden = true;
  });
}

function openScheduleForm(id) {
  const card = $('schedule-form-card');
  $('schedule-form-title').textContent = id !== null ? 'イベントを編集' : '新規イベント企画';
  $('schedule-submit').textContent = id !== null ? '更新する' : '企画を投稿する';
  $('schedule-edit-id').value = id !== null ? String(id) : '';
  $('schedule-ai-undo').hidden = true;
  if (id !== null) {
    const item = siteData.schedule.find(s => s.id === id); if (!item) return;
    $('schedule-date').value     = item.date;
    $('schedule-time').value     = item.time || '';
    $('schedule-location').value = item.location;
    $('schedule-capacity').value = item.capacity || 0;
    $('schedule-title').value    = item.title;
    $('schedule-detail').value   = item.detail || '';
    $('schedule-organizer-email').value = item.organizerEmail || MEMBER_INFO.email;
  } else {
    $('schedule-form').reset();
    $('schedule-date').value = todayStr();
    $('schedule-capacity').value = 0;
    $('schedule-organizer-email').value = MEMBER_INFO?.email ?? '';
  }
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================
   参加者へのメール通知
   ================================================ */
let notifyTargetId = null;
function openNotifyModal(scheduleId) {
  const item = siteData.schedule.find(s => s.id === scheduleId);
  if (!item) return;
  notifyTargetId = scheduleId;
  $('notify-modal-event').textContent = `イベント：${item.title}（${item.date}${item.time ? ' ' + item.time : ''}）`;
  $('notify-participant-count').textContent = `送信先：参加者 ${item.participantCount}名（BCCで送信。あなたにも控えが届きます）`;
  $('notify-message').value = '';
  $('notify-error').hidden = true;
  $('notify-modal').hidden = false;
  $('notify-message').focus();
}
function setupNotifyModal() {
  $('notify-cancel-btn').addEventListener('click', () => { $('notify-modal').hidden = true; notifyTargetId = null; });
  $('notify-send-btn').addEventListener('click', async () => {
    const message = $('notify-message').value.trim();
    const errEl = $('notify-error');
    if (!message) { errEl.textContent = 'メッセージを入力してください'; errEl.hidden = false; return; }
    const btn = $('notify-send-btn');
    setBusy(btn, true, '送信中…');
    errEl.hidden = true;
    try {
      const res = await api({ action: 'notifyParticipants', scheduleId: notifyTargetId, message });
      $('notify-modal').hidden = true;
      notifyTargetId = null;
      showToast(`参加者 ${res.count}名 にメールを送信しました`, '#4a6741');
    } catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
    finally { setBusy(btn, false); }
  });
}

/* ================================================
   参加するイベント
   ================================================ */
function renderJoinList() {
  const c = $('join-list');
  const showPast = $('join-show-past').checked;
  const today = todayStr();
  const key = s => String(s.date) + (s.time || '');
  const list = (siteData.schedule || [])
    .filter(s => showPast || s.date >= today)
    .sort((a, b) => key(a).localeCompare(key(b)));
  if (!list.length) { c.innerHTML = '<p class="loading-msg">これからのイベントはありません。「イベント企画」から企画してみませんか？</p>'; return; }

  c.innerHTML = list.map(item => {
    const past = item.date < today;
    const full = item.capacity && item.participantCount >= item.capacity;
    let action;
    if (item.mine)        action = '<span class="btn btn-sm btn-joined">自分の企画</span>';
    else if (past)        action = `<span class="btn btn-sm btn-joined">${item.joined ? '参加しました' : '終了'}</span>`;
    else if (item.joined) action = `<span class="btn btn-sm btn-joined">参加予定 ✓</span><button class="link-btn" data-act="leave" data-id="${item.id}">取り消す</button>`;
    else if (full)        action = '<span class="btn btn-sm btn-joined">満員</span>';
    else                  action = `<button class="btn btn-join btn-sm" data-act="join" data-id="${item.id}">参加する</button>`;
    return `
    <div class="join-item${past ? ' is-past' : ''}">
      <div class="join-item-header">
        <div class="join-item-info">
          <p class="join-item-date">${formatDateJa(item.date, item.time ? item.time + '〜' : '')}</p>
          <p class="join-item-title">${esc(item.title)}</p>
          <p class="join-item-location">📍 ${esc(item.location)}</p>
          ${item.detail ? `<p class="join-item-detail">${escBr(item.detail)}</p>` : ''}
          ${item.organizerName ? `<p class="join-item-organizer">企画者：${esc(item.organizerName)}</p>` : ''}
          ${countBadge(item)}
        </div>
        <div class="join-item-action">${action}</div>
      </div>
    </div>`;
  }).join('');
}

function setupJoinTab() {
  $('join-show-past').addEventListener('change', renderJoinList);
  $('join-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id);
    const item = siteData.schedule.find(s => s.id === id);
    if (b.dataset.act === 'join') {
      setBusy(b, true, '送信中…');
      try {
        await api({ action: 'joinEvent', scheduleId: id });
        showToast('参加しました！企画者にメールで通知されました', '#4a6741');
        refreshData();
      } catch (err) { showToast(err.message, '#8a2c1e'); setBusy(b, false); }
    }
    if (b.dataset.act === 'leave') {
      if (!await confirmDialog(`「${item?.title ?? ''}」への参加を取り消しますか？\n企画者にメールで通知されます。`, { title: '参加の取り消し', ok: '取り消す' })) return;
      try {
        await api({ action: 'leaveEvent', scheduleId: id });
        showToast('参加を取り消しました');
        refreshData();
      } catch (err) { showToast(err.message, '#8a2c1e'); }
    }
  });
}

/* ================================================
   AIアシスタント
   ================================================ */
async function aiRequest(mode, input) {
  const model = getSelectedModel();
  const r = await api({ action: 'aiAssist', mode, input, model }, 120000);
  const label = r.fallback
    ? `${r.model}（${modelLabel(model)} が使えなかったため自動で切替）`
    : r.model;
  updateVersionModel(label);
  if (typeof r.remaining === 'number') $('ai-limit').textContent = `本日のAI利用：あと ${r.remaining} 回`;
  r.label = label;
  return r;
}

function setupAiTab() {
  setupModelSelect($('ai-model'));

  $('guide-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const place = $('guide-place').value.trim();
    if (!place) { showToast('場所・テーマを入力してください', '#8a2c1e'); $('guide-place').focus(); return; }
    const btn = $('guide-submit');
    setBusy(btn, true, '✨ 原稿を作成中…（30秒ほど）');
    try {
      const r = await aiRequest('guide', {
        place,
        audience: $('guide-audience').value,
        minutes: $('guide-minutes').value,
        language: $('guide-language').value,
        tone: $('guide-tone').value,
        notes: $('guide-notes').value,
      });
      $('guide-result-text').innerHTML = escBr(r.text).replace(/【要確認】/g, '<mark class="need-check">【要確認】</mark>');
      $('guide-result-text').dataset.raw = r.text;
      $('guide-result-model').textContent = 'AIモデル：' + r.label;
      $('guide-result').hidden = false;
      $('guide-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { showToast(err.message, '#8a2c1e'); }
    finally { setBusy(btn, false); }
  });

  $('guide-copy').addEventListener('click', async () => {
    const text = $('guide-result-text').dataset.raw || '';
    try { await navigator.clipboard.writeText(text); showToast('コピーしました', '#4a6741'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); showToast('コピーしました', '#4a6741');
    }
  });
  $('guide-to-news').addEventListener('click', () => {
    const raw = ($('guide-result-text').dataset.raw || '').split('― 下調べのポイント ―')[0].trim();
    activateTab('news');
    openNewsForm(null, { title: $('guide-place').value.trim().slice(0, 100), body: raw, category: '活動報告' });
    showToast('お知らせの下書きに入れました。【要確認】を直してから投稿してください');
  });
}

/* ================================================
   パスワード表示/非表示・強度表示
   ================================================ */
function setupPasswordToggles() {
  document.querySelectorAll('.pass-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('active', show);
      btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
      btn.querySelector('.eye-icon').textContent = show ? '🙈' : '👁';
    });
  });
}
function passScore(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

/* ================================================
   パスワード変更
   ================================================ */
function setupPasswordForm() {
  const form = $('password-form');
  $('new-pass').addEventListener('input', () => {
    const v = $('new-pass').value;
    const s = v ? passScore(v) : 0;
    const bar = $('pass-meter-bar');
    bar.style.width = (s * 25) + '%';
    bar.dataset.level = s;
    $('pass-meter-text').textContent = !v ? '' : v.length < 8 ? 'あと' + (8 - v.length) + '文字以上必要です' : ['弱い', '弱い', 'ふつう', '強い', 'とても強い'][s];
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPass = $('current-pass').value;
    const newPass     = $('new-pass').value;
    const confirmPass = $('new-pass-confirm').value;
    const errEl       = $('pass-error');
    errEl.textContent = '';
    if (!currentPass || !newPass || !confirmPass) { errEl.textContent = 'すべての項目を入力してください'; return; }
    if (newPass.length < 8)       { errEl.textContent = '新しいパスワードは8文字以上にしてください'; return; }
    if (newPass !== confirmPass)  { errEl.textContent = '新しいパスワードが一致しません'; return; }
    if (currentPass === newPass)  { errEl.textContent = '新しいパスワードは現在と異なるものにしてください'; return; }

    const btn = $('pass-submit-btn');
    setBusy(btn, true, '変更中…');
    try {
      await api({ action: 'changePassword', currentPassword: currentPass, newPassword: newPass });
      form.reset();
      $('pass-meter-bar').style.width = '0'; $('pass-meter-text').textContent = '';
      form.querySelectorAll('.pass-toggle-btn').forEach(b => {
        const input = $(b.dataset.target); if (input) input.type = 'password';
        b.classList.remove('active'); b.querySelector('.eye-icon').textContent = '👁';
      });
      showToast('パスワードを変更しました', '#4a6741');
      if (MEMBER_INFO?.mustChangePassword) await clearForcedPasswordChange();
    } catch (err) { errEl.textContent = err.message; }
    finally { setBusy(btn, false); }
  });
}

/* ================================================
   ニックネーム変更
   ================================================ */
function setupNicknameForm() {
  const input = $('nickname-input');
  if (MEMBER_INFO) input.value = MEMBER_INFO.nickname || '';
  $('nickname-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = input.value.trim();
    const errEl = $('nickname-error');
    errEl.textContent = '';
    if (!nickname) { errEl.textContent = 'ニックネームを入力してください'; return; }
    if (nickname.length > 20) { errEl.textContent = 'ニックネームは20文字以内で入力してください'; return; }
    const btn = $('nickname-submit-btn');
    setBusy(btn, true, '変更中…');
    try {
      const res = await api({ action: 'updateNickname', nickname });
      MEMBER_INFO.nickname = res.nickname || nickname;
      sessionStorage.setItem('member_info', JSON.stringify(MEMBER_INFO));
      $('member-name-display').textContent = MEMBER_INFO.nickname + ' さん';
      showToast('ニックネームを変更しました（今後の投稿に反映されます）', '#4a6741');
    } catch (err) { errEl.textContent = err.message; }
    finally { setBusy(btn, false); }
  });
}

/* ================================================
   起動
   ================================================ */
function boot() {
  setupPasswordToggles();
  setupLogin();
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('notify-modal').hidden) $('notify-modal').hidden = true;
    if (!$('confirm-modal').hidden) $('confirm-cancel-btn').click();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
