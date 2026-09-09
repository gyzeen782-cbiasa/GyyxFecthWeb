"use strict";

// ── Elements ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const urlInput      = $("urlInput");
const scanBtn       = $("scanBtn");
const scanBtnText   = $("scanBtnText");
const scanProgress  = $("scanProgress");
const progressBar   = $("progressBar");
const progressSteps = $("progressSteps");
const results       = $("results");
const siteMeta      = $("siteMeta");
const metaUrl       = $("metaUrl");
const metaStats     = $("metaStats");
const metaTechs     = $("metaTechs");
const treeList      = $("treeList");
const treeCount     = $("treeCount");
const treeSearch    = $("treeSearch");
const codeEmpty     = $("codeEmpty");
const codeView      = $("codeView");
const codeGutter    = $("codeGutter");
const codeContent   = $("codeContent");
const codeFileName  = $("codeFileName");
const codeFileIcon  = $("codeFileIcon");
const codeFileType  = $("codeFileType");
const codeSize      = $("codeSize");
const copyFileBtn   = $("copyFileBtn");
const downloadFileBtn=$("downloadFileBtn");
const openUrlBtn    = $("openUrlBtn");
const downloadZipBtn= $("downloadZipBtn");
const newScanBtn    = $("newScanBtn");
const errorBanner   = $("errorBanner");
const errorText     = $("errorText");
const errorDismiss  = $("errorDismiss");
const statusDot     = $("statusDot");
const statusLabel   = $("statusLabel");
const toastWrap     = $("toastWrap");

// ── State ─────────────────────────────────────────────────────────────────────
let allFiles = [];
let activeId = null;

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = "tOut 0.3s ease forwards";
    el.addEventListener("animationend", () => el.remove());
  }, 2800);
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(state, label) {
  statusDot.className = "status-dot" + (state ? " " + state : "");
  statusLabel.textContent = label;
}

// ── Error ─────────────────────────────────────────────────────────────────────
function showError(msg) {
  errorText.textContent = msg;
  errorBanner.style.display = "flex";
  setStatus("error", "ERROR");
}

function hideError() {
  errorBanner.style.display = "none";
}

errorDismiss.addEventListener("click", hideError);

// ── Progress animation ────────────────────────────────────────────────────────
const SCAN_STEPS = [
  "Resolving host...",
  "Fetching HTML document...",
  "Parsing linked assets...",
  "Fetching CSS files...",
  "Fetching JavaScript files...",
  "Processing assets...",
  "Building file tree...",
];

let progressInterval = null;
let stepIndex = 0;

function startProgress() {
  stepIndex = 0;
  progressBar.style.width = "0%";
  progressSteps.textContent = SCAN_STEPS[0];
  scanProgress.style.display = "block";

  let pct = 0;
  progressInterval = setInterval(() => {
    pct = Math.min(pct + Math.random() * 8 + 2, 88);
    progressBar.style.width = pct + "%";
    if (stepIndex < SCAN_STEPS.length - 1 && pct > (stepIndex + 1) * (88 / SCAN_STEPS.length)) {
      stepIndex++;
      progressSteps.textContent = SCAN_STEPS[stepIndex];
    }
  }, 400);
}

function finishProgress(ok = true) {
  clearInterval(progressInterval);
  progressBar.style.width = "100%";
  progressSteps.textContent = ok ? "Complete." : "Failed.";
  setTimeout(() => { scanProgress.style.display = "none"; }, 800);
}

// ── File icons ────────────────────────────────────────────────────────────────
function fileIcon(type) {
  const m = { html:"🌐", css:"🎨", js:"⚡", json:"📋", image:"🖼️", font:"🔤", other:"📄" };
  return m[type] || "📄";
}

function formatBytes(b) {
  if (!b || b === 0) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
}

// ── Render file tree ──────────────────────────────────────────────────────────
function renderTree(files, filter = "") {
  treeList.innerHTML = "";
  const filtered = filter
    ? files.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
    : files;

  treeCount.textContent = filtered.length;

  if (filtered.length === 0) {
    treeList.innerHTML = `<div style="padding:20px 16px;font-family:var(--mono);font-size:11px;color:var(--text-dim)">no files match</div>`;
    return;
  }

  for (const file of filtered) {
    const item = document.createElement("div");
    item.className = "tree-item" + (file.id === activeId ? " active" : "");
    item.dataset.id = file.id;

    item.innerHTML =
      `<span class="tree-item-icon">${fileIcon(file.type)}</span>` +
      `<span class="tree-item-name" title="${file.name}">${file.name}</span>` +
      `<span class="tree-item-size">${formatBytes(file.size)}</span>`;

    item.addEventListener("click", () => loadFile(file));
    treeList.appendChild(item);
  }
}

// ── Load file into viewer ─────────────────────────────────────────────────────
function loadFile(file) {
  activeId = file.id;

  // Update tree active state
  document.querySelectorAll(".tree-item").forEach(el => {
    el.classList.toggle("active", parseInt(el.dataset.id) === file.id);
  });

  codeFileName.textContent = file.name;
  codeFileIcon.textContent = fileIcon(file.type);
  codeFileType.textContent = file.type;
  codeSize.textContent = formatBytes(file.size);
  openUrlBtn.href = file.url || "#";

  const content = file.content || "";
  codeContent.textContent = content;

  // Build gutter
  const lines = content.split("\n").length;
  let gutter = "";
  for (let i = 1; i <= lines; i++) gutter += i + "\n";
  codeGutter.textContent = gutter;

  codeEmpty.style.display = "none";
  codeView.style.display = "flex";
}

// ── Scan ──────────────────────────────────────────────────────────────────────
async function doScan() {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) { toast("Masukkan URL dulu", "err"); urlInput.focus(); return; }

  // Auto-add https if missing
  let url = rawUrl;
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;

  hideError();
  scanBtn.disabled = true;
  scanBtnText.textContent = "SCANNING";
  setStatus("scanning", "SCANNING");
  startProgress();

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const json = await res.json();

    finishProgress(json.ok);

    if (!json.ok) {
      showError(json.message || "Scan gagal — cek URL dan coba lagi.");
      setStatus("error", "FAILED");
      return;
    }

    const data = json.data;
    allFiles = data.files || [];
    activeId = null;

    // Populate meta
    metaUrl.textContent = data.url;
    metaUrl.title = data.url;
    metaStats.textContent = `${data.fileCount} files · ${formatBytes(data.totalSize)}`;

    metaTechs.innerHTML = (data.technologies || [])
      .map(t => `<span class="tech-tag">${t}</span>`)
      .join("");

    // Render tree
    renderTree(allFiles);

    // Show results
    results.style.display = "flex";
    results.scrollIntoView({ behavior: "smooth" });

    // Auto-select first file
    if (allFiles.length > 0) loadFile(allFiles[0]);

    setStatus("active", "DONE");
    toast(`${data.fileCount} file berhasil di-extract`, "ok");

  } catch (err) {
    finishProgress(false);
    showError("Tidak bisa terhubung ke server. Periksa koneksi internet.");
    setStatus("error", "FAILED");
  } finally {
    scanBtn.disabled = false;
    scanBtnText.textContent = "SCAN";
  }
}

// ── Search tree ───────────────────────────────────────────────────────────────
treeSearch.addEventListener("input", () => {
  renderTree(allFiles, treeSearch.value);
});

// ── New scan ──────────────────────────────────────────────────────────────────
newScanBtn.addEventListener("click", () => {
  results.style.display = "none";
  allFiles = [];
  activeId = null;
  urlInput.value = "";
  codeEmpty.style.display = "flex";
  codeView.style.display = "none";
  setStatus("", "IDLE");
  window.scrollTo({ top: 0, behavior: "smooth" });
  urlInput.focus();
});

// ── Copy file ─────────────────────────────────────────────────────────────────
copyFileBtn.addEventListener("click", async () => {
  const file = allFiles.find(f => f.id === activeId);
  if (!file) return;
  try {
    await navigator.clipboard.writeText(file.content || "");
    toast("Konten disalin!", "ok");
    copyFileBtn.style.color = "var(--green)";
    setTimeout(() => (copyFileBtn.style.color = ""), 1500);
  } catch { toast("Gagal — salin manual", "err"); }
});

// ── Download single file ──────────────────────────────────────────────────────
downloadFileBtn.addEventListener("click", () => {
  const file = allFiles.find(f => f.id === activeId);
  if (!file) return;
  const blob = new Blob([file.content || ""], { type: "text/plain" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: file.name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Downloaded: " + file.name, "ok");
});

// ── Download ZIP ──────────────────────────────────────────────────────────────
downloadZipBtn.addEventListener("click", async () => {
  if (allFiles.length === 0) return;

  downloadZipBtn.disabled = true;
  downloadZipBtn.textContent = "Building ZIP...";

  try {
    const res = await fetch("/api/download-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: allFiles.map(f => ({ name: f.name, content: f.content || "" })) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "ZIP gagal dibuat");
    }

    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: "gyyxfetch-export.zip",
    });
    a.click();
    URL.revokeObjectURL(a.href);
    toast("ZIP berhasil didownload!", "ok");

  } catch (err) {
    toast("❌ " + err.message, "err");
  } finally {
    downloadZipBtn.disabled = false;
    downloadZipBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export ZIP`;
  }
});

// ── Quick examples ────────────────────────────────────────────────────────────
document.querySelectorAll(".qe-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    urlInput.value = btn.dataset.url;
    doScan();
  });
});

// ── Scan triggers ─────────────────────────────────────────────────────────────
scanBtn.addEventListener("click", doScan);
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") doScan(); });
