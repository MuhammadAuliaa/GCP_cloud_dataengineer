(() => {
"use strict";

const $app = document.getElementById("app");
const $timer = document.getElementById("timer");
const $title = document.getElementById("examTitle");
const LETTERS = "ABCDEFGH";
const PASS_PCT = 72;

let exam = null;      // { title, key, questions }
let source = "ai";
let store = null;     // persistent per-exam stats
let session = null;   // running session
let tickHandle = null;

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = s => { s = Math.max(0, Math.floor(s)); const h = String(Math.floor(s / 3600)).padStart(2, "0"), m = String(Math.floor(s % 3600 / 60)).padStart(2, "0"); return `${h}:${m}:${String(s % 60).padStart(2, "0")}`; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

document.getElementById("brand").onclick = () => {
  if (session && !session.finished && !confirm("Keluar dari sesi? Progres sesi ini tetap tersimpan dan bisa dilanjutkan.")) return;
  stopTimer(); renderSetup();
};

/* ---------- parsing ---------- */
function splitOptions(text) {
  text = text.replace(/\s*Show Suggested Answer.*$/i, "").trim();
  let best = null;
  const re = /(?:^|\s)A\.\s/g; let m;
  while ((m = re.exec(text))) {
    const marks = [{ k: "A", at: m.index + (m[0].startsWith("A") ? 0 : 1) }];
    let from = m.index + m[0].length;
    for (let i = 1; i < LETTERS.length; i++) {
      const r = new RegExp(`\\s${LETTERS[i]}\\.\\s`, "g"); r.lastIndex = from;
      const n = r.exec(text); if (!n) break;
      marks.push({ k: LETTERS[i], at: n.index + 1 }); from = n.index + n[0].length;
    }
    if (marks.length >= 2 && (!best || marks.length >= best.length)) best = marks;
  }
  if (!best) return { stem: text, options: [] };
  const options = best.map((mk, i) => ({ k: mk.k, t: text.slice(mk.at + 2, i + 1 < best.length ? best[i + 1].at : undefined).trim() }));
  return { stem: text.slice(0, best[0].at).trim(), options };
}

function parseComment(raw) {
  let up = 0;
  let t = raw.replace(/\s*Submit\s*Cancel\s*$/i, "").replace(/\s*upvoted (\d+) times?\s*$/i, (_, n) => { up = +n; return ""; });
  const ta = document.createElement("textarea"); ta.innerHTML = t; t = ta.value;
  const m = t.match(/^Selected Answer:\s*([A-F]+)\s*/i);
  return { sa: m ? m[1].toUpperCase() : "", text: m ? t.slice(m[0].length) : t, up };
}

function parseQuestion(q, i) {
  const parsed = q.choices
    ? { stem: q.question || "", options: Object.entries(q.choices).map(([k, t]) => ({ k, t })) }
    : splitOptions(q.question || "");
  const { stem, options } = parsed;
  const multiM = stem.match(/\b(?:choose|select)\s+(two|three|four|2|3|4)\b/i);
  const need = multiM ? ({ two: 2, three: 3, four: 4 }[multiM[1].toLowerCase()] || +multiM[1]) : 1;
  const comments = (q.discussion || []).map(parseComment);

  let answer = typeof q.answer === "string"
    ? q.answer.split(",").map(letter => letter.trim()).filter(Boolean)
    : [];
  if (!answer.length) {
    if (need > 1) {
      const tally = {};
      comments.forEach(c => { if (c.sa.length === need) tally[c.sa] = (tally[c.sa] || 0) + 1; });
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (top) answer = top[0].split("");
      else {
        const votes = Object.entries(q.vote_counts || {}).sort((a, b) => b[1] - a[1]).slice(0, need).map(e => e[0]);
        answer = votes.filter(v => /^[A-F]$/.test(v));
        if (answer.length !== need) answer = [];
      }
    } else {
      const a = (q.community_answer || q.most_voted || "").trim().match(/^([A-F])\b/i);
      if (a) answer = [a[1].toUpperCase()];
    }
  }
  const nm = (q.question_no || "").match(/topic\s+(\d+)\s+question\s+(\d+)/i);
  return {
    id: i, no: nm ? `Topic ${nm[1]} · Q${nm[2]}` : `Q${i + 1}`,
    stem, options, need, answer, reason: q.reason || "", comments, votes: q.vote_counts || {}, url: q.url,
    fallbackLetters: options.length ? [] : "ABCD".split(""),
  };
}

function loadExam(raw, name) {
  const first = (raw[0] && raw[0].question_no || "").match(/^Exam (.*?) topic/i);
  const title = first ? first[1] : (name || "Exam").replace(/\.json$/i, "");
  exam = { title, key: "et:" + title + ":" + name, questions: raw.map(parseQuestion) };
  store = JSON.parse(localStorage.getItem(exam.key + ":store") || '{"stats":{},"flags":[],"history":[]}');
  try { session = JSON.parse(localStorage.getItem(exam.key + ":session") || "null"); } catch { session = null; }
  if (session && session.finished) session = null;
  $title.textContent = title;
}
const saveStore = () => localStorage.setItem(exam.key + ":store", JSON.stringify(store));
const saveSession = () => session && localStorage.setItem(exam.key + ":session", JSON.stringify(session));
const clearSession = () => localStorage.removeItem(exam.key + ":session");
const qById = id => exam.questions[id];

/* ---------- boot ---------- */
async function boot() {
  try {
    const r = await fetch("/api/questions?source=" + source);
    if (!r.ok) throw new Error(r.status);
    loadExam(await r.json(), source);
    renderSetup();
  } catch (e) {
    $app.innerHTML = `<div class="card"><h2>Soal tidak dapat dimuat</h2><p class="muted">Pastikan aplikasi dijalankan melalui Flask dan berkas soal tersedia.</p></div>`;
  }
}

/* ---------- setup screen ---------- */
let setupState = { mode: "practice", count: 65, filter: "all", shuffle: true, minutes: 130, showDisc: true };

function renderSetup() {
  document.body.classList.remove("in-session");
  $timer.classList.add("hidden");
  const qs = exam.questions, st = store.stats;
  const seen = qs.filter(q => st[q.id]).length;
  const correct = qs.filter(q => st[q.id] && st[q.id].last === 1).length;
  const wrong = qs.filter(q => st[q.id] && st[q.id].last === 0).length;
  const acc = seen ? Math.round(correct / seen * 100) : 0;
  const s = setupState;
  s.count = Math.min(s.count, qs.length);

  $app.innerHTML = `
  ${session ? `<div class="card" style="border-color:var(--primary)"><b>Sesi belum selesai</b> — ${session.mode === "exam" ? "Simulasi ujian" : "Latihan"}, soal ${session.idx + 1}/${session.list.length}, terjawab ${Object.keys(session.answers).length}.
    <div class="row" style="justify-content:flex-start"><button class="btn primary" id="resume">Lanjutkan</button><button class="btn danger" id="discard">Buang sesi</button></div></div>` : ""}
  <div class="stats">
    <div class="stat"><span class="muted small">Total soal</span><b>${qs.length}</b></div>
    <div class="stat"><span class="muted small">Pernah dikerjakan</span><b>${seen}</b></div>
    <div class="stat"><span class="muted small">Benar (terakhir)</span><b style="color:var(--ok)">${correct}</b></div>
    <div class="stat"><span class="muted small">Salah (terakhir)</span><b style="color:var(--bad)">${wrong}</b></div>
    <div class="stat"><span class="muted small">Akurasi</span><b>${acc}%</b></div>
    <div class="stat"><span class="muted small">Ditandai</span><b>${store.flags.length}</b></div>
  </div>
  <div class="card">
    <h2>${esc(exam.title)}</h2>
    <div class="mode-cards">
      <div class="mode-card ${s.mode === "practice" ? "sel" : ""}" data-mode="practice"><b>📘 Mode Latihan</b><span class="muted small">Cek jawaban per soal, lihat jawaban benar &amp; diskusi komunitas langsung.</span></div>
      <div class="mode-card ${s.mode === "exam" ? "sel" : ""}" data-mode="exam"><b>⏱️ Simulasi Ujian</b><span class="muted small">Dengan timer, tanpa kunci jawaban sampai submit. Lulus ≥ ${PASS_PCT}%.</span></div>
    </div>
    <div class="form-grid">
      <label class="field">Jumlah soal<span class="hint">(maks ${qs.length})</span>
        <input type="number" id="count" min="1" max="${qs.length}" value="${s.count}"></label>
      <label class="field">Pilih kumpulan soal
        <select id="source">
          <option value="json" ${source === "json" ? "selected" : ""}>JSON · Soal dan diskusi komunitas</option>
          <option value="markdown" ${source === "markdown" ? "selected" : ""}>Markdown · Kumpulan soal</option>
          <option value="ai" ${source === "ai" ? "selected" : ""}>AI-ready JSON · Soal dan pilihan terpisah</option>
        </select></label>
      <label class="field">Filter soal
        <select id="filter">
          ${[["all", "Semua soal"], ["new", "Belum pernah dikerjakan"], ["wrong", "Yang salah terakhir kali"], ["flag", "Yang ditandai"]].map(([v, l]) => `<option value="${v}" ${s.filter === v ? "selected" : ""}>${l}</option>`).join("")}
        </select></label>
      <label class="field ${s.mode === "exam" ? "" : "hidden"}" id="minWrap">Batas waktu (menit)
        <input type="number" id="minutes" min="1" value="${s.minutes}"></label>
      <div class="field"><label class="check"><input type="checkbox" id="shuffle" ${s.shuffle ? "checked" : ""}> Acak urutan soal</label>
      <label class="check ${s.mode === "exam" ? "" : "hidden"}" id="discWrap"><input type="checkbox" id="showDisc" ${s.showDisc ? "checked" : ""}> Tampilkan diskusi saat review</label></div>
    </div>
    <div class="row" style="justify-content:flex-start;margin-top:20px"><button class="btn primary big" id="start">Mulai</button>
    <button class="btn" id="reset">Reset progres</button></div>
  </div>`;

  document.querySelectorAll(".mode-card").forEach(el => el.onclick = () => { readSetup(); s.mode = el.dataset.mode; renderSetup(); });
  document.getElementById("source").onchange = async e => {
    const nextSource = e.target.value;
    try {
      const response = await fetch("/api/questions?source=" + nextSource);
      if (!response.ok) throw new Error(response.status);
      source = nextSource;
      loadExam(await response.json(), source);
      renderSetup();
    } catch (error) {
      alert("Sumber soal tidak dapat dimuat: " + error.message);
      renderSetup();
    }
  };
  document.getElementById("filter").onchange = () => { readSetup(); renderSetup(); };
  document.getElementById("start").onclick = startSession;
  document.getElementById("reset").onclick = () => { if (confirm("Hapus semua statistik & penanda untuk ujian ini?")) { store = { stats: {}, flags: [], history: [] }; saveStore(); renderSetup(); } };
  if (session) {
    document.getElementById("resume").onclick = () => { renderSession(); startTimer(); };
    document.getElementById("discard").onclick = () => { session = null; clearSession(); renderSetup(); };
  }
}

function readSetup() {
  const s = setupState, g = id => document.getElementById(id);
  s.count = Math.max(1, +g("count").value || 1);
  s.filter = g("filter").value; s.shuffle = g("shuffle").checked;
  if (g("minutes")) s.minutes = Math.max(1, +g("minutes").value || 1);
  if (g("showDisc")) s.showDisc = g("showDisc").checked;
}

function startSession() {
  readSetup();
  const s = setupState, st = store.stats;
  let pool = exam.questions.filter(q => ({
    all: true, new: !st[q.id], wrong: st[q.id] && st[q.id].last === 0, flag: store.flags.includes(q.id),
  })[s.filter]);
  if (!pool.length) return alert("Tidak ada soal untuk filter ini.");
  let ids = pool.map(q => q.id);
  if (s.shuffle) ids = shuffle(ids);
  ids = ids.slice(0, Math.min(s.count, ids.length));
  if (!s.shuffle) ids.sort((a, b) => a - b);
  session = {
    mode: s.mode, list: ids, idx: 0, answers: {}, checked: {}, flags: [], finished: false,
    startedAt: Date.now(), endAt: s.mode === "exam" ? Date.now() + s.minutes * 60000 : null, showDisc: s.showDisc,
  };
  saveSession(); renderSession(); startTimer();
}

/* ---------- timer ---------- */
function startTimer() {
  stopTimer();
  $timer.classList.remove("hidden");
  const tick = () => {
    if (!session || session.finished) return stopTimer();
    if (session.endAt) {
      const left = (session.endAt - Date.now()) / 1000;
      $timer.textContent = "⏳ " + fmtTime(left); $timer.classList.toggle("low", left < 300);
      if (left <= 0) { stopTimer(); alert("Waktu habis! Ujian dikumpulkan otomatis."); finish(); }
    } else { $timer.textContent = "⏱ " + fmtTime((Date.now() - session.startedAt) / 1000); $timer.classList.remove("low"); }
  };
  tick(); tickHandle = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(tickHandle); tickHandle = null; $timer.classList.add("hidden"); }

/* ---------- question screen ---------- */
const isGraded = q => q.answer.length > 0;
const isCorrect = (q, sel) => isGraded(q) && sameSet(sel || [], q.answer);
const reveal = q => session.finished || (session.mode === "practice" && session.checked[q.id]);

function renderSession() {
  const q = qById(session.list[session.idx]);
  const sel = session.answers[q.id] || [];
  const showAns = reveal(q);
  const total = session.list.length;
  const answered = Object.keys(session.answers).length;
  const flagged = store.flags.includes(q.id);
  const letters = q.options.length ? q.options : q.fallbackLetters.map(k => ({ k, t: "" }));

  const optHtml = letters.map(o => {
    let cls = "opt";
    if (sel.includes(o.k)) cls += " sel";
    if (showAns) { cls += " locked"; if (q.answer.includes(o.k)) cls += " correct"; else if (sel.includes(o.k)) cls += " wrong"; }
    return `<div class="${cls}" data-k="${o.k}"><span class="letter">${o.k}</span><span>${esc(o.t || "Pilihan " + o.k)}</span></div>`;
  }).join("");

  const palette = session.list.map((id, i) => {
    const qq = qById(id); let c = "pal";
    if (i === session.idx) c += " current";
    if (store.flags.includes(id)) c += " flag";
    if (session.finished || (session.mode === "practice" && session.checked[id])) c += isGraded(qq) ? (isCorrect(qq, session.answers[id]) ? " ok" : " no") : " answered";
    else if (session.answers[id]) c += " answered";
    return `<button class="${c}" data-i="${i}">${i + 1}</button>`;
  }).join("");

  const isLast = session.idx === total - 1;
  const canCheck = session.mode === "practice" && !showAns && sel.length > 0;

  $app.innerHTML = `
  <div class="exam">
    <div>
      <div class="card">
        <div class="q-head">
          <div><span class="q-no">Soal ${session.idx + 1} / ${total}</span><span class="badge">${esc(q.no)}</span>
            ${q.need > 1 ? `<span class="badge warn">Pilih ${q.need}</span>` : ""}</div>
          <button class="btn ${flagged ? "active" : ""}" id="flag">⚑ ${flagged ? "Ditandai" : "Tandai"}</button>
        </div>
        <div class="q-text">${esc(q.stem)}</div>
        <div class="opts">${optHtml}</div>
        ${showAns ? answerBox(q, sel) : ""}
        <div class="q-actions">
          <div class="grp"><button class="btn" id="prev" ${session.idx === 0 ? "disabled" : ""}>← Sebelumnya</button>
            <button class="btn" id="next" ${isLast ? "disabled" : ""}>Berikutnya →</button></div>
          <div class="grp">
            ${session.mode === "practice" && !session.finished ? `<button class="btn primary" id="check" ${canCheck ? "" : "disabled"}>Cek jawaban</button>` : ""}
            ${session.finished ? `<button class="btn primary" id="toResult">Kembali ke hasil</button>` : `<button class="btn ${isLast ? "primary" : ""}" id="finish">Selesai &amp; kumpulkan</button>`}
          </div>
        </div>
      </div>
    </div>
    <aside class="side card">
      <b>Navigasi soal</b>
      <div class="progress"><div style="width:${answered / total * 100}%"></div></div>
      <div class="muted small" style="margin-bottom:8px">${answered}/${total} terjawab</div>
      <div class="palette">${palette}</div>
      <div class="legend"><span>🟦 terjawab</span><span>⚑ ditandai</span>${session.mode === "practice" || session.finished ? "<span>🟩 benar</span><span>🟥 salah</span>" : ""}</div>
    </aside>
  </div>`;

  document.querySelectorAll(".opt:not(.locked)").forEach(el => el.onclick = () => pick(q, el.dataset.k));
  document.querySelectorAll(".pal").forEach(el => el.onclick = () => go(+el.dataset.i));
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  on("prev", () => go(session.idx - 1)); on("next", () => go(session.idx + 1));
  on("flag", () => { const i = store.flags.indexOf(q.id); i < 0 ? store.flags.push(q.id) : store.flags.splice(i, 1); saveStore(); renderSession(); });
  on("check", () => checkAnswer(q));
  on("finish", () => {
    const un = total - answered;
    if (confirm(un ? `Masih ada ${un} soal belum dijawab. Kumpulkan sekarang?` : "Kumpulkan jawaban sekarang?")) finish();
  });
  on("toResult", renderResult);

  const examView = document.querySelector(".exam");
  let touchStart = null;
  examView.addEventListener("touchstart", event => {
    const target = event.target;
    if (event.touches.length !== 1 || target.closest("button, .opt, a, input, select, textarea, .palette")) {
      touchStart = null;
      return;
    }
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  examView.addEventListener("touchend", event => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    go(session.idx + (deltaX < 0 ? 1 : -1));
  }, { passive: true });
  examView.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });
}

function answerBox(q, sel) {
  const graded = isGraded(q), ok = isCorrect(q, sel);
  const votes = Object.entries(q.votes).sort((a, b) => b[1] - a[1]);
  const showDisc = session.mode === "practice" || session.showDisc !== false;
  const comments = q.comments.filter(c => c.text.trim()).slice(0, 12);
  return `<div class="answer-box ${graded && !ok ? "bad" : ""}">
    <b>${!graded ? "Kunci jawaban tidak tersedia" : sel.length ? (ok ? "✅ Benar" : "❌ Salah") : "⚪ Tidak dijawab"}</b>
    ${graded ? `<div>Jawaban benar: <b>${q.answer.join(", ")}</b>${sel.length ? ` · Jawabanmu: <b>${sel.join(", ")}</b>` : ""}</div>` : ""}
    ${q.reason ? `<div class="reason"><b>Penjelasan:</b> ${esc(q.reason)}</div>` : ""}
    ${votes.length ? `<div class="votes">${votes.map(([k, v]) => `<span>${esc(k)}: ${v} suara</span>`).join("")}</div>` : ""}
  </div>
  ${showDisc && comments.length ? `<div class="comments"><b>Diskusi komunitas</b>
    ${comments.map(c => `<div class="comment">${c.sa ? `<span class="sa">${c.sa}</span>` : ""}${esc(c.text.length > 700 ? c.text.slice(0, 700) + "…" : c.text)}${c.up ? `<span class="up">▲ ${c.up}</span>` : ""}</div>`).join("")}
    ${q.url ? `<div class="small"><a href="${esc(q.url)}" target="_blank" rel="noopener">Lihat di ExamTopics ↗</a></div>` : ""}</div>` : ""}`;
}

function pick(q, k) {
  let sel = session.answers[q.id] || [];
  if (q.need > 1) sel = sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k].slice(-q.need);
  else sel = [k];
  if (sel.length) session.answers[q.id] = sel.sort(); else delete session.answers[q.id];
  saveSession(); renderSession();
}

function checkAnswer(q) {
  session.checked[q.id] = true; recordStat(q); saveSession(); renderSession();
}

function recordStat(q) {
  if (!isGraded(q)) return;
  const sel = session.answers[q.id]; if (!sel) return;
  const prev = store.stats[q.id] || { right: 0, wrong: 0 };
  const ok = isCorrect(q, sel);
  store.stats[q.id] = { right: prev.right + (ok ? 1 : 0), wrong: prev.wrong + (ok ? 0 : 1), last: ok ? 1 : 0 };
  saveStore();
}

function go(i) {
  if (i < 0 || i >= session.list.length) return;
  session.idx = i; saveSession(); renderSession(); window.scrollTo({ top: 0 });
}

document.addEventListener("keydown", event => {
  if (!document.querySelector(".exam") || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); go(session.idx - 1); }
  if (event.key === "ArrowRight") { event.preventDefault(); go(session.idx + 1); }
});

/* ---------- finish & result ---------- */
function finish() {
  if (!session || session.finished) return;
  session.list.forEach(id => {
    const q = qById(id);
    if (session.mode === "exam" || !session.checked[id]) recordStat(q);
  });
  session.finished = true;
  const r = computeResult();
  store.history.unshift({ at: Date.now(), mode: session.mode, total: r.gradable, correct: r.correct, pct: r.pct });
  store.history = store.history.slice(0, 30); saveStore();
  clearSession(); stopTimer(); renderResult();
}

function computeResult() {
  let correct = 0, wrong = 0, skipped = 0, gradable = 0;
  session.list.forEach(id => {
    const q = qById(id); if (!isGraded(q)) return;
    gradable++;
    const sel = session.answers[id];
    if (!sel) skipped++; else if (isCorrect(q, sel)) correct++; else wrong++;
  });
  return { correct, wrong, skipped, gradable, pct: gradable ? Math.round(correct / gradable * 100) : 0 };
}

function renderResult() {
  const r = computeResult(), pass = r.pct >= PASS_PCT;
  const col = pass ? "var(--ok)" : "var(--bad)";
  const used = fmtTime((Date.now() - session.startedAt) / 1000);
  $app.innerHTML = `
  <div class="card result-top">
    <div class="score-ring" style="background:conic-gradient(${col} ${r.pct * 3.6}deg, var(--border) 0)"><div>${r.pct}%</div></div>
    <h2 class="${pass ? "pass" : "fail"}">${pass ? "LULUS 🎉" : "BELUM LULUS"}</h2>
    <div class="muted">Batas lulus ${PASS_PCT}% · ${r.correct} benar · ${r.wrong} salah · ${r.skipped} dilewati dari ${r.gradable} soal</div>
    <div class="row"><button class="btn primary" id="again">Kembali ke menu</button>
    ${r.wrong + r.skipped ? `<button class="btn" id="retryWrong">Ulangi yang salah/dilewati</button>` : ""}</div>
  </div>
  <div class="card"><h3>Review jawaban</h3>
    ${session.list.map((id, i) => {
      const q = qById(id), sel = session.answers[id];
      const st = !isGraded(q) ? "skip" : !sel ? "skip" : isCorrect(q, sel) ? "ok" : "no";
      return `<div class="review-item" data-i="${i}"><span class="dot ${st}">${st === "ok" ? "✓" : st === "no" ? "✕" : "–"}</span>
        <div><b>${i + 1}.</b> ${esc(q.stem.slice(0, 150))}${q.stem.length > 150 ? "…" : ""}
        <div class="small muted">Jawabanmu: ${sel ? sel.join(", ") : "—"} · Benar: ${q.answer.join(", ") || "?"}</div></div></div>`;
    }).join("")}
  </div>`;
  document.getElementById("again").onclick = () => { session = null; renderSetup(); };
  const rw = document.getElementById("retryWrong");
  if (rw) rw.onclick = () => {
    const ids = session.list.filter(id => { const q = qById(id); return isGraded(q) && !isCorrect(q, session.answers[id]); });
    const mode = session.mode;
    session = { mode, list: ids, idx: 0, answers: {}, checked: {}, flags: [], finished: false, startedAt: Date.now(), endAt: mode === "exam" ? Date.now() + Math.ceil(ids.length * 2) * 60000 : null, showDisc: true };
    saveSession(); renderSession(); startTimer();
  };
  document.querySelectorAll(".review-item").forEach(el => el.onclick = () => { session.idx = +el.dataset.i; renderSession(); window.scrollTo({ top: 0 }); });
}

boot();
})();
