(() => {
  /* =====================================================
     HELPERS
     ===================================================== */

  const $ = (id) => document.getElementById(id);

  const prettyBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return "–";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
  };

  const pctSaved = (inB, outB) => {
    if (!inB || !outB) return "–";
    return `${((1 - outB / inB) * 100).toFixed(1)}%`;
  };

  const safeName = (name) =>
    String(name || "file")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim();

  /* =====================================================
     DOM ELEMENTS
     ===================================================== */

  const dropzone = $("dropzone");
  const fileInput = $("file");
  const browse = $("browse");

  const formatEl = $("format");
  const qualityEl = $("quality");
  const qVal = $("qVal");

  const convertBtn = $("convert");
  const clearBtn = $("clear");
  const zipBtn = $("zip");
  const statusEl = $("status");

  const listEl = $("list");
  const emptyState = $("emptyState");

  const summary = $("summary");
  const sumIn = $("sumIn");
  const sumOut = $("sumOut");
  const sumSave = $("sumSave");

  const themeToggle = $("themeToggle");
  const themeIcon = $("themeIcon");
  const themeText = $("themeText");

  // Global progress UI (optional)
  const gprog = $("gprog");
  const gprogPct = $("gprogPct");
  const gprogFill = $("gprogFill");

  /* =====================================================
     SANITY CHECK
     ===================================================== */

  const required = [
    dropzone, fileInput, browse,
    formatEl, qualityEl, qVal,
    convertBtn, clearBtn, statusEl,
    listEl, emptyState,
    summary, sumIn, sumOut, sumSave,
    themeToggle, themeIcon, themeText
  ];

  if (required.some(x => !x)) {
    console.error("Missing one or more DOM elements. Check index.html ids.", {
      dropzone, fileInput, browse,
      formatEl, qualityEl, qVal,
      convertBtn, clearBtn, zipBtn, statusEl,
      listEl, emptyState,
      summary, sumIn, sumOut, sumSave,
      themeToggle, themeIcon, themeText
    });
  }

  if (!window.JSZip) {
    console.warn("JSZip nie je načítaný. Skontroluj <script src=...jszip...> v index.html");
  }

  /* =====================================================
     APP STATE
     ===================================================== */

  // each item: { id, file, status, outBlobUrl, outBlob, outSize, progress }
  let files = [];
  let nextId = 1;

  /* =====================================================
     STATUS MESSAGE
     ===================================================== */

  const setStatus = (msg, type = "") => {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (type ? " " + type : "");
  };

  /* =====================================================
     THEME
     ===================================================== */

  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    const isLight = theme === "light";
    if (themeIcon) themeIcon.textContent = isLight ? "☀" : "☾";
    if (themeText) themeText.textContent = isLight ? "Light" : "Dark";
    localStorage.setItem("theme", theme);
  };

  (() => {
    const saved = localStorage.getItem("theme");
    applyTheme(saved === "light" ? "light" : "dark");
  })();

  themeToggle?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  /* =====================================================
     QUALITY BADGE
     ===================================================== */

  if (qualityEl && qVal) {
    qVal.textContent = qualityEl.value;
    qualityEl.addEventListener("input", () => (qVal.textContent = qualityEl.value));
  }

  /* =====================================================
     FILE FILTERING
     ===================================================== */

  const normalizePicked = (list) => {
    const out = [];
    for (const f of list) {
      if (/^image\/(jpeg|png)$/.test(f.type)) out.push(f);
    }
    return out;
  };

  /* =====================================================
     UI ENABLE/DISABLE
     ===================================================== */

  function anyConverted() {
    return files.some(f => f.status === "done" && f.outBlob);
  }

  const updateButtons = () => {
    const has = files.length > 0;
    if (convertBtn) convertBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
    if (zipBtn) zipBtn.disabled = !anyConverted();
  };

  /* =====================================================
     SUMMARY
     ===================================================== */

  const updateSummary = () => {
    if (!summary || !sumIn || !sumOut || !sumSave) return;
    if (!files.length) { summary.hidden = true; return; }

    let totalIn = 0, totalOut = 0, anyOut = false;
    for (const it of files) {
      totalIn += it.file.size;
      if (it.outSize != null) { totalOut += it.outSize; anyOut = true; }
    }

    if (!anyOut) { summary.hidden = true; return; }

    summary.hidden = false;
    sumIn.textContent = prettyBytes(totalIn);
    sumOut.textContent = prettyBytes(totalOut);
    sumSave.textContent = `${prettyBytes(totalIn - totalOut)} (${pctSaved(totalIn, totalOut)})`;
  };

  /* =====================================================
     PROGRESS HELPERS
     ===================================================== */

  function updateGlobalProgress() {
    if (!gprog || !gprogFill || !gprogPct) return;

    if (!files.length) {
      gprog.hidden = true;
      gprogFill.style.width = "0%";
      gprogPct.textContent = "0%";
      return;
    }

    const active = files.filter(f => f.status === "working" || f.status === "done" || f.status === "error");
    const list = active.length ? active : files;

    const avg = list.reduce((a, f) => a + (f.progress || 0), 0) / list.length;
    const pct = Math.round(avg);

    gprog.hidden = false;
    gprogFill.style.width = `${pct}%`;
    gprogPct.textContent = `${pct}%`;
  }

  function setItemProgress(id, p) {
    const it = files.find(x => x.id === id);
    if (!it) return;
    it.progress = Math.max(0, Math.min(100, p));
    render();
    updateGlobalProgress();
  }

  /* =====================================================
     RENDER
     ===================================================== */

  const render = () => {
    if (!listEl || !emptyState) return;

    listEl.querySelectorAll(".item").forEach(n => n.remove());
    emptyState.style.display = files.length ? "none" : "block";

    for (const it of files) {
      const item = document.createElement("div");
      item.className = "item";
      item.dataset.id = String(it.id);

      const left = document.createElement("div");

      const top = document.createElement("div");
      top.className = "itemTop";

      const name = document.createElement("div");
      name.className = "itemName";
      name.textContent = it.file.name;

      const badge = document.createElement("div");
      badge.className = "itemBadge";
      badge.textContent =
        it.status === "ready" ? "Ready" :
        it.status === "working" ? "Converting…" :
        it.status === "done" ? "Done" : "Error";

      top.appendChild(name);
      top.appendChild(badge);

      const meta = document.createElement("div");
      meta.className = "itemMeta";
      meta.textContent = `${it.file.type} • ${prettyBytes(it.file.size)}`;

      const kpi = document.createElement("div");
      kpi.className = "kpi";

      const k1 = document.createElement("div");
      k1.className = "k";
      k1.innerHTML = `<div class="kLabel">Pred</div><div class="kVal">${prettyBytes(it.file.size)}</div>`;

      const k2 = document.createElement("div");
      k2.className = "k";
      k2.innerHTML = `<div class="kLabel">Po</div><div class="kVal">${it.outSize ? prettyBytes(it.outSize) : "–"}</div>`;

      const k3 = document.createElement("div");
      k3.className = "k";
      k3.innerHTML = `<div class="kLabel">Ušetrené</div><div class="kVal">${it.outSize ? pctSaved(it.file.size, it.outSize) : "–"}</div>`;

      kpi.appendChild(k1); kpi.appendChild(k2); kpi.appendChild(k3);

      left.appendChild(top);
      left.appendChild(meta);
      left.appendChild(kpi);

      // Per-item progress
      const prog = document.createElement("div");
      prog.className = "iprog";
      prog.innerHTML = `<div class="iprogFill" style="width:${it.progress || 0}%"></div>`;

      const progMeta = document.createElement("div");
      progMeta.className = "iprogMeta";
      progMeta.innerHTML = `<span>${it.status === "working" ? "Konvertujem…" : ""}</span><span>${Math.round(it.progress || 0)}%</span>`;

      left.appendChild(prog);
      left.appendChild(progMeta);

      const actions = document.createElement("div");
      actions.className = "itemActions";

      const dl = document.createElement("a");
      dl.className = "smallBtn";
      dl.textContent = "Download";
      dl.href = it.outBlobUrl || "#";
      dl.download = "";
      dl.style.pointerEvents = it.outBlobUrl ? "auto" : "none";
      dl.style.opacity = it.outBlobUrl ? "1" : ".45";

      const retry = document.createElement("button");
      retry.className = "smallBtn ghost";
      retry.type = "button";
      retry.textContent = it.status === "done" ? "Reconvert" : "Retry";
      retry.disabled = it.status === "working";
      retry.addEventListener("click", () => convertOne(it.id, true));

      actions.appendChild(dl);
      actions.appendChild(retry);

      item.appendChild(left);
      item.appendChild(actions);
      listEl.appendChild(item);
    }

    updateButtons();
  };

  /* =====================================================
     ADD FILES
     ===================================================== */

  const addFiles = (newOnes) => {
    const accepted = normalizePicked(newOnes);
    if (!accepted.length) {
      setStatus("Podporované sú len JPG/PNG.", "bad");
      return;
    }

    for (const f of accepted) {
      files.push({
        id: nextId++,
        file: f,
        status: "ready",
        outBlobUrl: null,
        outBlob: null,
        outSize: null,
        progress: 0
      });
    }

    setStatus(`Pridané: ${accepted.length} súbor(ov).`, "ok");
    updateButtons();
    render();
    updateSummary();
    updateGlobalProgress();
  };

  /* =====================================================
     CLEAR ALL
     ===================================================== */

  const clearAll = () => {
    for (const it of files) if (it.outBlobUrl) URL.revokeObjectURL(it.outBlobUrl);
    files = [];
    if (fileInput) fileInput.value = "";

    setStatus("");
    updateButtons();
    render();
    if (summary) summary.hidden = true;

    if (gprog) gprog.hidden = true;
    if (gprogFill) gprogFill.style.width = "0%";
    if (gprogPct) gprogPct.textContent = "0%";
  };

  /* =====================================================
     UPLOAD INTERACTIONS
     ===================================================== */

  browse?.addEventListener("click", (e) => {
    e.preventDefault();
    fileInput?.click();
  });

  dropzone?.addEventListener("click", () => fileInput?.click());

  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput?.click();
  });

  fileInput?.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
  });

  /* =====================================================
     DRAG & DROP
     ===================================================== */

  ["dragenter", "dragover"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone?.addEventListener("drop", (e) => {
    const list = e.dataTransfer?.files;
    if (list?.length) addFiles(list);
  });

  clearBtn?.addEventListener("click", clearAll);

  /* =====================================================
     CONVERT HELPERS
     ===================================================== */

  const setItemStatus = (id, status) => {
    const it = files.find(x => x.id === id);
    if (!it) return;
    it.status = status;
    render();
  };

  function xhrConvertWithProgress({ file, format, quality, onProgress }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/convert?format=${encodeURIComponent(format)}&quality=${encodeURIComponent(quality)}`);
      xhr.responseType = "blob";

      // upload: 0-50%
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = (e.loaded / e.total) * 50;
        onProgress?.(p);
      };

      // download: 50-100% (needs Content-Length)
      xhr.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = 50 + (e.loaded / e.total) * 50;
        onProgress?.(p);
      };

      xhr.onload = () => {
        const ct = (xhr.getResponseHeader("content-type") || "").toLowerCase();
        const ok = xhr.status >= 200 && xhr.status < 300;

        if (!ok || !ct.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            const txt = String(reader.result || "");
            try {
              const data = JSON.parse(txt);
              reject(new Error(data?.error || `Server vrátil ${xhr.status} (${ct})`));
            } catch {
              reject(new Error(txt.slice(0, 200) || `Server vrátil ${xhr.status} (${ct})`));
            }
          };
          reader.onerror = () => reject(new Error(`Server vrátil ${xhr.status} (${ct})`));
          try {
            reader.readAsText(xhr.response);
          } catch {
            reject(new Error(`Server vrátil ${xhr.status} (${ct})`));
          }
          return;
        }

        const blob = xhr.response;
        if (!blob || blob.size === 0) {
          reject(new Error("Server vrátil prázdny súbor (0 B)."));
          return;
        }

        onProgress?.(100);
        resolve(blob);
      };

      xhr.onerror = () => reject(new Error("Network error"));

      const form = new FormData();
      form.append("image", file);
      xhr.send(form);
    });
  }

  /* =====================================================
     CONVERT ONE
     ===================================================== */

  async function convertOne(id, force = false) {
    const it = files.find(x => x.id === id);
    if (!it) return false;

    if (it.status === "working") return false;
    if (it.status === "done" && !force) return true;

    if (it.outBlobUrl) URL.revokeObjectURL(it.outBlobUrl);
    it.outBlobUrl = null;
    it.outBlob = null;
    it.outSize = null;
    it.progress = 0;

    setItemStatus(id, "working");
    updateGlobalProgress();

    const format = formatEl?.value || "webp";
    const quality = qualityEl?.value || "55";

    try {
      const blob = await xhrConvertWithProgress({
        file: it.file,
        format,
        quality,
        onProgress: (p) => setItemProgress(id, p)
      });

      it.outBlob = blob;
      it.outSize = blob.size;
      it.outBlobUrl = URL.createObjectURL(blob);
      it.status = "done";
      it.progress = 100;

      const ext = format === "jpeg" ? "jpg" : format;
      const base = safeName((it.file.name || "image").replace(/\.[^.]+$/, ""));
      const filename = `${base}.${ext}`;

      const node = listEl?.querySelector(`.item[data-id="${id}"] a.smallBtn`);
      if (node) {
        node.href = it.outBlobUrl;
        node.download = filename;
        node.style.pointerEvents = "auto";
        node.style.opacity = "1";
      }

      render();
      updateSummary();
      updateGlobalProgress();
      return true;

    } catch (e) {
      console.error(e);
      it.status = "error";
      it.progress = 0;
      render();
      updateGlobalProgress();
      setStatus(e?.message || "Konverzia zlyhala.", "bad");
      return false;
    }
  }

  /* =====================================================
     CONVERT ALL
     ===================================================== */

  async function convertAll() {
    if (!files.length) return;

    if (convertBtn) convertBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    if (zipBtn) zipBtn.disabled = true;

    setStatus("Konvertujem batch…", "");
    updateGlobalProgress();

    let ok = 0;
    for (const it of files) {
      const r = await convertOne(it.id, true);
      if (r) ok++;
    }

    if (convertBtn) convertBtn.disabled = false;
    if (clearBtn) clearBtn.disabled = false;

    if (ok === files.length) setStatus(`Hotovo ✅ Konvertované: ${ok}/${files.length}`, "ok");
    else setStatus(`Dokončené s chybami: ${ok}/${files.length}`, "bad");

    updateSummary();
    updateGlobalProgress();
    updateButtons();
  }

  convertBtn?.addEventListener("click", convertAll);

  /* =====================================================
     ZIP DOWNLOAD
     ===================================================== */

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function downloadZip() {
    if (!window.JSZip) {
      setStatus("JSZip nie je načítaný. Skontroluj CDN v index.html.", "bad");
      return;
    }

    const done = files.filter(f => f.status === "done" && f.outBlob);
    if (!done.length) {
      setStatus("Najprv niečo skonvertuj, potom ZIP.", "bad");
      return;
    }

    try {
      if (zipBtn) zipBtn.disabled = true;
      if (convertBtn) convertBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;

      const zip = new JSZip();

      // názvy v ZIP-e budú podľa originálu + aktuálneho výstupu
      const format = formatEl?.value || "webp";
      const ext = format === "jpeg" ? "jpg" : format;

      // ak sa opakujú mená, pridáme (2), (3)...
      const used = new Map();

      for (const it of done) {
        const base = safeName((it.file.name || "image").replace(/\.[^.]+$/, ""));
        let name = `${base}.${ext}`;
        const cnt = used.get(name) || 0;
        used.set(name, cnt + 1);
        if (cnt > 0) {
          name = `${base} (${cnt + 1}).${ext}`;
        }

        zip.file(name, it.outBlob);
      }

      setStatus("Balím ZIP…", "");

      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
        (meta) => {
          // ZIP progress (nie upload, ale samotné balenie)
          const p = Math.round(meta.percent || 0);
          setStatus(`Balím ZIP… ${p}%`, "");
        }
      );

      const stamp = new Date();
      const yyyy = stamp.getFullYear();
      const mm = String(stamp.getMonth() + 1).padStart(2, "0");
      const dd = String(stamp.getDate()).padStart(2, "0");
      const zipName = `converted-${yyyy}-${mm}-${dd}.zip`;

      downloadBlob(zipBlob, zipName);
      setStatus(`ZIP pripravený ✅ (${done.length} súborov)`, "ok");
    } catch (e) {
      console.error(e);
      setStatus(e?.message || "ZIP zlyhal.", "bad");
    } finally {
      updateButtons();
      if (convertBtn) convertBtn.disabled = files.length === 0;
      if (clearBtn) clearBtn.disabled = files.length === 0;
    }
  }

  zipBtn?.addEventListener("click", downloadZip);

  /* =====================================================
     INITIAL UI
     ===================================================== */

  updateButtons();
  render();
  updateSummary();
  updateGlobalProgress();
})();
