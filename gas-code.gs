/**
 * 街の語り部 — gas-code.gs (v4)
 * ★ SPREADSHEET_ID と ADMIN_PASSWORD、PEPPER を必ず設定してください
 * ★ このファイルはGitHubにアップロードしないでください
 *
 * v4での変更点：
 *   - 会員登録に「ニックネーム」を追加（お知らせ・イベント企画等の表示名。お名前は非公開）
 *   - パスワードをSHA-256（salt+pepper）でハッシュ化して保存（平文保存をやめた）
 *   - 初回ログイン（仮パスワード）時にパスワード変更を必須化（mustChangePasswordフラグ）
 *   - 会員ログインの総当たり対策（CacheServiceで一定回数失敗したらロック）
 *   - 会員ログインのメールアドレス存在有無を推測されないよう、エラーメッセージを統一
 *   - 登録時の「注意事項・免責事項」への同意をサーバー側でも必須チェック
 *   - 会員一覧（管理者用）からパスワードハッシュ・saltを除外して返すよう修正
 *   - 既存の平文パスワードは、次回ログイン成功時に自動でハッシュ方式へ移行（互換維持）
 */

// ========================================
// ★ ここだけ設定する
// ========================================
const SPREADSHEET_ID = '1zFMoOfwdmBr2Nu9iel75NDwxgT954_Atdwl9IWQFfdU';
const ADMIN_PASSWORD = 'kanri6262';
const SITE_URL       = 'https://kenken6291.github.io/machi-no-kataribu/';

// パスワードハッシュ化用の秘密文字列（他人に推測されない値に変更してOK）
// ★注意：デプロイ後にこの値を変更すると、既存会員は全員「パスワード不一致」扱いになります
//        （ログイン時に平文からの自動移行が動かなくなるため）。変更するなら会員登録前に。
const PEPPER = 'machi-kataribu-pepper-8f3c1a09';

// セッション設定
const TOKEN_TTL_MS = 3600 * 1000; // 1時間
const MAX_FAILURES = 5;
const LOCK_MS      = 1800 * 1000; // 30分

// スプレッドシート列定義（既存データとの互換のため、既存の1〜9列は変更しない。新項目は末尾に追加）
const COL = {
  registeredAt:       1,
  name:               2,
  kana:               3,
  email:              4,
  phone:              5,
  skills:             6,
  message:            7,
  password:           8, // ハッシュ化して保存（v4以降）
  organizerEmail:     9, // 未使用列（互換のため維持）
  nickname:           10,
  salt:               11,
  mustChangePassword: 12,
  agreedAt:           13,
};
const MEMBER_HEADERS = Object.keys(COL);

/* =========================================
   GET
   ========================================= */
function doGet(e) {
  try {
    const action = e?.parameter?.action ?? '';
    const token  = e?.parameter?.token  ?? '';

    if (action === 'ping') {
      return ok({ message: 'GAS接続OK', time: new Date().toISOString() });
    }
    // 認証不要：サイトデータ取得（会員ページ用）
    if (action === 'getSiteData') {
      return ok({ data: getSiteData() });
    }
    if (action === 'getMembers') {
      verifyAdminToken(token);
      return ok({ members: getMembersForAdmin() });
    }
    return ng('無効なリクエストです');
  } catch (err) { return ng(err.message); }
}

/* =========================================
   POST
   ========================================= */
function doPost(e) {
  try {
    let raw;
    const contentType = (e.postData ? e.postData.type || '' : '');
    if (contentType.includes('multipart') || contentType.includes('urlencoded')) {
      raw = e.parameter.payload || (e.postData ? e.postData.contents : '');
    } else {
      // text/plain, application/json, その他すべて
      raw = (e.postData ? e.postData.contents : '') || e.parameter.payload || '';
    }
    if (!raw) throw new Error('リクエストボディが空です');
    const payload = JSON.parse(raw);
    const action  = payload.action ?? '';

    // 認証不要
    if (action === 'register')    return ok(doRegister(payload));
    if (action === 'adminLogin')  return ok(doAdminLogin(payload.password ?? ''));
    if (action === 'memberLogin') return ok(doMemberLogin(payload.email ?? '', payload.password ?? ''));

    // 管理者専用
    if (action === 'updateData')   { verifyAdminToken(payload.token); saveSiteData(payload.data); return ok(); }
    if (action === 'deleteMember') { verifyAdminToken(payload.token); deleteMemberRow(Number(payload.row)); return ok(); }

    // 会員専用
    if (action === 'memberPost')         { const m = verifyMemberToken(payload.token); return ok(doMemberPost(payload, m)); }
    if (action === 'joinEvent')          { const m = verifyMemberToken(payload.token); return ok(doJoinEvent(Number(payload.scheduleId), m)); }
    if (action === 'changePassword')     { const m = verifyMemberToken(payload.token); return ok(doChangePassword(m, payload.currentPassword, payload.newPassword)); }
    if (action === 'updateNickname')     { const m = verifyMemberToken(payload.token); return ok(doUpdateNickname(m, payload.nickname)); }
    if (action === 'notifyParticipants') { const m = verifyMemberToken(payload.token); return ok(doNotifyParticipants(Number(payload.scheduleId), payload.message, m)); }

    return ng('不明なアクション: ' + action);
  } catch (err) { return ng(err.message); }
}

/* =========================================
   会員登録
   ========================================= */
function doRegister(data) {
  const name     = String(data.name     ?? '').trim();
  const kana     = String(data.kana     ?? '').trim();
  const nickname = String(data.nickname ?? '').trim();
  const email    = String(data.email    ?? '').trim();

  if (!name)     throw new Error('お名前を入力してください');
  if (!kana)     throw new Error('ふりがなを入力してください');
  if (!nickname) throw new Error('ニックネームを入力してください');
  if (nickname.length > 20) throw new Error('ニックネームは20文字以内で入力してください');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('正しいメールアドレスを入力してください');
  if (data.agree !== true) throw new Error('注意事項・免責事項への同意が必要です');

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureMembersSheet(ss);

  // メール重複チェック（大文字小文字を無視）
  const existing = getMembers();
  if (existing.some(m => normEmail(m.email) === normEmail(email))) {
    throw new Error('このメールアドレスはすでに登録されています');
  }

  const now  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const pass = makeTempPassword();
  const salt = makeSalt();
  const hash = hashPassword(pass, salt);

  sheet.appendRow([
    now,                // registeredAt
    name,               // name
    kana,               // kana
    email,              // email
    data.phone   ?? '', // phone
    data.skills  ?? '', // skills
    data.message ?? '', // message
    hash,               // password（ハッシュ化済み）
    '',                 // organizerEmail（未使用）
    nickname,           // nickname
    salt,               // salt
    true,               // mustChangePassword
    now,                // agreedAt
  ]);

  sendConfirmEmail(email, name, pass);
  return {};
}

/* membersシートを確実に準備する（ヘッダーが古い場合は追記して修正） */
function ensureMembersSheet(ss) {
  let sheet = ss.getSheetByName('members');
  if (!sheet) {
    sheet = ss.insertSheet('members');
    sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).setValues([MEMBER_HEADERS]);
    return sheet;
  }
  // ヘッダー行が正しいか確認・修正（既存データの列はそのまま、足りない列だけ追加）
  const lastCol  = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  MEMBER_HEADERS.forEach((h, i) => {
    if (existing[i] !== h) sheet.getRange(1, i + 1).setValue(h);
  });
  return sheet;
}

function getMembersSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('members');
  if (!sheet) throw new Error('membersシートが見つかりません');
  return sheet;
}

/* =========================================
   会員一覧取得
   ========================================= */
function getMembers() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureMembersSheet(ss);
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getDataRange().getValues();
  const hdrs = rows[0];
  return rows.slice(1).map((row, i) => {
    const obj = { row: i + 2 };
    hdrs.forEach((h, j) => { obj[h] = row[j] ?? ''; });
    return obj;
  });
}

/* 管理画面向け：パスワードハッシュ・saltを除いた会員一覧 */
function getMembersForAdmin() {
  return getMembers().map(m => {
    const safe = {};
    Object.keys(m).forEach(k => {
      if (k === 'password' || k === 'salt') return;
      safe[k] = m[k];
    });
    return safe;
  });
}

function deleteMemberRow(rowNum) {
  const sheet = getMembersSheet();
  sheet.deleteRow(rowNum);
}

/* =========================================
   管理者ログイン
   ========================================= */
function doAdminLogin(input) {
  const store = PropertiesService.getScriptProperties();
  const now   = Date.now();
  const lock  = Number(store.getProperty('admin_lock') || 0);
  if (now < lock) throw new Error(`${Math.ceil((lock-now)/60000)}分間ロック中です`);

  if (input === ADMIN_PASSWORD) {
    store.deleteProperty('admin_fails');
    store.deleteProperty('admin_lock');
    const token = makeToken();
    store.setProperty('admin_token',   token);
    store.setProperty('admin_token_ex', String(now + TOKEN_TTL_MS));
    return { token, role: 'admin' };
  }
  const fails = Number(store.getProperty('admin_fails') || 0) + 1;
  store.setProperty('admin_fails', String(fails));
  if (fails >= MAX_FAILURES) {
    store.setProperty('admin_lock', String(now + LOCK_MS));
    store.deleteProperty('admin_fails');
    throw new Error(`${MAX_FAILURES}回失敗。${LOCK_MS/60000}分間ロックします`);
  }
  throw new Error(`パスワードが違います（${fails}/${MAX_FAILURES}回）`);
}

function verifyAdminToken(token) {
  if (!token) throw new Error('トークンがありません');
  const store = PropertiesService.getScriptProperties();
  if (token !== store.getProperty('admin_token') || Date.now() > Number(store.getProperty('admin_token_ex') || 0))
    throw new Error('セッションが無効または期限切れです');
}

/* =========================================
   会員ログイン
   ========================================= */
function doMemberLogin(email, password) {
  const emailNorm = normEmail(email);
  // メールアドレス・パスワードいずれの誤りでも同じメッセージにし、登録有無を推測されないようにする
  const GENERIC_ERROR = 'メールアドレスまたはパスワードが違います';
  if (!emailNorm || !password) throw new Error(GENERIC_ERROR);

  checkMemberLoginLock(emailNorm);

  const members = getMembers();
  const member  = members.find(m => normEmail(m.email) === emailNorm);

  if (!member || !member.password || !verifyMemberPassword(member, password)) {
    recordMemberLoginFailure(emailNorm);
    throw new Error(GENERIC_ERROR);
  }

  clearMemberLoginFailure(emailNorm);

  const store = PropertiesService.getScriptProperties();
  const token = makeToken();
  store.setProperty('mtoken_' + member.row, token);
  store.setProperty('mtokenex_' + member.row, String(Date.now() + TOKEN_TTL_MS));

  return {
    token, role: 'member',
    name:     member.name,
    nickname: member.nickname,
    email:    member.email,
    row:      member.row,
    mustChangePassword: isTruthy(member.mustChangePassword),
  };
}

function verifyMemberToken(token) {
  if (!token) throw new Error('トークンがありません');
  const store = PropertiesService.getScriptProperties();
  const keys  = store.getKeys().filter(k => k.startsWith('mtoken_') && !k.startsWith('mtokenex_'));
  for (const key of keys) {
    if (store.getProperty(key) === token) {
      const row = key.replace('mtoken_', '');
      if (Date.now() > Number(store.getProperty('mtokenex_' + row) || 0))
        throw new Error('セッションが期限切れです');
      const m = getMembers().find(m => String(m.row) === row);
      if (!m) throw new Error('会員情報が見つかりません');
      return m;
    }
  }
  throw new Error('無効なトークンです');
}

/* 会員ログインの総当たり対策（CacheService） */
function checkMemberLoginLock(emailNorm) {
  const fails = Number(CacheService.getScriptCache().get('mlock_' + emailNorm) || 0);
  if (fails >= MAX_FAILURES) {
    throw new Error('ログイン試行回数が上限に達しました。しばらく時間をおいて再度お試しください');
  }
}
function recordMemberLoginFailure(emailNorm) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('mlock_' + emailNorm) || 0) + 1;
  cache.put('mlock_' + emailNorm, String(fails), LOCK_MS / 1000);
}
function clearMemberLoginFailure(emailNorm) {
  CacheService.getScriptCache().remove('mlock_' + emailNorm);
}

/* =========================================
   パスワード変更
   ========================================= */
function doChangePassword(member, currentPass, newPass) {
  if (!currentPass || !newPass) throw new Error('パスワードを入力してください');
  if (!verifyMemberPassword(member, currentPass)) throw new Error('現在のパスワードが違います');
  if (newPass.length < 8) throw new Error('新しいパスワードは8文字以上にしてください');
  if (String(currentPass).trim() === String(newPass).trim())
    throw new Error('新しいパスワードは現在と異なるものにしてください');

  const sheet = getMembersSheet();
  const salt  = makeSalt();
  const hash  = hashPassword(newPass, salt);
  sheet.getRange(member.row, COL.password).setValue(hash);
  sheet.getRange(member.row, COL.salt).setValue(salt);
  sheet.getRange(member.row, COL.mustChangePassword).setValue(false);
  return {};
}

/* =========================================
   ニックネーム変更
   ========================================= */
function doUpdateNickname(member, newNickname) {
  const nickname = String(newNickname ?? '').trim();
  if (!nickname) throw new Error('ニックネームを入力してください');
  if (nickname.length > 20) throw new Error('ニックネームは20文字以内で入力してください');
  const sheet = getMembersSheet();
  sheet.getRange(member.row, COL.nickname).setValue(nickname);
  return { nickname };
}

/* =========================================
   会員投稿（お知らせ・スケジュール）
   ※ 公開される投稿者名は「ニックネーム」を使用（お名前は非公開）
   ========================================= */
function doMemberPost(payload, member) {
  const data       = getSiteData();
  const type       = payload.type;
  const method     = payload.method;
  const item       = payload.item;
  const displayName = member.nickname || member.name;

  if (type === 'news') {
    if (method === 'add') {
      data.news.unshift({ id: nextId(data.news), date: item.date, category: item.category,
        title: item.title, body: item.body, authorName: displayName, authorEmail: member.email });
    } else if (method === 'edit') {
      const idx = data.news.findIndex(n => n.id === Number(item.id));
      if (idx < 0) throw new Error('対象が見つかりません');
      if (data.news[idx].authorEmail !== member.email) throw new Error('自分の投稿のみ編集できます');
      Object.assign(data.news[idx], { date: item.date, category: item.category, title: item.title, body: item.body });
    } else if (method === 'delete') {
      const idx = data.news.findIndex(n => n.id === Number(item.id));
      if (idx < 0) throw new Error('対象が見つかりません');
      if (data.news[idx].authorEmail !== member.email) throw new Error('自分の投稿のみ削除できます');
      data.news.splice(idx, 1);
    }
  } else if (type === 'schedule') {
    if (method === 'add') {
      data.schedule.push({ id: nextId(data.schedule), date: item.date, title: item.title,
        location: item.location, detail: item.detail,
        organizerName: displayName, organizerEmail: item.organizerEmail || member.email, participants: [] });
      data.schedule.sort((a, b) => a.date.localeCompare(b.date));
    } else if (method === 'edit') {
      const idx = data.schedule.findIndex(s => s.id === Number(item.id));
      if (idx < 0) throw new Error('対象が見つかりません');
      if (data.schedule[idx].organizerEmail !== member.email) throw new Error('自分の企画のみ編集できます');
      Object.assign(data.schedule[idx], { date: item.date, title: item.title, location: item.location, detail: item.detail });
    } else if (method === 'delete') {
      const idx = data.schedule.findIndex(s => s.id === Number(item.id));
      if (idx < 0) throw new Error('対象が見つかりません');
      if (data.schedule[idx].organizerEmail !== member.email) throw new Error('自分の企画のみ削除できます');
      data.schedule.splice(idx, 1);
    }
  }
  saveSiteData(data);
  return {};
}

/* =========================================
   イベント参加
   ========================================= */
function doJoinEvent(scheduleId, member) {
  const data  = getSiteData();
  const event = data.schedule.find(s => s.id === scheduleId);
  if (!event) throw new Error('イベントが見つかりません');
  if (!event.participants) event.participants = [];
  if (!event.participants.includes(member.email)) event.participants.push(member.email);
  saveSiteData(data);
  if (event.organizerEmail) notifyOrganizer(event, member);
  return {};
}

/* =========================================
   参加者への一斉連絡
   ========================================= */
function doNotifyParticipants(scheduleId, message, organizer) {
  const data  = getSiteData();
  const event = data.schedule.find(s => s.id === scheduleId);
  if (!event) throw new Error('イベントが見つかりません');
  if (event.organizerEmail !== organizer.email) throw new Error('企画者のみ送信できます');
  if (!event.participants?.length) throw new Error('参加者がいません');

  const members = getMembers();
  const emails  = event.participants
    .map(e => members.find(m => m.email === e)?.email)
    .filter(Boolean);
  if (!emails.length) throw new Error('送信先が見つかりません');

  const organizerDisplayName = organizer.nickname || organizer.name;
  MailApp.sendEmail({
    to: emails.join(','),
    subject: `【街の語り部】「${event.title}」からお知らせ`,
    body: `「${event.title}」の企画者（${organizerDisplayName}）からお知らせです。\n\n-----\n${message}\n-----\n\n日時：${event.date}\n場所：${event.location}\n\n-----\n街の語り部\n${SITE_URL}\n-----\n※このメールは自動送信です。`,
  });
  return { count: emails.length };
}

/* =========================================
   メール通知
   ========================================= */
function notifyOrganizer(event, participant) {
  try {
    const participantDisplayName = participant.nickname || participant.name;
    MailApp.sendEmail({
      to: event.organizerEmail,
      subject: `【街の語り部】「${event.title}」に参加申込みがありました`,
      body: `「${event.title}」に参加申込みがありました。\n\n参加者：${participantDisplayName}（${participant.email}）\n\n日時：${event.date}\n場所：${event.location}\n現在の参加者数：${event.participants.length}名\n\n-----\n街の語り部\n${SITE_URL}\n-----\n※このメールは自動送信です。`,
    });
  } catch(e) { console.error('企画者通知エラー:', e); }
}

function sendConfirmEmail(email, name, tempPassword) {
  if (!email) return;
  try {
    MailApp.sendEmail({
      to:      email,
      subject: '【街の語り部】会員登録完了・仮パスワードのお知らせ',
      body:
`${name ?? ''} 様

街の語り部への会員登録が完了しました。
ご登録内容と「注意事項・免責事項」への同意を確認しました。

以下の仮パスワードで会員ページにログインできます。
セキュリティのため、初回ログイン時に必ずパスワードの変更をお願いします（変更するまで他のメニューは使えません）。

■ ログイン情報
  メールアドレス：${email}
  仮パスワード：${tempPassword}

■ 会員ページURL
  ${SITE_URL}member.html

※ 会員ページでのお知らせ投稿・イベント企画には、登録時のお名前ではなく「ニックネーム」が表示されます。
　 ニックネームはログイン後、会員ページの「アカウント設定」からいつでも変更できます。

-----
街の語り部
${SITE_URL}
-----
※このメールは自動送信です。返信はできません。`,
    });
  } catch(e) { console.error('確認メールエラー:', e); }
}

/* =========================================
   サイトデータ（data.json相当）
   ========================================= */
function getSiteData() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('data');
  if (!sheet || sheet.getLastRow() < 2) return { news:[], schedule:[], recruit:{open:true} };
  const val = sheet.getRange(2, 1).getValue();
  return val ? JSON.parse(val) : { news:[], schedule:[], recruit:{open:true} };
}

function saveSiteData(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('data');
  if (!sheet) { sheet = ss.insertSheet('data'); sheet.getRange(1,1).setValue('json'); }
  sheet.getRange(2, 1).setValue(JSON.stringify(data, null, 2));
}

/* =========================================
   パスワードハッシュ関連
   ========================================= */
function makeSalt() {
  return Utilities.getUuid();
}

function hashPassword(password, salt) {
  const raw   = String(password) + ':' + String(salt) + ':' + PEPPER;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/**
 * 会員のパスワードを検証する。
 * ・saltがあれば新方式（ハッシュ照合）
 * ・saltが無い場合は旧方式（平文）とみなし、一致すればその場でハッシュ方式に自動移行する
 */
function verifyMemberPassword(member, plainPassword) {
  const salt = member.salt;
  if (salt) {
    return hashPassword(plainPassword, salt) === String(member.password);
  }
  // 旧方式（移行期の互換処理）
  const stored = String(member.password ?? '').trim();
  if (!stored) return false;
  if (stored !== String(plainPassword).trim()) return false;
  try {
    const sheet   = getMembersSheet();
    const newSalt = makeSalt();
    const newHash = hashPassword(plainPassword, newSalt);
    sheet.getRange(member.row, COL.password).setValue(newHash);
    sheet.getRange(member.row, COL.salt).setValue(newSalt);
  } catch (e) { console.error('パスワード移行エラー:', e); }
  return true;
}

function isTruthy(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

/* =========================================
   ヘルパー
   ========================================= */
function nextId(list) {
  if (!list?.length) return 1;
  return Math.max(...list.map(i => Number(i.id) || 0)) + 1;
}

function makeToken() {
  const b = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmssSSS') + Math.random()
  );
  return b.map(x => ('0'+(x&0xff).toString(16)).slice(-2)).join('');
}

function makeTempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function ok(data)  { return res({ result:'success', ...(data||{}) }); }
function ng(msg)   { return res({ result:'error', message: msg }); }
function res(obj)  {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
