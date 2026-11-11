'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const players = new Set();
let experimentData;
let toastTimer;
let reviewData;
let currentView;
const evidenceCache = new Map();
const videoIndex = new Map();
const reviewerMemory = new Map();

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 2200);
}

async function copyLink(anchor) {
  const url = new URL(location.href);
  url.hash = anchor;
  try {
    await navigator.clipboard.writeText(url.href);
    toast('Link copied');
  } catch (_) {
    const input = document.createElement('textarea');
    input.value = url.href;
    input.style.cssText = 'position:fixed;left:-9999px';
    document.body.append(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    toast(ok ? 'Link copied' : 'Copy this page’s address after opening the item link.');
    if (!ok) location.hash = anchor;
  }
}

document.addEventListener('click', event => {
  const copy = event.target.closest('[data-anchor]');
  if (copy) copyLink(copy.dataset.anchor);
});

function renderTable(target, headers, rows, options = {}) {
  const labels = options.labels || [0];
  const body = rows.map((row, i) => {
    const classes = [];
    if (options.highlight && options.highlight(row)) classes.push('highlight');
    if (options.group && i && row[0] !== rows[i - 1][0]) classes.push('group-start');
    return `<tr class="${classes.join(' ')}" data-people="${escapeHTML(row[0])}">${row.map((value, j) => `<td${labels.includes(j) ? ' class="label-cell"' : ''}>${escapeHTML(value)}</td>`).join('')}</tr>`;
  }).join('');
  $(`#${target}`).innerHTML = `<table aria-label="${escapeHTML(options.name || target)}"><thead><tr>${headers.map((value, j) => `<th scope="col"${labels.includes(j) ? ' class="label-cell"' : ''}>${escapeHTML(value)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function formatTime(value) {
  const seconds = Math.max(0, value || 0);
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

class ComparisonPlayer {
  constructor(group, host, options = {}) {
    this.group = group;
    this.playing = false;
    this.starting = false;
    this.destroyed = false;
    this.duration = Math.min(...group.videos.map(video => video.duration));
    this.audioIndex = 0;
    this.rate = 1;
    this.ignoreSeekUntil = 0;
    this.root = document.createElement('article');
    this.root.className = 'video-group';
    this.root.id = group.id;
    this.root.innerHTML = `
      <div class="video-group-heading">
        <div class="item-heading"><div><span class="item-code">${escapeHTML(group.code)}</span><h3>${escapeHTML(group.title || `${group.people}-person conversation`)}</h3></div><button class="copy-link" data-anchor="${group.id}" aria-label="Copy link to ${group.code}">Copy link ↗</button></div>
        ${group.description ? `<p class="video-description">${escapeHTML(group.description)}</p>` : ''}
      </div>
      <div class="video-grid" style="--cols:${group.videos.length}">${group.videos.map((video, i) => `
        <div class="video-cell">
          <div class="video-label"><span>${escapeHTML(video.label)}</span><a href="${video.src}" target="_blank" rel="noopener" aria-label="Open ${escapeHTML(video.label)} video for ${group.code}">Open ↗</a></div>
          <video controls playsinline muted preload="none" src="${video.src}" poster="${video.poster}" aria-label="${escapeHTML(group.code + ' — ' + video.label)}">Your browser does not support embedded video. <a href="${video.src}">Open video</a>.</video>
          ${video.prompt ? `<details><summary>Exact input prompt</summary><p>${escapeHTML(video.prompt)}</p></details>` : ''}
        </div>`).join('')}</div>
      <div class="player-controls">
        <button class="play-button" aria-label="Play all videos in ${group.code}">▶ Play together</button>
        <button class="restart-button" aria-label="Restart all videos in ${group.code}" title="Restart">↺</button>
        <input class="scrub" type="range" min="0" max="${this.duration}" step="0.01" value="0" aria-label="Seek all videos in ${group.code}">
        <output class="time-display">0:00 / ${formatTime(this.duration)}</output>
        <label class="control-select">Audio<select class="audio-select" aria-label="Audio source for ${group.code}">${group.videos.map((video, i) => `<option value="${i}">${escapeHTML(video.label)}</option>`).join('')}<option value="-1">Muted</option></select></label>
        <label class="control-select">Speed<select class="speed-select" aria-label="Playback speed for ${group.code}"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label>
      </div>
      <p class="player-status" role="status"></p>
      `;
    host.append(this.root);
    this.videos = $$('video', this.root);
    this.playButton = $('.play-button', this.root);
    this.scrub = $('.scrub', this.root);
    this.clock = $('.time-display', this.root);
    this.status = $('.player-status', this.root);
    this.playButton.addEventListener('click', () => this.playing || this.starting ? this.pause() : this.start());
    $('.restart-button', this.root).addEventListener('click', () => this.seek(0));
    this.scrub.addEventListener('input', () => this.seek(Number(this.scrub.value)));
    $('.audio-select', this.root).addEventListener('change', event => this.setAudio(Number(event.target.value)));
    $('.speed-select', this.root).addEventListener('change', event => {
      this.rate = Number(event.target.value);
      this.videos.forEach(video => { video.playbackRate = this.rate; });
    });
    this.videos.forEach((video, i) => {
      video.addEventListener('play', () => {
        if (!this.isVisible()) { video.pause(); return; }
        if (!this.starting && !this.playing) this.start(video);
      });
      video.addEventListener('pause', () => { if (this.playing && !this.starting && !this.seeking) this.pause(); });
      video.addEventListener('ended', () => this.pause());
      video.addEventListener('seeked', () => {
        if (Date.now() > this.ignoreSeekUntil && Math.abs(video.currentTime - Number(this.scrub.value)) > .12) this.seek(video.currentTime);
      });
      video.addEventListener('volumechange', () => { if (!video.muted && this.audioIndex !== i) this.setAudio(i); });
      video.addEventListener('error', () => { this.status.textContent = 'This video could not be loaded. Use its Open link to view it directly.'; });
    });
    this.setAudio(0);
    if (options.timeline) this.addTimeline(group);
    players.add(this);
  }

  setAudio(index) {
    this.audioIndex = index;
    $('.audio-select', this.root).value = String(index);
    this.videos.forEach((video, i) => { video.muted = i !== index; });
  }

  isVisible() {
    return this.root.isConnected && this.root.closest('#evidence-host') !== null;
  }

  async start(origin = null) {
    if (this.starting || this.destroyed || !this.isVisible()) return;
    for (const player of players) if (player !== this) player.pause();
    this.starting = true;
    this.status.textContent = 'Loading the comparison…';
    let startTime = origin ? origin.currentTime : Number(this.scrub.value);
    if (startTime >= this.duration - .12) startTime = 0;
    this.seek(startTime);
    this.setAudio(this.audioIndex);
    this.videos.forEach(video => { video.playbackRate = this.rate; });
    const attempts = await Promise.allSettled(this.videos.map(video => video.play()));
    if (this.destroyed || !this.starting || !this.isVisible()) {
      this.videos.forEach(video => video.pause());
      return;
    }
    this.starting = false;
    if (attempts.some(result => result.status === 'rejected')) {
      this.pause();
      this.status.textContent = 'Playback could not start for every video. Try Play together again, or use the individual Open links.';
      return;
    }
    this.playing = true;
    this.status.textContent = '';
    this.playButton.textContent = 'Ⅱ Pause together';
    this.playButton.setAttribute('aria-label', `Pause all videos in ${this.group.code}`);
    this.tick();
  }

  pause() {
    if (this.starting) this.status.textContent = '';
    this.playing = false;
    this.starting = false;
    this.videos.forEach(video => video.pause());
    cancelAnimationFrame(this.animation);
    this.playButton.textContent = '▶ Play together';
    this.playButton.setAttribute('aria-label', `Play all videos in ${this.group.code}`);
  }

  seek(time) {
    const position = Math.min(this.duration, Math.max(0, time));
    this.ignoreSeekUntil = Date.now() + 700;
    this.seeking = true;
    this.videos.forEach(video => {
      if (video.preload === 'none') video.preload = 'metadata';
      try { video.currentTime = position; } catch (_) { /* Browser applies pending seek after metadata. */ }
    });
    this.scrub.value = position;
    this.updateClock(position);
    this.seeking = false;
  }

  updateClock(time) {
    this.clock.textContent = `${formatTime(time)} / ${formatTime(this.duration)}`;
    $$('.turn', this.root).forEach(button => button.classList.toggle('active', time >= Number(button.dataset.start) && time < Number(button.dataset.end)));
  }

  tick() {
    if (!this.playing || this.destroyed) return;
    const time = this.videos[0].currentTime;
    this.scrub.value = time;
    this.updateClock(time);
    this.videos.slice(1).forEach(video => {
      if (video.readyState >= 2 && Math.abs(video.currentTime - time) > .2) {
        this.ignoreSeekUntil = Date.now() + 700;
        video.currentTime = time;
      }
    });
    if (time >= this.duration - .05) { this.pause(); return; }
    this.animation = requestAnimationFrame(() => this.tick());
  }

  addTimeline(group) {
    const timeline = document.createElement('div');
    timeline.className = 'timeline';
    timeline.innerHTML = `<h4>Annotated speaking intervals · click a segment to play</h4>${group.identities.map(person => `<div class="timeline-row"><span class="person-label">${escapeHTML(person.id)}</span><div class="timeline-track">${group.turns.filter(turn => turn.person === person.id).map(turn => `<button class="turn" style="left:${Math.min(100, turn.start/this.duration*100)}%;width:${Math.max(0, (Math.min(turn.end, this.duration)-turn.start)/this.duration*100)}%" data-start="${turn.start}" data-end="${turn.end}" title="${escapeHTML(person.id)}: ${turn.start.toFixed(2)}–${turn.end.toFixed(2)} s" aria-label="Play ${escapeHTML(person.id)} speaking interval starting at ${turn.start.toFixed(2)} seconds"></button>`).join('')}</div></div>`).join('')}<div class="identities">${group.identities.map(person => `<p><b>${escapeHTML(person.id)}</b>${escapeHTML(person.appearance)}</p>`).join('')}</div>`;
    this.root.append(timeline);
    $$('.turn', timeline).forEach(button => button.addEventListener('click', () => {
      this.seek(Number(button.dataset.start));
      if (!this.playing) this.start();
    }));
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.videos.forEach(video => { video.removeAttribute('src'); video.load(); });
    players.delete(this);
    this.root.remove();
  }
}

const evidenceLabels = {
  e1:['E1','Happy speech'], e2:['E2','Sad speech'], e3:['E3','Muting'], e4:['E4','Audio delay'],
  e5:['E5','Components'], e6:['E6','Training data'], e7:['E7','Data scale'],
  e8:['E8','Learning curves'], e9:['E9','Confidence intervals'], e10:['E10','Human agreement'],
  e11:['E11','Listener orientation'], e12:['E12','Listening gaze'], e13:['E13','Speaker change'],
  e14:['E14','Text comparison 1'], e15:['E15','Text comparison 2']
};

function normalizeEvidence(id) {
  if (id === 'e8-data') return 'e8';
  return id;
}

function getEvidence(id) {
  if (evidenceCache.has(id)) return evidenceCache.get(id);
  const group = videoIndex.get(id);
  if (!group) throw new Error(`Unknown experiment: ${id}`);
  const player = new ComparisonPlayer(group, $('#evidence-store'));
  const isText = experimentData.text.some(item => item.id === id);
  const isClip = experimentData.groupClips.some(item => item.id === id);
  const conditions = document.createElement('div');
  conditions.className = 'video-conditions';
  conditions.innerHTML = `<span>AnyTalker-14B</span><span>Seed ${isClip ? '45' : '44'}</span><span>${isText ? 'Only the instruction changes' : isClip ? 'Matched ground-truth interval' : 'One audio track changed'}</span>`;
  const heading = $('.video-group-heading', player.root);
  heading.append(conditions);
  if (!isText) {
    const prompt = document.createElement('p');
    prompt.className = 'prompt-note';
    prompt.textContent = `Fixed prompt: “${experimentData.genericPrompt}”`;
    heading.append(prompt);
  }
  const entry = {node:player.root, player};
  evidenceCache.set(id, entry);
  return entry;
}

function getQuestion(anchor) {
  for (const reviewer of reviewData.reviewers) {
    const question = reviewer.questions.find(item => item.anchor.toLowerCase() === anchor.toLowerCase());
    if (question) return {reviewer, question};
  }
  return null;
}

function defaultQuestionForEvidence(id) {
  if (/^(e11|e12|e13)$/.test(id)) return 'BdXy-Q4';
  if (/^e[1-4]$/.test(id)) return '9eqr-Q1';
  return {e5:'9eqr-Q2', e6:'BdXy-Q3', e7:'9eqr-Q4', e8:'9eqr-Q4', e9:'9eqr-Q3', e10:'q7Va-W2', e14:'BdXy-Q2', e15:'BdXy-Q2'}[id];
}

function resolveRoute() {
  let hash;
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
  const [questionAnchor, detail] = hash.split('/');
  const textOnlyFallbacks = {'9eqr-q5':'9eqr-W1', protocol:'9eqr-W1'};
  let match = getQuestion(questionAnchor) || getQuestion(textOnlyFallbacks[questionAnchor.toLowerCase()] || '');
  let requested = detail;
  if (!match) {
    const aliases = {audio:'e1', ablations:'e5', 'data-efficiency':'e7', intervals:'e9', 'human-agreement':'e10', 'group-conversations':'e13', 'text-instructions':'e14'};
    requested = aliases[hash] || hash;
    const owner = defaultQuestionForEvidence(normalizeEvidence(requested));
    match = getQuestion(owner || '9eqr-W1');
  }
  let evidence = normalizeEvidence(requested);
  if (!match.question.evidence.includes(evidence)) {
    evidence = match.question.evidence[0];
    requested = evidence;
  }
  return {...match, evidence, requested};
}

function navigate(questionAnchor, evidence = '') {
  const hash = questionAnchor + (evidence ? `/${evidence}` : '');
  if (location.hash.slice(1) === hash) showView();
  else location.hash = hash;
}

function renderReviewerTabs() {
  $('#reviewer-tabs').innerHTML = reviewData.reviewers.map(reviewer => `
    <button id="reviewer-tab-${reviewer.id}" class="reviewer-tab" role="tab" aria-controls="reviewer-panel" aria-selected="false" tabindex="-1" data-reviewer="${reviewer.id}">
      <span class="reviewer-name">${reviewer.id}</span><span class="reviewer-tab-description">${reviewer.questions.length} comments</span>
    </button>`).join('');
  $('#reviewer-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-reviewer]');
    if (!button) return;
    const reviewer = reviewData.reviewers.find(item => item.id === button.dataset.reviewer);
    navigate(reviewerMemory.get(reviewer.id) || reviewer.questions[0].anchor);
  });
}

function renderQuestionNav(reviewer) {
  $('#nav-reviewer').textContent = `Reviewer ${reviewer.id}`;
  $('#question-nav').innerHTML = [['W','Weaknesses'],['Q','Questions']].map(([prefix, name]) => `
    <div class="question-nav-group"><p>${name}</p>${reviewer.questions.filter(question => question.key.startsWith(prefix)).map(question => `
      <a href="#${question.anchor}" data-question="${question.anchor}"><b>${question.key}</b><span>${escapeHTML(question.title)}</span></a>`).join('')}</div>`).join('');
}

function renderEvidenceTabs(question) {
  $('#evidence-tabs').innerHTML = question.evidence.map(id => {
    const [code, label] = evidenceLabels[id];
    return `<button id="evidence-tab-${id}" role="tab" aria-controls="evidence-panel" aria-selected="false" tabindex="-1" data-evidence-tab="${id}"><b>${code}</b><span>${label}</span></button>`;
  }).join('');
}

function showView() {
  const view = resolveRoute();
  const reviewerChanged = !currentView || currentView.reviewer.id !== view.reviewer.id;
  const questionChanged = !currentView || currentView.question.anchor !== view.question.anchor;
  const evidenceChanged = !currentView || currentView.evidence !== view.evidence || currentView.requested !== view.requested;
  if (questionChanged || evidenceChanged) for (const player of players) player.pause();
  if (reviewerChanged) renderQuestionNav(view.reviewer);
  $$('#reviewer-tabs [role="tab"]').forEach(button => {
    const selected = button.dataset.reviewer === view.reviewer.id;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $('#reviewer-panel').setAttribute('aria-labelledby', `reviewer-tab-${view.reviewer.id}`);
  $$('#question-nav a').forEach(link => {
    const selected = link.dataset.question === view.question.anchor;
    link.classList.toggle('selected', selected);
    if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
  if (questionChanged) {
    $('#question-category').textContent = `Reviewer ${view.reviewer.id} · ${view.question.key}`;
    $('#question-title').textContent = view.question.title;
    $('#review-comment').textContent = view.question.comment;
    $('#question-intro').textContent = view.question.intro;
    $('#comment-source').href = reviewData.source;
    $('#copy-question').dataset.anchor = view.question.anchor;
    $('.evidence-section').hidden = view.question.evidence.length === 0;
    $('#evidence-count').textContent = view.question.evidence.length === 0 ? '' : view.question.evidence.length === 1 ? '1 result' : `${view.question.evidence.length} results`;
    renderEvidenceTabs(view.question);
    const index = view.reviewer.questions.indexOf(view.question);
    $('#previous-question').disabled = index === 0;
    $('#next-question').disabled = index === view.reviewer.questions.length - 1;
    $('#previous-question').textContent = index ? `← ${view.reviewer.questions[index-1].key}` : '← Previous';
    $('#next-question').textContent = index < view.reviewer.questions.length-1 ? `${view.reviewer.questions[index+1].key} →` : 'Next →';
    $('#question-position').textContent = `${index+1} of ${view.reviewer.questions.length} comments`;
  }
  $$('#evidence-tabs [role="tab"]').forEach(button => {
    const selected = button.dataset.evidenceTab === view.evidence;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const host = $('#evidence-host');
  if (view.evidence) {
    $('#evidence-panel').setAttribute('aria-labelledby', `evidence-tab-${view.evidence}`);
    const entry = getEvidence(view.evidence);
    if (host.firstElementChild !== entry.node) {
      if (host.firstElementChild) $('#evidence-store').append(host.firstElementChild);
      host.append(entry.node);
    }
  } else {
    $('#evidence-panel').removeAttribute('aria-labelledby');
    if (host.firstElementChild) $('#evidence-store').append(host.firstElementChild);
  }
  if (view.requested === 'e8-data') $('#e8-data').open = true;
  $('#question-panel').hidden = false;
  reviewerMemory.set(view.reviewer.id, view.question.anchor);
  currentView = view;
  document.title = `AnyTalker · ${view.reviewer.id} ${view.question.key}`;
  if (questionChanged) window.scrollTo({top:0, behavior:'instant'});
  if (view.requested === 'e8-data') requestAnimationFrame(() => $('#e8-data').scrollIntoView({block:'start'}));
}

function bindKeyboardTabs(selector) {
  $(selector).addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = $$('[role="tab"]', $(selector));
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index + (event.key==='ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
}

async function initialize() {
  try {
    const responses = await Promise.all([fetch('data/experiments.json?v=reviewer-update-5'), fetch('data/reviewers.json?v=reviewer-update-5')]);
    if (responses.some(response => !response.ok)) throw new Error('Supplement data unavailable');
    [experimentData, reviewData] = await Promise.all(responses.map(response => response.json()));
    const data = experimentData;
    renderTable('component-table', ['People','Model / variant (1.3B)','Sync-C* ↑','ΔResp ↓'], data.component,
      {labels:[1],group:true,name:'Table E5: component ablations',highlight:row=>row[1].includes('(full,')});
    renderTable('data-table', ['Training data','2 people Sync-C* ↑','2 people ΔResp ↓','3 people Sync-C* ↑','3 people ΔResp ↓','4 people Sync-C* ↑','4 people ΔResp ↓'], data.dataAblation,
      {name:'Table E6: training-data ablations',highlight:row=>row[0]==='RS¹+CM¹+RM²'});
    const scaleHeaders = ['Real data (hours)','RS Sync-C* ↑','RS ΔResp ↓','RS+CM Sync-C* ↑','RS+CM ΔResp ↓'];
    renderTable('scale-table', scaleHeaders, data.scale, {name:'Table E7: fixed-update data scaling',highlight:row=>row[0]==='24'});
    renderTable('trajectory-table', ['Unique data seen (hours)',...scaleHeaders.slice(1)], data.trajectory,
      {name:'Table E8: cumulative unique data',highlight:row=>row[0]==='12'});
    renderTable('ci-table', ['People','Metric','Comparator','AnyTalker-14B','Comparator value','Difference','95% CI'], data.ci,
      {labels:[1,2],group:true,name:'Table E9: metric and preference differences'});
    renderTable('agreement-table', ['People','Human votes','Agreement accuracy (%) ↑'], data.agreement,
      {name:'Table E10: agreement with human preferences'});
    $$('#evidence-store [data-evidence]').forEach(node => evidenceCache.set(node.dataset.evidence, {node}));
    [...data.audio,...data.groupClips,...data.text].forEach(group => videoIndex.set(group.id, group));
    $$('.table-filter').forEach(filter => filter.addEventListener('click', event => {
      const button = event.target.closest('button[data-people]');
      if (!button) return;
      $$('button', filter).forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
      $$(`#${filter.dataset.target} tbody tr`).forEach(row => { row.hidden = button.dataset.people !== 'all' && row.dataset.people !== button.dataset.people; });
    }));
    $('#evidence-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-evidence-tab]');
      if (button) navigate(currentView.question.anchor, button.dataset.evidenceTab);
    });
    for (const [selector, offset] of [['#previous-question',-1],['#next-question',1]]) {
      $(selector).addEventListener('click', () => {
        const index = currentView.reviewer.questions.indexOf(currentView.question) + offset;
        const next = currentView.reviewer.questions[index];
        if (next) navigate(next.anchor);
      });
    }
    renderReviewerTabs();
    bindKeyboardTabs('#reviewer-tabs');
    bindKeyboardTabs('#evidence-tabs');
    $('#load-status').textContent = '';
    showView();
    window.addEventListener('hashchange', showView);
    document.addEventListener('visibilitychange', () => { if (document.hidden) for (const player of players) player.pause(); });
  } catch (error) {
    $('#load-status').textContent = 'Review comments or results could not be loaded. Please reload the page.';
    console.error(error);
  }
}

initialize();
