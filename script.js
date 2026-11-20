/**
 * 街の語り部 — script.js（公開トップページ）
 *   - サイト設定・仲間募集：data.json（GitHubで編集）
 *   - お知らせ・スケジュール：GAS（会員・管理者の投稿。メールアドレスは含まれない）
 *   - 会員登録フォーム → GAS
 * ※ config.js → common.js の後に読み込むこと
 */
'use strict';

const NEWS_PAGE_SIZE = 6;

function catClass(cat) {
  if (!cat) return '';
  if (cat.includes('報告')) return 'cat-report';
  if (cat.includes('メディア')) return 'cat-media';
  return '';
}

/* ================================================
   データ読み込み
   ================================================ */
async function loadStaticData() {
  try {
    const res = await fetch('./data.json?' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.error('data.json 読み込みエラー:', e);
    return null;
  }
}
async function loadLiveData() {
  if (!isGasConfigured()) return null;
  try {
    const json = await gasGet({ action: 'getSiteData' });
    if (json.result === 'success' && json.data) return json.data;
  } catch (e) { console.warn('GASからの取得に失敗:', e); }
  return null;
}

/* ================================================
   お知らせ描画（新しい順・もっと見る）
   ================================================ */
function renderNews(list, container) {
  if (!list?.length) {
    container.innerHTML = '<p class="loading-msg">現在お知らせはありません。</p>'; return;
  }
  const sorted = [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.id - a.id));
  let shown = 0;
  container.innerHTML = '<div class="news-items"></div>';
  const wrap = container.querySelector('.news-items');

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'btn btn-outline more-btn';

  const showMore = () => {
    const next = sorted.slice(shown, shown + NEWS_PAGE_SIZE);
    wrap.insertAdjacentHTML('beforeend', next.map(item => `
      <article class="news-item" data-reveal>
        <div class="news-meta">
          <time class="news-date" datetime="${esc(item.date)}">${formatDateJa(item.date)}</time>
          <span class="news-cat ${catClass(item.category)}">${esc(item.category)}</span>
        </div>
        <div class="news-body">
          <h3>${esc(item.title)}</h3>
          <p>${escBr(item.body)}</p>
          ${item.authorName ? `<p class="news-author">— ${esc(item.authorName)}</p>` : ''}
        </div>
      </article>`).join(''));
    shown += next.length;
    triggerReveal(wrap.querySelectorAll('[data-reveal]:not(.revealed)'));
    if (shown >= sorted.length) more.remove();
    else more.textContent = `もっと見る（残り${sorted.length - shown}件）`;
  };
  more.addEventListener('click', showMore);
  container.appendChild(more);
  showMore();
}

/* ================================================
   スケジュール描画（これからの予定＋過去の活動）
   ================================================ */
function scheduleCard(item, past) {
  const d = new Date(item.date + 'T00:00:00');
  const wday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const count = Number(item.participantCount) || 0;
  const cap   = Number(item.capacity) || 0;
  const full  = cap && count >= cap;
  return `
    <div class="schedule-item${past ? ' is-past' : ''}" data-reveal>
      <div class="schedule-date-block">
        <span class="schedule-month">${d.getMonth() + 1}月</span>
        <span class="schedule-day">${d.getDate()}</span>
        <span class="schedule-weekday">${wday}曜</span>
      </div>
      <div class="schedule-info">
        <h3>${esc(item.title)}</h3>
        <p class="schedule-location">📍 ${esc(item.location)}${item.time ? `　🕘 ${esc(item.time)}〜` : ''}</p>
        ${item.detail ? `<p class="schedule-detail">${escBr(item.detail)}</p>` : ''}
        <p class="schedule-meta">
          ${item.organizerName ? `<span>企画：${esc(item.organizerName)}</span>` : ''}
          ${!past ? `<span class="schedule-count${full ? ' is-full' : ''}">👥 参加予定 ${count}名${cap ? ` ／ 定員${cap}名` : ''}${full ? '（満員）' : ''}</span>` : ''}
        </p>
      </div>
    </div>`;
}

function renderSchedule(list, container) {
  if (!list?.length) {
    container.innerHTML = '<p class="loading-msg">現在予定はありません。</p>'; return;
  }
  const today = todayStr();
  const key = s => String(s.date) + (s.time || '');
  const upcoming = list.filter(s => s.date >= today).sort((a, b) => key(a).localeCompare(key(b)));
  const past     = list.filter(s => s.date <  today).sort((a, b) => key(b).localeCompare(key(a)));

  container.innerHTML = `
    ${upcoming.length ? upcoming.map(s => scheduleCard(s, false)).join('') : '<p class="loading-msg">これからの予定は準備中です。</p>'}
    ${upcoming.length ? '<p class="schedule-join-note">参加の申込みは <a href="member.html">会員ページ</a> からどうぞ。</p>' : ''}
    ${past.length ? `
      <details class="past-events">
        <summary>過去の活動（${past.length}件）</summary>
        <div class="schedule-list">${past.slice(0, 30).map(s => scheduleCard(s, true)).join('')}</div>
      </details>` : ''}`;
  triggerReveal(container.querySelectorAll('[data-reveal]'));
  container.querySelector('.past-events')?.addEventListener('toggle', e => {
    e.target.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('revealed'));
  });
}

/* ================================================
   仲間募集描画
   ================================================ */
function renderRecruit(recruit, container) {
  if (!recruit) { container.innerHTML = '<p class="error-msg">情報を読み込めませんでした。</p>'; return; }
  if (!recruit.open) {
    container.innerHTML = `<div class="recruit-closed" data-reveal><p>現在メンバーの新規登録は行っておりません。</p></div>`;
    triggerReveal(container.querySelectorAll('[data-reveal]'));
    const reg = document.getElementById('register');
    if (reg) reg.hidden = true;
    return;
  }
  const reqItems  = (recruit.requirements || []).map(r => `<li>${esc(r)}</li>`).join('');
  const ruleItems = (recruit.rules || []).map(r => `<li>${esc(r)}</li>`).join('');
  const flowSteps = (recruit.flow || []).map((f, i) => `
    <div class="flow-step" data-reveal data-reveal-delay="${Math.min(i + 1, 3)}">
      <span class="flow-num">${i + 1}</span>
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
  const form = document.getElementById('register-form');
  if (!form) return;

  const wrap      = document.getElementById('register-form-wrap');
  const success   = document.getElementById('register-success');
  const errBox    = document.getElementById('register-error');
  const errText   = document.getElementById('register-error-text');
  const submitBtn = document.getElementById('reg-submit');

  // 入力し直したらエラー表示を消す
  form.addEventListener('input', e => {
    const err = document.getElementById('err-' + String(e.target.id).replace('reg-', ''));
    if (err) err.textContent = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateRegisterForm()) {
      form.querySelector('.field-error:not(:empty)')?.closest('.form-group')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    submitBtn.disabled    = true;
    submitBtn.textContent = '送信中…';
    errBox.hidden         = true;

    const payload = {
      action:   'register',
      name:     form.querySelector('#reg-name').value.trim(),
      kana:     form.querySelector('#reg-kana').value.trim(),
      nickname: form.querySelector('#reg-nickname').value.trim(),
      email:    form.querySelector('#reg-email').value.trim(),
      phone:    form.querySelector('#reg-phone').value.trim(),
      skills:   [...form.querySelectorAll('input[name="skills"]:checked')].map(cb => cb.value).join('、'),
      message:  form.querySelector('#reg-message').value.trim(),
      agree:    form.querySelector('#reg-agree').checked,
    };

    try {
      const json = await gasPost(payload);
      if (json.result !== 'success') throw new Error(json.message || 'エラーが発生しました');
      wrap.hidden    = true;
      success.hidden = false;
      success.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      console.error('登録エラー:', err);
      errText.textContent = err.message || '登録に失敗しました。しばらく経ってから再度お試しください。';
      errBox.hidden = false;
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = '登録する';
    }
  });
}

function validateRegisterForm() {
  let valid = true;
  [['reg-name', 'err-name', 'お名前を入力してください'],
   ['reg-kana', 'err-kana', 'ふりがなを入力してください'],
   ['reg-nickname', 'err-nickname', 'ニックネームを入力してください'],
   ['reg-email', 'err-email', 'メールアドレスを入力してください']
  ].forEach(([id, errId, msg]) => {
    const el  = document.getElementById(id);
    const err = document.getElementById(errId);
    if (!el || !err) return;
    err.textContent = el.value.trim() ? '' : msg;
    if (!el.value.trim()) valid = false;
  });
  const emailEl  = document.getElementById('reg-email');
  const emailErr = document.getElementById('err-email');
  if (emailEl?.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
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
   フェードイン
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
  else elements.forEach(el => el.classList.add('revealed'));
}

/* ================================================
   ヘッダー・ハンバーガー・トップへ
   ================================================ */
function setupHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;
  window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 40), { passive: true });
}
function setupHamburger() {
  const btn = document.getElementById('hamburger');
  const nav = document.getElementById('global-nav');
  const ov  = document.getElementById('nav-overlay');
  if (!btn || !nav || !ov) return;
  const open  = () => { nav.classList.add('open'); ov.classList.add('active'); btn.setAttribute('aria-expanded', 'true');  document.body.style.overflow = 'hidden'; };
  const close = () => { nav.classList.remove('open'); ov.classList.remove('active'); btn.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; };
  btn.addEventListener('click', () => btn.getAttribute('aria-expanded') === 'true' ? close() : open());
  ov.addEventListener('click', close);
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('keydown', e => e.key === 'Escape' && close());
}
function setupBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 400), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ================================================
   メイン
   ================================================ */
async function init() {
  setupHeader();
  setupHamburger();
  setupBackToTop();
  setupRevealObserver();
  setupRegisterForm();
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const [stat, live] = await Promise.all([loadStaticData(), loadLiveData()]);
  const newsEl     = document.getElementById('news-list');
  const scheduleEl = document.getElementById('schedule-list');
  const recruitEl  = document.getElementById('recruit-content');

  // お知らせ・スケジュールはGASを優先、取れなければ data.json
  const news     = live ? live.news     : stat?.news;
  const schedule = live ? live.schedule : stat?.schedule;
  if (newsEl)     (news     ? renderNews(news, newsEl)         : newsEl.innerHTML     = '<p class="error-msg">お知らせを読み込めませんでした。</p>');
  if (scheduleEl) (schedule ? renderSchedule(schedule, scheduleEl) : scheduleEl.innerHTML = '<p class="error-msg">スケジュールを読み込めませんでした。</p>');
  if (recruitEl)  renderRecruit(stat?.recruit, recruitEl);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
