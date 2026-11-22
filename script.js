const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const jumpButtons = document.querySelectorAll('[data-target]');
const chips = document.querySelectorAll('.chip');
const stepIndicator = document.querySelector('#stepIndicator');
const prevStep = document.querySelector('#prevStep');
const nextStep = document.querySelector('#nextStep');
const printButtons = document.querySelectorAll('#printCard, #printCardInline');
const copyLink = document.querySelector('#copyLink');
const publicLink = document.querySelector('#publicLink');
const wordCountTextareas = document.querySelectorAll('[data-word-count]');
const steps = Array.from(pages).map(page => page.id);
let currentStep = steps.indexOf(document.querySelector('.active-page')?.id || steps[0]);

function updateStepIndicator() {
  const activePage = pages[currentStep];
  if (!stepIndicator || !activePage) return;
  stepIndicator.textContent = `第 ${currentStep + 1} / ${steps.length} 步 · ${activePage.dataset.title}`;
}

function showPage(target) {
  const nextIndex = steps.indexOf(target);
  if (nextIndex === -1) return;
  currentStep = nextIndex;
  pages.forEach(page => page.classList.toggle('active-page', page.id === target));
  navItems.forEach(item => item.classList.toggle('active', item.dataset.target === target));
  updateStepIndicator();
  // 第 6 步的前后对比要读第 3 步初稿与第 5 步修改稿，进页面时同步一次；
  // 进到对比页时顺带把修改前后的分数算出来，显示在两个标题旁边。
  syncRevisionTexts();
  if (target === 'review') renderRevisionScores();
  // 回到初稿页说明学生要重修，撤掉上一次的「已提交」状态。
  if (target === 'draft' || target === 'student-draft') resetFinishState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

jumpButtons.forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.target;
    if (target) showPage(target);
  });
});

prevStep?.addEventListener('click', () => {
  const target = steps[Math.max(0, currentStep - 1)];
  showPage(target);
});

nextStep?.addEventListener('click', () => {
  const target = steps[Math.min(steps.length - 1, currentStep + 1)];
  showPage(target);
});

printButtons.forEach(button => {
  button.addEventListener('click', () => window.print());
});

copyLink?.addEventListener('click', async () => {
  const text = publicLink?.textContent?.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const originalText = copyLink.textContent;
  copyLink.textContent = '已复制';
  setTimeout(() => { copyLink.textContent = originalText; }, 1400);
});

/* 证据卡里的 chip 不在这里统一处理：它们的状态要按「选中的那条线索」分别记录，
 * 见文件末尾的「修改证据卡」一节。 */

const clueCards = document.querySelectorAll('.clue-card');
clueCards.forEach(card => {
  card.addEventListener('click', () => {
    card.classList.toggle('selected');
  });
});

wordCountTextareas.forEach(textarea => {
  const counter = document.querySelector(`#${textarea.dataset.wordCount}`);
  if (!counter) return;
  const updateWordCount = () => {
    const words = textarea.value.trim().match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) || [];
    counter.textContent = words.length;
  };
  textarea.addEventListener('input', updateWordCount);
  updateWordCount();
});

updateStepIndicator();

/* ---------------------------------------------------------------------------
 * SEEK AI 线索卡 —— 真调后端
 *
 * 这里原来只有页面切换/打印逻辑，线索卡内容写死在 HTML 里。现在改成：
 *   POST /seek/clues  {essay}  →  {status, genre, wave, clues:{language,content}}
 *
 * 三条必须遵守的显示规则：
 *   1. status==='unavailable' 时**绝不能**显示成「没有发现问题」。旧实现在
 *      AI 挂掉时静默返回零错误，画面上和「AI 是空壳」一模一样，现场无法分辨。
 *   2. status==='degraded' 时正常显示线索，但明确标注这是降级结果。
 *   3. 卡片文案只用后端给的 question 字段。后端已保证它不含答案，
 *      前端不再拼接任何“应该改成…”的内容。
 * ------------------------------------------------------------------------- */

const SEEK_ENDPOINT = '/seek/clues';

/** 后端地址：同源优先（本地或被 cloudflared 隧道代理时都成立）。
 *  手机扫码这类跨设备场景，用 ?api=https://xxx.trycloudflare.com 覆盖。 */
function seekApiBase() {
  const override = new URLSearchParams(window.location.search).get('api');
  if (override) return override.replace(/\/+$/, '');
  if (window.SEEK_API_BASE) return String(window.SEEK_API_BASE).replace(/\/+$/, '');
  // 由本后端托管（static/seek/）时走同源，避免混合内容与跨域
  if (window.location.pathname.startsWith('/seek/')) return '';
  // 线上 GitHub Pages / 本地文件打开 → 回落到本地后端
  return 'http://localhost:8002';
}

/* 维度标签来自后端的 rubric 描述，不在前端写死 W/A/V/E——
 * 因为老师会再加因果类说明文和议论文，各有一套自己的维度命名。 */
let rubricDimensions = [];
let rubricInfo = null;

function dimensionLabel(key) {
  const d = rubricDimensions.find(x => x.key === key);
  if (!d) return key || '内容';
  return d.nameZh ? `${d.nameZh}（${d.name}）` : (d.name || key);
}

function applyRubricDescriptor(rubric) {
  if (!rubric) return;
  rubricInfo = rubric;
  if (Array.isArray(rubric.dimensions)) {
    rubricDimensions = rubric.dimensions;
  }
}

/** 0.5 显示成 0.5，整数不显示 .0 */
function fmtScore(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : String(n);
}

/* 评分说明。按老师定的口径讲给学生听：
 *   「内容表达达到了（  ）档，语言语法扣了（  ）分，本维最终（  ）分」
 * 学生端**不出现 B / D 这两个字母**——那是内部记法，学生看不懂也没必要看。
 * 教师端额外显示「内容基准 − 语言扣分」的原始明细，方便核对与校准。 */
function renderScoreSummary(payload) {
  const box = document.querySelector('#scoreSummary');
  if (!box) return;
  const assess = payload.assessment || {};
  box.innerHTML = '';

  if (!assess.applicable || !Array.isArray(assess.dimensions) || !assess.dimensions.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const isTeacher = document.body.dataset.view === 'teacher';
  const twoStage = !!(rubricInfo && rubricInfo.twoStage);

  const head = document.createElement('div');
  head.className = 'score-summary-head';
  head.textContent = twoStage
    ? `本篇评分：总分 ${fmtScore(assess.total)} / ${fmtScore(assess.max)}`
    : `本篇评分：总分 ${fmtScore(assess.total)} / ${fmtScore(assess.max)}`;
  box.appendChild(head);

  const list = document.createElement('ul');
  list.className = 'score-list';

  assess.dimensions.forEach(d => {
    const li = document.createElement('li');

    const name = document.createElement('b');
    name.textContent = d.nameZh || dimensionLabel(d.key);
    li.appendChild(name);

    const text = document.createElement('span');
    if (twoStage && d.contentBandLabel) {
      // 老师定的口径：讲档位 + 扣分 + 最终分，不出现 B / D
      let s = `内容表达达到了「${d.contentBandLabel}」档`;
      if (Number(d.languageDeduction) > 0) {
        s += `，语言语法扣了 ${fmtScore(d.languageDeduction)} 分`;
      } else {
        s += '，语言语法没有扣分';
      }
      s += `，本维最终 ${fmtScore(d.score)} / ${fmtScore(d.max)} 分`;
      text.textContent = s;
    } else {
      text.textContent = `${d.bandLabel || ''}档，${fmtScore(d.score)} / ${fmtScore(d.max)} 分`;
    }
    li.appendChild(text);

    if (isTeacher && twoStage) {
      const raw = document.createElement('em');
      raw.className = 'score-raw';
      raw.textContent =
        `（内容基准 ${fmtScore(d.contentBase)} − 语言扣分 ${fmtScore(d.languageDeduction)}`
        + ` = ${fmtScore(d.score)}${d.deductionCapped ? '，已按上限封顶' : ''}）`;
      li.appendChild(raw);
    }
    list.appendChild(li);
  });

  box.appendChild(list);

  if (isTeacher && twoStage) {
    const tail = document.createElement('div');
    tail.className = 'score-summary-tail';
    tail.textContent =
      `内容基准合计 ${fmtScore(assess.totalContentBase)}，语言扣分合计 ${fmtScore(assess.totalLanguageDeduction)}`;
    box.appendChild(tail);
  }
}

const clueGrid = document.querySelector('#clueGrid');
const clueStatus = document.querySelector('#clueStatus');
const fetchCluesBtn = document.querySelector('#fetchCluesBtn');
const refetchCluesBtn = document.querySelector('#refetchCluesBtn');

function setClueStatus(kind, text) {
  if (!clueStatus) return;
  clueStatus.className = 'clue-status' + (kind ? ' is-' + kind : '');
  clueStatus.textContent = text || '';
}

function clearClueGrid() {
  if (clueGrid) clueGrid.innerHTML = '';
}

function renderPlaceholder(text) {
  clearClueGrid();
  if (!clueGrid) return;
  const p = document.createElement('p');
  p.className = 'clue-placeholder';
  p.textContent = text;
  clueGrid.appendChild(p);
}

function renderClueCard(clue) {
  const card = document.createElement('article');
  card.className = 'clue-card';

  const isLanguage = clue.line === 'language';

  const badge = document.createElement('i');
  badge.textContent = isLanguage ? '✎' : (clue.dimension || '·');

  const label = document.createElement('span');
  label.textContent = isLanguage
    ? (clue.typeName || '语言')
    : (dimensionLabel(clue.dimension) || clue.dimensionName || '内容');

  const title = document.createElement('h3');
  title.textContent = isLanguage
    ? (clue.typeName || '语言问题')
    : (clue.problemLabel || clue.dimensionName || '内容问题');

  card.appendChild(badge);
  card.appendChild(label);
  card.appendChild(title);

  // 语言卡显示「第 N 句 + 原文片段」，内容卡显示触发它的那句原文。
  const meta = document.createElement('p');
  if (isLanguage && clue.snippet) {
    meta.textContent = clue.sentenceIndex
      ? '第 ' + clue.sentenceIndex + ' 句「' + clue.snippet + '」'
      : '「' + clue.snippet + '」';
  } else if (clue.evidence) {
    meta.textContent = (clue.paragraphIndex ? '第 ' + clue.paragraphIndex + ' 段 · ' : '') + clue.evidence;
  } else if (clue.paragraphIndex) {
    meta.textContent = '第 ' + clue.paragraphIndex + ' 段';
  }
  if (meta.textContent) card.appendChild(meta);

  const q = document.createElement('strong');
  q.textContent = '问题：' + clue.question;
  card.appendChild(q);

  card.addEventListener('click', () => card.classList.toggle('selected'));
  return card;
}

function renderResponse(payload) {
  clearClueGrid();
  const language = (payload.clues && payload.clues.language) || [];
  const content = (payload.clues && payload.clues.content) || [];
  applyRubricDescriptor(payload.rubric);
  renderScoreSummary(payload);
  // 记下这次给初稿算出的总分：第 6 步的 Before Revision 直接复用，
  // 既省一次调用，也保证学生看到的分数前后一致。
  {
    const assess = payload.assessment || {};
    if (draftTextEl && assess.applicable && typeof assess.total === 'number') {
      draftAssessment = { text: draftTextEl.value.trim(), total: assess.total };
    }
  }
  const all = language.concat(content);
  const warnings = payload.warnings || [];
  const guardRejected = (payload.guard && payload.guard.rejectedCount) || 0;

  if (payload.status === 'unavailable') {
    // 关键：这不是「没问题」，是「没查成」。
    setClueStatus('error',
      'AI 暂时不可用，本次没有完成检测 —— 这不代表你的作文没有问题。' +
      '请点「重新生成线索」再试一次。');
  } else if (payload.status === 'degraded') {
    setClueStatus('warn', 'AI 暂时不可用，已改用本地规则做基础检查，结果可能不完整。');
  } else if (all.length === 0) {
    setClueStatus('ok', 'AI 读完了这篇作文，没有发现需要你自己再想一遍的地方。');
  } else {
    const parts = [];
    if (language.length) parts.push('语言线索 ' + language.length + ' 条');
    if (content.length) parts.push('内容线索 ' + content.length + ' 条');
    setClueStatus('ok', 'AI 读完这篇作文，给出 ' + parts.join('、') + '。选你打算处理的那几条。');
  }

  if (!all.length) {
    renderPlaceholder(payload.status === 'unavailable'
      ? 'AI 没连上，先别急着改 —— 稍后重试。'
      : '暂时没有线索，可以自己再读一遍全文。');
  } else {
    all.forEach(clue => clueGrid.appendChild(renderClueCard(clue)));
  }

  // 教师端/评审可看的补充信息
  warnings.forEach(w => {
    const p = document.createElement('p');
    p.className = 'clue-note';
    p.textContent = '· ' + w;
    clueGrid.appendChild(p);
  });
  if (guardRejected > 0) {
    const p = document.createElement('p');
    p.className = 'clue-note';
    p.textContent = '· 有 ' + guardRejected + ' 条候选线索因“可能包含答案”被系统拦截，未显示。';
    clueGrid.appendChild(p);
  }

  // 把这一轮的线索交给修改证据卡，让学生在第 5 步从里面挑一条（而不是自己手输）。
  setCardClues(all);
}

/* ── 稳健请求：自动重试 + 断网降级 ────────────────────────────────────
 *
 * 为什么要有这一层：
 *   原来请求失败只显示一句话让用户自己再点。课堂上有 40 个学生同时用，
 *   网络抖动、后端瞬时 502、AI 忙都是常态，要学生反复手点体验很差。
 *   这里做三件事：
 *     1. 可重试的失败（网络异常 / 5xx / 429）自动重试一次，重试有可见提示
 *     2. 明确区分「断网」与「服务出错」——两种给学生的话术完全不同
 *     3. 断网时不去做无意义的重试，避免白等
 * ────────────────────────────────────────────────────────────────────── */

const CLUE_RETRY_DELAYS_MS = [1500];   // 最多自动重试 1 次

function isOfflineNow() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 返回 true 表示这个 HTTP 状态码值得重试。 */
function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
}

/**
 * 带自动重试的 fetch。
 * @param {string} url
 * @param {object} options
 * @param {(attempt:number)=>void} [onRetry] 每次准备重试时回调，用于更新界面提示
 */
async function fetchWithClueRetry(url, options, onRetry) {
  let lastError = null;

  for (let attempt = 0; attempt <= CLUE_RETRY_DELAYS_MS.length; attempt++) {
    // 断网时直接失败，不去等超时
    if (isOfflineNow()) {
      const err = new Error('offline');
      err.offline = true;
      throw err;
    }

    try {
      const res = await fetch(url, options);
      if (isRetryableStatus(res.status) && attempt < CLUE_RETRY_DELAYS_MS.length) {
        lastError = new Error('HTTP ' + res.status);
        if (onRetry) onRetry(attempt + 1);
        await sleepMs(CLUE_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      // 断网错误不重试（重试也没用，只会让学生白等）
      if (isOfflineNow()) {
        const off = new Error('offline');
        off.offline = true;
        throw off;
      }
      if (attempt < CLUE_RETRY_DELAYS_MS.length) {
        if (onRetry) onRetry(attempt + 1);
        await sleepMs(CLUE_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('请求失败');
}

/* ── 草稿持久化（防丢稿）────────────────────────────────────────────
 * 学生写了几百词，页面一刷新就全没了，是最伤的一种失败。
 * 这里把初稿与修改稿实时存本地，重新打开自动恢复。
 * 演示复位用 ?essay= 参数，那种情况下以 URL 为准，不被旧缓存盖掉。
 * ──────────────────────────────────────────────────────────────────── */

const DRAFT_STORAGE_KEY = 'seek.draft.v1';
const REVISED_STORAGE_KEY = 'seek.revised.v1';

function storageSafe() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    // 隐私模式下 setItem 会抛异常，先探一次
    const probe = '__seek_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch (e) {
    return null;
  }
}

/** 把 textarea 内容存进本地。失败静默——存不了也不能影响评分。 */
function persistTextarea(el, key) {
  if (!el) return;
  const store = storageSafe();
  if (!store) return;
  try {
    const v = el.value || '';
    if (v.trim()) store.setItem(key, v);
    else store.removeItem(key);
  } catch (e) { /* 忽略 */ }
}

/** 恢复 textarea 内容；已有内容或 URL 带 ?essay= 时不覆盖。 */
function restoreTextarea(el, key) {
  if (!el) return false;
  const store = storageSafe();
  if (!store) return false;
  try {
    if ((el.value || '').trim()) return false;      // 已有内容，不覆盖
    const saved = store.getItem(key);
    if (!saved || !saved.trim()) return false;
    el.value = saved;
    return true;
  } catch (e) {
    return false;
  }
}

/** 给 textarea 挂上「输入即保存」与「打开即恢复」。 */
function wireDraftPersistence(el, key) {
  if (!el) return;
  restoreTextarea(el, key);
  let timer = null;
  el.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persistTextarea(el, key), 400);
  });
  // 关页面前再存一次，避免最后一次输入没来得及落盘
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', () => persistTextarea(el, key));
  }
}

async function requestClues() {
  const draft = document.querySelector('#draftText');
  const essay = draft ? draft.value.trim() : '';

  if (!essay) {
    renderPlaceholder('还没有初稿。先自己写一段，再来拿线索。');
    setClueStatus('warn', '先写下你的初稿，再让 AI 看。');
    return;
  }

  setClueStatus('loading', 'AI 正在读你的作文…（通常几秒到二十几秒）');
  renderPlaceholder('AI 正在读你的作文，请稍等…');
  if (refetchCluesBtn) refetchCluesBtn.disabled = true;

  try {
    const res = await fetchWithClueRetry(seekApiBase() + SEEK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        essay: essay,
        rubricId: currentRubricId(),
        stage: 'draft'
      })
    }, (attempt) => {
      // 重试时让学生看见"系统在自动重试"，而不是干等
      setClueStatus('loading', `网络有点不稳，正在自动重试（第 ${attempt} 次）…`);
    });
    const payload = await res.json();
    if (!res.ok) {
      // 后端明确报错：优先说后端给的可读原因，别再让学生看 8002 端口。
      setClueStatus('error', '暂时无法处理：' + (payload.detail || payload.error || ('HTTP ' + res.status)));
      renderPlaceholder('这次没能拿到线索。请稍后重试，或先自己检查一遍作文。');
      return;
    }
    renderResponse(payload);
    // AI 忙导致时间预算用尽：必须明确告诉学生"不是你的作文有问题"，
    // 否则线索区是空的，看起来像"没发现问题"——那是最容易误导人的一种失败。
    if (payload && payload.aiBusy) {
      setClueStatus('warn', payload.userMessage || 'AI 现在很忙，请停几秒再点一次。');
      renderPlaceholder(payload.userMessage || 'AI 现在很忙，这次没读完。请稍后点「重新生成线索」。');
    } else if (payload && payload.status === 'error') {
      setClueStatus('error', payload.userMessage || payload.error || '处理失败，请稍后重试。');
    }
  } catch (err) {
    // 分两种失败，给学生的说法完全不同：
    //   断网 —— 是网络问题，稿子还在，联网后重试即可
    //   其它 —— 服务端出错或返回了非 JSON（隧道/代理页面），技术细节只留给老师
    if (err && err.offline) {
      setClueStatus('error', '网络已断开。你的初稿没有丢，连上网络后点「重新生成线索」即可。');
      renderPlaceholder('网络已断开，暂时拿不到线索。初稿还在，检查网络后点「重新生成线索」。');
    } else {
      const detail = err && err.message ? err.message : String(err);
      setClueStatus('error', '连不上评分服务，请稍后重试。（技术信息：' + detail.slice(0, 60) + '）');
      renderPlaceholder('连不上评分服务。请检查网络后点「重新生成线索」再试一次。');
    }
  } finally {
    if (refetchCluesBtn) refetchCluesBtn.disabled = false;
  }
}

if (fetchCluesBtn) fetchCluesBtn.addEventListener('click', () => { requestClues(); });
if (refetchCluesBtn) refetchCluesBtn.addEventListener('click', () => { requestClues(); });

/* 演示便利：地址栏参数一键复位。
 *   ?essay=<文本>   预填初稿
 *   ?autoclue=1     自动跳到线索页并取线索
 * 录演示视频时每条 take 之间用它复位，不用每次都手打一段作文。
 * 例：/seek/student.html?essay=Chen%20Tao%20was%20a%20doctor...&autoclue=1
 * 也用于自动化前端自检。 */
/* ---------------------------------------------------------------------------
 * 修改证据卡（第 5 步）与前后对比（第 6 步）
 *
 * 这里修的是「链路断开」：
 *   · S/Search 原来是一个预填了假问题的手输框，与第 4 步 AI 给的线索毫无关系
 *     → 改成从第 4 步的线索里点选；每条线索各自保留自己的三个选择题
 *   · 末尾原来是 `I added ___ because ___.` 两个单行填空
 *     → 改成整段 Revised Draft（与第 3 步 My First Draft 同一种控件）
 *   · 第 6 步的 Before/After 原来是两段写死的不同文字（学生从没写过 After）
 *     → 改成实时读第 3 步初稿与第 5 步修改稿
 * 目标：画面上每一处都是学生真实输入，没有预置内容。
 * ------------------------------------------------------------------------- */

const cluePicker = document.querySelector('#cluePicker');
const clueSelectedText = document.querySelector('#clueSelectedText');
const clueFollowup = document.querySelector('#clueFollowup');
const revisedDraftEl = document.querySelector('#revisedDraft');
const beforeRevisionEl = document.querySelector('#beforeRevision');
const afterRevisionEl = document.querySelector('#afterRevision');
const draftTextEl = document.querySelector('#draftText');
const stripActionEl = document.querySelector('#stripAction');
const stripReasonEl = document.querySelector('#stripReason');
const stripEffectEl = document.querySelector('#stripEffect');

//: 三个选择题组 → 它们各自写回哪一份状态
const CARD_GROUPS = [
  { key: 'explain', row: 'chipsExplain' },
  { key: 'enhance', row: 'chipsEnhance' },
  { key: 'keep', row: 'chipsKeep' },
];

let cardClues = [];
let selectedClue = null;
//: 每条线索各记一份选择，切换线索时不丢；键是线索在数组里的序号。
const cardSelections = new Map();

function clueState(index) {
  if (!cardSelections.has(index)) {
    cardSelections.set(index, { explain: new Set(), enhance: new Set(), keep: new Set() });
  }
  return cardSelections.get(index);
}

function clueSummary(clue) {
  if (!clue) return '';
  const who = clue.line === 'language'
    ? (clue.typeName || '语言问题')
    : (dimensionLabel(clue.dimension) || '内容问题');
  const quote = clue.snippet || clue.evidence || '';
  if (quote) return who + '：' + quote;
  // 内容线有时会丢掉原文里找不到的 evidence（例如模型引的不是原句），
  // 这时不能只剩一个维度名——补上问题标签，否则按钮看起来像空的。
  const tag = clue.problemLabel || clue.typeName || '';
  return tag ? who + '：' + tag : who;
}

/** 供 renderResponse 调用：把这一轮的线索交给证据卡。 */
function setCardClues(clues) {
  cardClues = Array.isArray(clues) ? clues.slice() : [];
  cardSelections.clear();
  selectedClue = null;
  renderCluePicker();
  renderChipStates();
  renderEvidenceStrip();
}

function renderCluePicker() {
  if (!cluePicker) return;
  cluePicker.innerHTML = '';
  if (!cardClues.length) {
    const p = document.createElement('p');
    p.className = 'clue-picker-hint';
    p.textContent = '还没有线索。先点上一步的「Get AI Clues / 查看 AI 线索」，再回来选一条。';
    cluePicker.appendChild(p);
    if (clueSelectedText) clueSelectedText.hidden = true;
    if (clueFollowup) clueFollowup.hidden = true;
    return;
  }
  cardClues.forEach((clue, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clue-option';
    btn.dataset.clueIndex = String(index);
    btn.textContent = clueSummary(clue);
    btn.addEventListener('click', () => selectClue(index));
    cluePicker.appendChild(btn);
  });
}

function selectClue(index) {
  selectedClue = index;
  if (cluePicker) {
    cluePicker.querySelectorAll('.clue-option').forEach(btn => {
      btn.classList.toggle('selected', Number(btn.dataset.clueIndex) === index);
    });
  }
  const clue = cardClues[index];
  if (clueSelectedText) {
    clueSelectedText.textContent = clue && clue.question
      ? clueSummary(clue) + '　→　' + clue.question
      : clueSummary(clue);
    clueSelectedText.hidden = false;
  }
  if (clueFollowup) clueFollowup.hidden = false;
  renderChipStates();
  renderEvidenceStrip();
}

function renderChipStates() {
  const st = selectedClue === null ? null : clueState(selectedClue);
  CARD_GROUPS.forEach(group => {
    const host = document.querySelector('#' + group.row);
    if (!host) return;
    host.querySelectorAll('.chip').forEach(btn => {
      const on = !!st && st[group.key].has(btn.textContent.trim());
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
}

CARD_GROUPS.forEach(group => {
  const host = document.querySelector('#' + group.row);
  if (!host) return;
  host.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      if (selectedClue === null) return;   // 先选线索，再答三个问题
      const set = clueState(selectedClue)[group.key];
      const label = btn.textContent.trim();
      if (set.has(label)) set.delete(label); else set.add(label);
      renderChipStates();
      renderEvidenceStrip();
    });
  });
});

/** 第 6 步的 Action / Reason / Effect 由学生在证据卡里的选择推出来，不预置。 */
function renderEvidenceStrip() {
  const st = selectedClue === null ? null : clueState(selectedClue);
  const pick = key => (st ? Array.from(st[key]) : []);
  const fallback = '（先在修改卡里选择）';
  const action = pick('enhance').join('、');
  const reason = pick('explain').join('、');
  const effect = pick('keep').join('、');
  if (stripActionEl) stripActionEl.textContent = action || fallback;
  if (stripReasonEl) stripReasonEl.textContent = reason || fallback;
  if (stripEffectEl) stripEffectEl.textContent = effect || fallback;
}

/** 第 6 步 Before/After 永远读真实输入，不显示任何预置文字。 */
function syncRevisionTexts() {
  if (beforeRevisionEl && draftTextEl) {
    const t = draftTextEl.value.trim();
    beforeRevisionEl.textContent = t || '（还没有初稿。先写一份初稿。）';
  }
  if (afterRevisionEl && revisedDraftEl) {
    const t = revisedDraftEl.value.trim();
    afterRevisionEl.textContent = t || '（还没有修改稿。先在修改卡里写修改稿。）';
  }
}

/* ── 第 6 步：给修改前后各打一个分，写在两个标题旁边 ──────────────────
 * 用的是同一套 SEEK 量表（第 2 步选的文体），所以分数和第 4 页学生看到的
 * 是同一把尺子；不用 /api/evaluate/essay，那是另一套评分器、尺度不同。
 * 初稿的分优先复用第 4 页已经算出的结果（同一篇，省一次调用也保证一致）；
 * 修改稿需要新算一次。 */

const scoreBeforeEl = document.querySelector('#scoreBefore');
const scoreAfterEl = document.querySelector('#scoreAfter');
//: 第 4 页评过的初稿 → 直接拿来当 Before 的分
let draftAssessment = { text: null, total: null };
//: 修改稿文本 → 分数，避免重复请求
const revisionScoreCache = new Map();

function setRevScore(el, state, total) {
  if (!el) return;
  el.classList.toggle('pending', state === 'pending');
  if (state === 'pending') {
    el.textContent = '评分中…';
    el.hidden = false;
  } else if (state === 'ok') {
    el.textContent = total + ' / 100';
    el.hidden = false;
  } else if (state === 'failed') {
    el.textContent = '评分失败';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/** 调一次 SEEK 评分，只取总分。失败返回 null（不显示假分数）。
 *  stage 只用来给课堂记录打标签（初稿/修改稿），不参与评分。 */
async function scoreEssay(essay, stage) {
  try {
    const res = await fetch(seekApiBase() + SEEK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ essay: essay, rubricId: currentRubricId(), stage: stage || 'draft' })
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const total = payload && payload.assessment && payload.assessment.total;
    return typeof total === 'number' ? total : null;
  } catch (err) {
    return null;
  }
}

let revisionScoring = false;

async function renderRevisionScores(force) {
  const draft = draftTextEl ? draftTextEl.value.trim() : '';
  const revised = revisedDraftEl ? revisedDraftEl.value.trim() : '';

  // Before：第 4 页算过就用现成的；没算过才现取
  if (!draft) {
    setRevScore(scoreBeforeEl, 'none');
  } else if (draftAssessment.text === draft && draftAssessment.total !== null && !force) {
    setRevScore(scoreBeforeEl, 'ok', draftAssessment.total);
  } else {
    setRevScore(scoreBeforeEl, 'pending');
  }

  // After：需要新算
  if (!revised) {
    setRevScore(scoreAfterEl, 'none');
  } else if (revisionScoreCache.has(revised) && !force) {
    setRevScore(scoreAfterEl, 'ok', revisionScoreCache.get(revised));
  } else {
    setRevScore(scoreAfterEl, 'pending');
  }

  // 有待算的就发请求（同一时刻只跑一轮，避免进页面时并发重复打）
  // force 必须同时绕过两个缓存，否则「强制重算」会一次都不请求。
  const needBefore = !!draft && (force || !(draftAssessment.text === draft && draftAssessment.total !== null));
  const needAfter = !!revised && (force || !revisionScoreCache.has(revised));
  if ((!needBefore && !needAfter) || revisionScoring) return;

  revisionScoring = true;
  try {
    if (needBefore) {
      const total = await scoreEssay(draft, 'draft');
      if (total === null) setRevScore(scoreBeforeEl, 'failed');
      else {
        draftAssessment = { text: draft, total: total };
        setRevScore(scoreBeforeEl, 'ok', total);
      }
    }
    if (needAfter) {
      const total = await scoreEssay(revised, 'revision');
      if (total === null) setRevScore(scoreAfterEl, 'failed');
      else {
        revisionScoreCache.set(revised, total);
        setRevScore(scoreAfterEl, 'ok', total);
      }
    }
  } finally {
    revisionScoring = false;
  }
}

draftTextEl?.addEventListener('input', syncRevisionTexts);
revisedDraftEl?.addEventListener('input', syncRevisionTexts);
syncRevisionTexts();

/* 学生端（student.html）与本页共用这一个 script.js，但学生页没有证据卡的新结构。
 * 上面已经按「选中的线索」接管了本页三个选择题组，所以这里要给**其余** chip 保留
 * 原来的简单勾选行为——否则学生页那 12 个按钮会全部点不动。 */
(function wireLooseChips() {
  const managed = ['chipsExplain', 'chipsEnhance', 'chipsKeep']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const insideManaged = el => {
    let node = el;
    while (node) {
      if (managed.indexOf(node) !== -1) return true;
      node = node.parentElement || node.parent || null;
    }
    return false;
  };
  document.querySelectorAll('.chip').forEach(chip => {
    if (insideManaged(chip)) return;
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });
})();

/* ---------------------------------------------------------------------------
 * 文体 → 量表维度：第 2 步选文体，右边的 Rubric Dimensions 跟着换。
 *
 * 三个文体的维度名都来自老师的材料（WAVE／PACE／PACT 各四维、每维 25、总分 100）。
 * 三个量表均已接入评分（WAVE／PACE／PACT 的教师亲评锚点均通过逐维验收）。
 * 所以选中它们时面板下方会给出一句说明，不假装已经能评。
 * ------------------------------------------------------------------------- */

const GENRE_RUBRICS = {
  wave: {
    name: 'WAVE · 人物传记',
    active: true,
    rubricId: 'wave-biography',
    dims: [['W', 'Who'], ['A', 'Actions'], ['V', 'Values'], ['E', 'Echo']],
  },
  pace: {
    name: 'PACE · 因果关系说明文',
    active: true,
    rubricId: 'causal-exposition',
    dims: [['P', 'Phenomenon'], ['A', 'Analysis'], ['C', 'Consequences'], ['E', 'Evaluation']],
  },
  pact: {
    name: 'PACT · 议论文',
    active: true,
    rubricId: 'argumentative',
    dims: [['P', 'Position'], ['A', 'Arguments'], ['C', 'Counter'], ['T', 'To sum up']],
  },
};

/* ── 第 2 步的写作话题 ────────────────────────────────────────────────
 * 题目原文来自老师提供的《SEEK 三种文体 15 个题目与 45 篇分层样文》，
 * 每种文体 5 题、每题 3 篇样文（好/中/差）。
 * 切换文体时话题列表必须跟着换，否则会出现「议论文量表 + 传记题目」的错配，
 * 演示时一眼就能看出来。原有的 3 条示例话题不删除，归在人物传记下
 *（它们本身就是传记题），在页面加载时从 HTML 里读取保留。
 */
const TOPICS_BY_FRAMEWORK = {
  wave: [
    { no: '01', en: 'The Life of a Teacher I Admire', zh: '一位我敬佩的教师的人生' },
    { no: '02', en: "My Grandmother's Life Story", zh: '我的祖母的人生故事' },
    { no: '03', en: "A Doctor's Life of Service", zh: '一位医生奉献的人生' },
    { no: '04', en: 'The Life of a Young Volunteer', zh: '一位青年志愿者的人生经历' },
    { no: '05', en: 'An Athlete Who Never Gives Up', zh: '一位永不放弃的运动员' },
  ],
  pace: [
    { no: '06', en: 'Staying Up Late: Causes and Effects', zh: '熬夜的原因与影响' },
    { no: '07', en: 'Putting Off Assignments: Causes and Effects', zh: '拖延完成作业的原因与影响' },
    { no: '08', en: 'Taking Part-Time Jobs: Reasons and Effects', zh: '大学生兼职的原因与影响' },
    { no: '09', en: 'Food Waste on Campus: Causes and Effects', zh: '校园食物浪费的原因与影响' },
    { no: '10', en: 'Learning English Online: Reasons and Effects', zh: '在线学习英语的原因与影响' },
  ],
  pact: [
    { no: '11', en: 'Should Students Use AI in English Writing?', zh: '学生是否应该在英语写作中使用 AI' },
    { no: '12', en: 'Should Class Attendance Count Toward Grades?', zh: '课堂出勤是否应该计入成绩' },
    { no: '13', en: 'Should Mobile Phones Be Allowed in Class?', zh: '课堂上是否应该允许使用手机' },
    { no: '14', en: 'Should Students Be Free to Change Majors?', zh: '大学生是否应该可以自由转专业' },
    { no: '15', en: 'Should Projects Replace Some Written Exams?', zh: '是否应该用项目任务替代部分笔试' },
  ],
};

/** 本次请求用哪个量表：第 2 步选的文体优先，其次 URL 的 ?rubric=<id>，否则用默认量表。 */
function currentRubricId() {  const fromDropdown = taskFrameworkEl && taskFrameworkEl.value
    ? (GENRE_RUBRICS[taskFrameworkEl.value] || {}).rubricId
    : null;
  const fromUrl = new URLSearchParams(window.location.search).get('rubric');
  return fromDropdown || fromUrl || null;
}

/** 由量表 id 反查文体键（学生端没有下拉框，只能靠链接上的 ?rubric=）。 */
function genreKeyForRubricId(rubricId) {
  const found = Object.keys(GENRE_RUBRICS)
    .find(k => GENRE_RUBRICS[k].rubricId === rubricId);
  return found || 'wave';
}

const taskFrameworkEl = document.querySelector('#taskFramework');
const taskTopicEl = document.querySelector('#taskTopic');
const rubricFrameworkEl = document.querySelector('#rubricFramework');
const rubricListEl = document.querySelector('#rubricList');
const rubricTotalEl = document.querySelector('#rubricTotal');
const rubricNoteEl = document.querySelector('#rubricNote');

/* 保留 HTML 里原有的 3 条示例话题：老师要求不要删。
   页面加载时读一次，之后每次重建下拉都把这一组重新挂回去。 */
const ORIGINAL_TOPICS = taskTopicEl
  ? [...taskTopicEl.querySelectorAll('option')].map(o => ({
      value: o.value || o.textContent.trim(),
      label: o.textContent.trim(),
    }))
  : [];

/** 按文体重建话题下拉：老师本册的 5 题 +（人物传记下）原有的示例话题。 */
function renderTopicOptions(key) {
  if (!taskTopicEl) return;
  const spec = TOPICS_BY_FRAMEWORK[key] || [];
  const previous = taskTopicEl.value;
  taskTopicEl.innerHTML = '';

  if (spec.length) {
    const group = document.createElement('optgroup');
    group.label = '本册题目（老师提供）';
    spec.forEach(t => {
      const o = document.createElement('option');
      o.value = `${t.no} ${t.en}`;
      o.textContent = `${t.no} ${t.en}（${t.zh}）`;
      group.appendChild(o);
    });
    taskTopicEl.appendChild(group);
  }

  // 原有的 3 条只挂在人物传记下——它们本身就是传记题
  if (key === 'wave' && ORIGINAL_TOPICS.length) {
    const group = document.createElement('optgroup');
    group.label = '示例话题（原有）';
    ORIGINAL_TOPICS.forEach(t => {
      const o = document.createElement('option');
      o.value = t.value;
      o.textContent = t.label;
      group.appendChild(o);
    });
    taskTopicEl.appendChild(group);
  }

  // 尽量留住原来的选择；若该题在新文体下已不存在，则回到第一项
  const keep = [...taskTopicEl.options].some(o => o.value === previous);
  taskTopicEl.value = keep ? previous : (taskTopicEl.options[0] || {}).value || '';
  syncTopicText();
}

/* ── 第 3 页的写作要求 ────────────────────────────────────────────────
 * 四条要求必须与当前文体对应。原来写死的是传记那套
 *（Introduce who the person is…），切到议论文还显示人物传记的要求，
 * 和话题下拉是同一类不一致。这里按量表四维给出每文体的四条。
 */
const REQUIREMENTS_BY_FRAMEWORK = {
  wave: [
    '交代这个人是谁、与你的关系。',
    '写一件具体发生过的事。',
    '通过这件事体现一种明确的品质。',
    '写出你从中学到了什么。',
  ],
  pace: [
    '清楚界定要说明的现象。',
    '分析造成这一现象的主要原因。',
    '写清这一现象带来的后果与影响。',
    '给出你的综合评价。',
  ],
  pact: [
    '明确亮出你的立场。',
    '给出理由与证据。',
    '回应反方观点。',
    '收束全文，总结论证。',
  ],
};

const writingRequirementsEl = document.querySelector('#writingRequirements');

/** 按文体重写四条写作要求。 */
function renderRequirements(key) {
  if (!writingRequirementsEl) return;
  const items = REQUIREMENTS_BY_FRAMEWORK[key] || REQUIREMENTS_BY_FRAMEWORK.wave;
  writingRequirementsEl.innerHTML = '';
  items.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    writingRequirementsEl.appendChild(li);
  });
}

/** 把当前选中的话题同步到学生端/证据卡上显示的话题文字。 */
function syncTopicText() {
  if (!taskTopicEl) return;
  const topic = taskTopicEl.value || '';
  const a = document.querySelector('#taskTopicText');
  const b = document.querySelector('#cardTopicText');
  if (a) a.textContent = topic;
  if (b) b.textContent = '话题：' + topic;
}

function renderRubricPanel(key) {
  const spec = GENRE_RUBRICS[key] || GENRE_RUBRICS.wave;
  if (rubricFrameworkEl) rubricFrameworkEl.textContent = spec.name;
  if (rubricListEl) {
    rubricListEl.innerHTML = '';
    spec.dims.forEach(pair => {
      const row = document.createElement('div');
      const letter = document.createElement('strong');
      letter.textContent = pair[0];
      const label = document.createElement('span');
      label.textContent = pair[1];
      const score = document.createElement('b');
      score.textContent = '25';
      row.appendChild(letter);
      row.appendChild(label);
      row.appendChild(score);
      rubricListEl.appendChild(row);
    });
  }
  if (rubricTotalEl) rubricTotalEl.textContent = String(spec.dims.length * 25);
  if (rubricNoteEl) {
    rubricNoteEl.textContent = spec.active
      ? ''
      : '该文体的评分规则已定稿，评分接口正在接入；此处先展示量表维度。';
    rubricNoteEl.hidden = spec.active;
  }
}

if (taskFrameworkEl) {
  // 教师端：文体由第 2 步的下拉框决定；话题列表跟着文体走
  renderRubricPanel(taskFrameworkEl.value);
  renderTopicOptions(taskFrameworkEl.value);
  renderRequirements(taskFrameworkEl.value);
  taskFrameworkEl.addEventListener('change', () => {
    renderRubricPanel(taskFrameworkEl.value);
    renderTopicOptions(taskFrameworkEl.value);
    renderRequirements(taskFrameworkEl.value);
  });
  if (taskTopicEl) {
    taskTopicEl.addEventListener('change', syncTopicText);
  }
} else if (rubricListEl) {
  // 学生端没有下拉框：量表由链接上的 ?rubric=<量表id> 决定，默认人物传记
  const stuKey = genreKeyForRubricId(new URLSearchParams(window.location.search).get('rubric'));
  renderRubricPanel(stuKey);
  renderRequirements(stuKey);
}

/* ── 课堂记录：概览与导出 ──────────────────────────────────────────────
 * 学生每评一次，后端就存一条（作文 + 分数），**不含任何使用者信息**。
 * 老师在这一页能看到收了多少篇、并一键导出 CSV。 */
const recordsSummaryEl = document.querySelector('#recordsSummary');
const recordsRefreshBtn = document.querySelector('#recordsRefresh');
const recordsExportEl = document.querySelector('#recordsExport');

async function refreshRecords() {
  if (!recordsSummaryEl) return;
  try {
    const res = await fetch(seekApiBase() + '/seek/records/summary');
    const s = await res.json();
    if (s.error) {
      recordsSummaryEl.textContent = '读取失败：' + s.error;
      return;
    }
    const parts = (s.byStage || []).map(g => `${g.stage === 'revision' ? '修改稿' : '初稿'} ${g.count} 篇`);
    const avg = (s.byStage || [])
      .filter(g => g.avgTotal !== null && g.avgTotal !== undefined)
      .map(g => `平均 ${g.avgTotal}`);
    recordsSummaryEl.textContent = s.total
      ? `已收 ${s.total} 条（${parts.join('、')}）${avg.length ? '，' + avg.join('、') : ''}`
      : '还没有记录。学生点「查看 AI 线索」后就会存下一条。';
    if (recordsExportEl) {
      // 带上 api 前缀，保证从公网隧道打开时也指向同一后端
      const base = seekApiBase() || '';
      recordsExportEl.href = base + '/seek/records/export';
    }
  } catch (err) {
    recordsSummaryEl.textContent = '读取失败：' + (err && err.message ? err.message : err);
  }
}

if (recordsRefreshBtn) {
  recordsRefreshBtn.addEventListener('click', refreshRecords);
  refreshRecords();
}

/* ── 第 6 步：修改完成后学生有两个选择 ─────────────────────────────────
 * 老师的定稿：取消「达到 80 分才能提交」的门槛。学生改完之后
 *   ① 直接提交结束，或 ② 回到第 3 步重修润色、再来一轮。
 * 提交只是一个明确的收尾状态——数据在每次评分时就已经存下来了。 */
const finishBtn = document.querySelector('#finishBtn');
const finishNoticeEl = document.querySelector('#finishNotice');

if (finishBtn) {
  finishBtn.addEventListener('click', () => {
    if (finishNoticeEl) {
      finishNoticeEl.textContent = '已提交，本次写作任务完成。';
      finishNoticeEl.hidden = false;
    }
    finishBtn.disabled = true;
    finishBtn.textContent = '已提交';
  });
}

/** 回到第 3 步重修时，把上一次的「已提交」状态撤掉——重新改就不算交过了。 */
function resetFinishState() {
  if (!finishBtn) return;
  finishBtn.disabled = false;
  finishBtn.textContent = '直接提交，结束';
  if (finishNoticeEl) {
    finishNoticeEl.hidden = true;
    finishNoticeEl.textContent = '';
  }
}

(function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const draft = document.querySelector('#draftText');

  // 老师可以在链接上指定任务与文体，学生端就不用改代码换题：
  //   student.html?rubric=argumentative&topic=Should%20universities...
  const topic = params.get('topic');
  if (topic) {
    // 如果这个题目在下拉里存在（老师从本册题目里挑的），就把它选中，
    // 这样页面上的话题与下拉框保持一致；否则只更新显示文字。
    const matched = taskTopicEl
      && [...taskTopicEl.options].find(o => o.value === topic || o.textContent.trim() === topic);
    if (matched) {
      taskTopicEl.value = matched.value;
      syncTopicText();
    } else {
      const a = document.querySelector('#taskTopicText');
      const b = document.querySelector('#cardTopicText');
      if (a) a.textContent = topic;
      if (b) b.textContent = '话题：' + topic;
    }
  }

  const essay = params.get('essay');
  if (essay && draft) {
    draft.value = essay;
    draft.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (params.get('autoclue') === '1' && draft && draft.value.trim()) {
    const host = clueGrid && clueGrid.closest('.page');
    if (host && host.id) showPage(host.id);
    requestClues();
  }
})();

/* ── 断网/恢复提示与草稿持久化接线 ───────────────────────────────────
 * 放在文件末尾：此时 DOM 已就绪，且不会影响上面的事件注册顺序。
 * ──────────────────────────────────────────────────────────────────── */

(function wireOfflineHandling() {
  if (typeof window === 'undefined' || !window.addEventListener) return;

  wireDraftPersistence(document.querySelector('#draftText'), DRAFT_STORAGE_KEY);
  wireDraftPersistence(document.querySelector('#revisedDraft'), REVISED_STORAGE_KEY);

  window.addEventListener('offline', () => {
    setClueStatus('error', '网络已断开。你的稿子还在本机，连上网络后可以继续。');
  });

  window.addEventListener('online', () => {
    // 恢复联网时不要自动重发请求（可能学生正在打字），只提示可以重试
    setClueStatus('warn', '网络已恢复。可以点「重新生成线索」继续。');
  });
})();
