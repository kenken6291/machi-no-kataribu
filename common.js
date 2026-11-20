/**
 * 街の語り部 — common.js
 * 全ページ共通：設定読み込み・GAS通信・バージョン表示・AIモデル選択
 * ※ config.js の後に読み込むこと
 */
'use strict';

const APP_CONFIG   = window.APP_CONFIG || {};
const APP_VERSION  = APP_CONFIG.APP_VERSION || '-';
const GAS_URL      = String(APP_CONFIG.GAS_EXEC_URL || '').trim();
const GEMINI_MODEL_OPTIONS = Array.isArray(APP_CONFIG.GEMINI_MODEL_OPTIONS) && APP_CONFIG.GEMINI_MODEL_OPTIONS.length
  ? APP_CONFIG.GEMINI_MODEL_OPTIONS
  : [{ value: '', label: '自動モード（汎用の最新）' }];
const MODEL_STORAGE_KEY = 'kataribu_gemini_model';

function isGasConfigured() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS_URL);
}

/* ---------- 文字列 ---------- */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
function escBr(str) { return esc(str).replace(/\n/g, '<br>'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDateJa(dateStr, time) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return esc(dateStr);
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）${time ? ' ' + esc(time) : ''}`;
}

/* ---------- GAS通信 ---------- */
async function gasPost(payload, timeoutMs = 60000) {
  if (!isGasConfigured()) throw new Error('GASのURLが未設定です（config.js の GAS_EXEC_URL）');
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // text/plain で送るとプリフライト(CORS)が発生しない
    const res  = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error('サーバーの応答を読み取れませんでした（GASのデプロイ設定を確認してください）'); }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました。時間をおいて再試行してください');
    if (e instanceof TypeError) throw new Error('サーバーへの接続に失敗しました。通信環境を確認してください');
    throw e;
  } finally { clearTimeout(timer); }
}

async function gasGet(params = {}) {
  if (!isGasConfigured()) throw new Error('GASのURLが未設定です（config.js の GAS_EXEC_URL）');
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${GAS_URL}?${qs}`, { redirect: 'follow' });
  return res.json();
}

function isSessionError(msg) {
  return /セッション|トークン|再度ログイン/.test(String(msg || ''));
}

/* ---------- トースト ---------- */
function showToast(msg, color = '#1a1208') {
  let t = document.getElementById('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.className = 'app-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.style.background = color;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------- AIモデル選択 ---------- */
function getSelectedModel() {
  let saved = null;
  try { saved = localStorage.getItem(MODEL_STORAGE_KEY); } catch (e) { /* ignore */ }
  if (saved !== null && GEMINI_MODEL_OPTIONS.some(o => o.value === saved)) return saved;
  return APP_CONFIG.GEMINI_MODEL || '';
}
function modelLabel(value) {
  const o = GEMINI_MODEL_OPTIONS.find(x => x.value === value);
  return o ? o.label : (value || '自動');
}
function setupModelSelect(selectEl, onChange) {
  if (!selectEl) return;
  selectEl.innerHTML = GEMINI_MODEL_OPTIONS
    .map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  selectEl.value = getSelectedModel();
  selectEl.addEventListener('change', () => {
    try { localStorage.setItem(MODEL_STORAGE_KEY, selectEl.value); } catch (e) { /* ignore */ }
    document.querySelectorAll('select.model-select').forEach(s => { if (s !== selectEl) s.value = selectEl.value; });
    updateVersionModel(modelLabel(selectEl.value));
    if (onChange) onChange(selectEl.value);
  });
}

/* ---------- バージョン表示（.version-info を持つ要素すべてに表示） ---------- */
function setAll(sel, text) { document.querySelectorAll(sel).forEach(el => { el.textContent = text; }); }
function updateVersionModel(text) { setAll('.js-ver-model', text); }
async function renderVersionInfo() {
  const boxes = document.querySelectorAll('.version-info');
  if (!boxes.length) return;
  boxes.forEach(box => {
    box.innerHTML = `
      フロント <code>${esc(APP_VERSION)}</code>
      <span class="ver-sep">／</span>GAS <code class="js-ver-gas">確認中…</code>
      <span class="ver-sep">／</span>AIモデル <code class="js-ver-model">${esc(modelLabel(getSelectedModel()))}</code>`;
  });
  if (!isGasConfigured()) { setAll('.js-ver-gas', '未設定'); return; }
  try {
    const json = await gasGet({ action: 'version' });
    if (json.result !== 'success') throw new Error();
    window.GAS_VERSION_INFO = json.data;
    setAll('.js-ver-gas', json.data.gasVersion || '不明');
    if (json.data.aiEnabled === false) updateVersionModel('AI未設定');
    else if (!getSelectedModel() && json.data.defaultModel) updateVersionModel(`自動（${json.data.defaultModel}）`);
  } catch (e) {
    setAll('.js-ver-gas', '旧版または接続不可');
  }
}

document.addEventListener('DOMContentLoaded', renderVersionInfo);
