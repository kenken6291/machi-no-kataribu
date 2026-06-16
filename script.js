/**
 * 街の語り部 — script.js
 * 一般サイト用：data.json読み込み・描画・会員登録フォーム
 *
 * ★ セキュリティ方針
 *   - APIキー・パスワード・GAS URLはこのファイルに一切含まない
 *   - 会員登録のGAS URLは admin.js 側でのみ管理（管理者だけが知るURL）
 *   - 登録フォームのエンドポイントは <form data-endpoint="..."> 属性で
 *     admin.html 側から注入する形にせず、別途 config.js（.gitignore対象）
 *     または GAS側トークン検証で保護する
 *
 *   ▼ 会員登録フォームのGAS URLの設定方法
 *     index.html の <form id="register-form"> に
 *     data-gas-url="https://script.google.com/macros/s/【YOUR_ID】/exec"
 *     属性を追加してください。このHTMLファイル自体はパブリックですが、
 *     GAS側でCORSとreCAPTCHAトークン検証を行うため安全です。
 */
'use strict';

/* ================================================
   ユーティリティ
   ================================================ */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return esc(dateStr);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}
function parseDateParts(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return { month: d.getMonth()+1, day: d.getDate(), wday: ['日','月','火','水','木','金','土'][d.getDay()] };
}
function catClass(cat) {
  if (!cat) return '';
  if (cat.includes('報告')) return 'cat-report';
  if (cat.includes('メディア')) return 'cat-media';
  return '';
}

/* ================================================
   data.json 読み込み（公開コンテンツのみ・機密情報なし）
   ================================================ */
async function loadData() {
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
   お知らせ描画
   ================================================ */
function renderNews(list, container) {
  if (!list?.length) {
    container.innerHTML = '<p class="loading-msg">現在お知らせはありません。</p>'; return;
  }
  container.innerHTML = list.map(item => `
    <div class="news-item" data-reveal>
      <div class="news-meta">
        <time class="news-date" datetime="${esc(item.date)}">${formatDate(item.date)}</time>
        <span class="news-cat ${catClass(item.category)}">${esc(item.category)}</span>
      </div>
      <div class="news-body">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.body)}</p>
      </div>
    </div>`).join('');
  triggerReveal(container.querySelectorAll('[data-reveal]'));
}

/* ================================================
   スケジュール描画
   ================================================ */
function renderSchedule(list, container) {
  if (!list?.length) {
    container.innerHTML = '<p class="loading-msg">現在予定はありません。</p>'; return;
  }
  container.innerHTML = list.map(item => {
    const { month, day, wday } = parseDateParts(item.date);
    return `
    <div class="schedule-item" data-reveal>
      <div class="schedule-date-block">
        <span class="schedule-month">${esc(String(month))}月</span>
        <span class="schedule-day">${esc(String(day))}</span>
        <span class="schedule-weekday">${esc(wday)}曜</span>
      </div>
      <div class="schedule-info">
        <h3>${esc(item.title)}</h3>
        <p class="schedule-location">📍 ${esc(item.location)}</p>
        <p class="schedule-detail">${esc(item.detail)}</p>
      </div>
    </div>`;
  }).join('');
  triggerReveal(container.querySelectorAll('[data-reveal]'));
}

/* ================================================
   仲間募集描画
   ================================================ */
function renderRecruit(recruit, container) {
  if (!recruit) { container.innerHTML = '<p class="error-msg">情報を読み込めませんでした。</p>'; return; }
  if (!recruit.open) {
    container.innerHTML = `<div class="recruit-closed" data-reveal><p>現在メンバーの新規登録は行っておりません。</p></div>`;
    triggerReveal(container.querySelectorAll('[data-reveal]'));
    return;
  }
  const reqItems  = (recruit.requirements||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const ruleItems = (recruit.rules||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const flowSteps = (recruit.flow||[]).map((f,i)=>`
    <div class="flow-step" data-reveal data-reveal-delay="${Math.min(i+1,3)}">
      <span class="flow-num">${i+1}</span>
      <p class="flow-text">${esc(f)}</p>
    </div>`).join('');

  container.innerHTML = `
    <p class="recruit-message" data-reveal>${esc(recruit.message)}</p>
    <p class="recruit-desc"   data-reveal>${esc(recruit.description)}</p>
    <div class="recruit-grid">
      <div class="recruit-card" data-reveal><h3>参加条件</h3><ul>${reqItems}</ul></div>
      <div class="recruit-card" data-reveal data-reveal-delay="1"><h3>コミュニティルール</h3><ul>${ruleItems}</ul></div>
    </div>
    <div class="section-header" style="margin-bottom:1.5rem">
      <p class="section-label" style="color:var(--金茶淡)">How to Join</p>
      <h3 style="font-family:var(--font-serif);font-size:1.2rem;color:var(--和紙);letter-spacing:.08em">登録の流れ</h3>
    </div>
    <div class="recruit-flow">${flowSteps}</div>
    <div class="recruit-cta" data-reveal>
      <a href="#register" class="btn btn-primary">会員登録へ進む</a>
    </div>`;
  triggerReveal(container.querySelectorAll('[data-reveal]'));
}

/* ================================================
   会員登録フォーム
   ================================================ */
function setupRegisterForm() {
  const form    = document.getElementById('register-form');
  if (!form) return;

  // GAS URLはHTML属性から取得（ソースコードに埋め込まない）
  const GAS_ENDPOINT = form.dataset.gasUrl ?? '';

  const wrap      = document.getElementById('register-form-wrap');
  const success   = document.getElementById('register-success');
  const errBox    = document.getElementById('register-error');
  const submitBtn = document.getElementById('reg-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateRegisterForm()) return;

    submitBtn.disabled    = true;
    submitBtn.textContent = '送信中…';
    errBox.hidden         = true;

    const skills = [...form.querySelectorAll('input[name="skills"]:checked')]
      .map(cb => cb.value).join('、');

    const payload = {
      action:  'register',
      name:    form.querySelector('#reg-name').value.trim(),
      kana:    form.querySelector('#reg-kana').value.trim(),
      email:   form.querySelector('#reg-email').value.trim(),
      phone:   form.querySelector('#reg-phone').value.trim(),
      skills,
      message: form.querySelector('#reg-message').value.trim(),
    };

    // GAS URL未設定時はデモ動作
    if (!GAS_ENDPOINT || GAS_ENDPOINT.includes('YOUR_SCRIPT_ID')) {
      await new Promise(r => setTimeout(r, 700));
      wrap.hidden    = true;
      success.hidden = false;
      return;
    }

    try {
      const res  = await fetch(GAS_ENDPOINT, { method:'POST', body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.result === 'success') {
        wrap.hidden    = true;
        success.hidden = false;
      } else {
        throw new Error(json.message || 'エラーが発生しました');
      }
    } catch (err) {
      console.error('登録エラー:', err);
      errBox.hidden         = false;
      submitBtn.disabled    = false;
      submitBtn.textContent = '登録する';
    }
  });
}

function validateRegisterForm() {
  let valid = true;
  [['reg-name','err-name','お名前を入力してください'],
   ['reg-kana','err-kana','ふりがなを入力してください'],
   ['reg-email','err-email','メールアドレスを入力してください']
  ].forEach(([id, errId, msg]) => {
    const el  = document.getElementById(id);
    const err = document.getElementById(errId);
    if (!el || !err) return;
    err.textContent = el.value.trim() ? '' : msg;
    if (!el.value.trim()) valid = false;
  });
  const emailEl  = document.getElementById('reg-email');
  const emailErr = document.getElementById('err-email');
  if (emailEl?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value)) {
    if (emailErr) emailErr.textContent = '正しいメールアドレスを入力してください';
    valid = false;
  }
  const agree    = document.getElementById('reg-agree');
  const agreeErr = document.getElementById('err-agree');
  if (agree && !agree.checked) {
    if (agreeErr) agreeErr.textContent = '同意が必要です';
    valid = false;
  } else if (agreeErr) agreeErr.textContent = '';
  return valid;
}

/* ================================================
   IntersectionObserver フェードイン
   ================================================ */
let revealObserver;
function setupRevealObserver() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('revealed'));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('revealed'); revealObserver.unobserve(entry.target); }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));
}
function triggerReveal(elements) {
  if (revealObserver) elements.forEach(el => revealObserver.observe(el));
}

/* ================================================
   ヘッダー・ハンバーガー・スクロール
   ================================================ */
function setupHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;
  window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 40), { passive:true });
}
function setupHamburger() {
  const btn = document.getElementById('hamburger');
  const nav = document.getElementById('global-nav');
  const ov  = document.getElementById('nav-overlay');
  if (!btn || !nav || !ov) return;
  const open  = () => { nav.classList.add('open'); ov.classList.add('active'); btn.setAttribute('aria-expanded','true');  document.body.style.overflow='hidden'; };
  const close = () => { nav.classList.remove('open'); ov.classList.remove('active'); btn.setAttribute('aria-expanded','false'); document.body.style.overflow=''; };
  btn.addEventListener('click', () => btn.getAttribute('aria-expanded')==='true' ? close() : open());
  ov.addEventListener('click', close);
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('keydown', e => e.key==='Escape' && close());
}
function setupBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 400), { passive:true });
  btn.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));
}

/* ================================================
   メイン
   ================================================ */
async function init() {
  setupHeader();
  setupHamburger();
  setupBackToTop();
  setupRevealObserver();
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const data = await loadData();
  if (!data) {
    ['news-list','schedule-list','recruit-content'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="error-msg">データを読み込めませんでした。</p>';
    });
    return;
  }

  const newsEl     = document.getElementById('news-list');
  const scheduleEl = document.getElementById('schedule-list');
  const recruitEl  = document.getElementById('recruit-content');
  if (newsEl)     renderNews(data.news, newsEl);
  if (scheduleEl) renderSchedule(data.schedule, scheduleEl);
  if (recruitEl)  renderRecruit(data.recruit, recruitEl);

  setupRegisterForm();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
