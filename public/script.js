(() => {
  // Helpers
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

  // Elements
  const dropzone = $("dropzone");
  const fileInput = $("file");
  const browse = $("browse");

  const formatEl = $("format");
  const qualityEl = $("quality");
  const qVal = $("qVal");

  const convertBtn = $("convert");
  const clearBtn = $("clear");
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

  // Basic sanity check
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
      dropzone, fileInput, browse, formatEl, qualityEl, qVal,
      convertBtn, clearBtn, statusEl, listEl, emptyState,
      summary, sumIn, sumOut, sumSave, themeToggle, themeIcon, themeText
    });
    // Still try to not crash
  }

  let files = []; // {id,file,status,outBlobUrl,outSize}
  let nextId = 1;

  const setStatus = (msg, type = "") => {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (type ? " " + type : "");
  };

  // Theme
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

  // Quality badge
  if (qualityEl && qVal) {
    qVal.textContent = qualityEl.value;
    qualityEl.addEventListener("input", () => (qVal.textContent = qualityEl.value));
  }

  const normalizePicked = (list) => {
    const out = [];
    for (const f of list) {
      if (/^image\/(jpeg|png)$/.test(f.type)) out.push(f);
    }
    return out;
  };

  const updateButtons = () => {
    const has = files.length > 0;
    if (convertBtn) convertBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
  };

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
  };

  const addFiles = (newOnes) => {
    const accepted = normalizePicked(newOnes);
    if (!accepted.length) {
      setStatus("Podporované sú len JPG/PNG.", "bad");
      return;
    }

    for (const f of accepted) {
      files.push({ id: nextId++, file: f, status: "ready", outBlobUrl: null, outSize: null });
    }

    setStatus(`Pridané: ${accepted.length} súbor(ov).`, "ok");
    updateButtons();
    render();
    updateSummary();
  };

  const clearAll = () => {
    for (const it of files) if (it.outBlobUrl) URL.revokeObjectURL(it.outBlobUrl);
    files = [];
    if (fileInput) fileInput.value = "";
    setStatus("");
    updateButtons();
    render();
    if (summary) summary.hidden = true;
  };

  // Upload interactions
  browse?.addEventListener("click", (e) => { e.preventDefault(); fileInput?.click(); });
  dropzone?.addEventListener("click", () => fileInput?.click());
  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput?.click();
  });

  fileInput?.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
  });

  // Drag & drop
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

  // Convert
  const setItemStatus = (id, status) => {
    const it = files.find(x => x.id === id);
    if (!it) return;
    it.status = status;
    render();
  };

  async function convertOne(id, force = false) {
    const it = files.find(x => x.id === id);
    if (!it) return false;

    if (it.status === "working") return false;
    if (it.status === "done" && !force) return true;

    if (it.outBlobUrl) URL.revokeObjectURL(it.outBlobUrl);
    it.outBlobUrl = null;
    it.outSize = null;

    setItemStatus(id, "working");

    const format = formatEl?.value || "avif";
    const quality = qualityEl?.value || "55";

    try {
      const form = new FormData();
      form.append("image", it.file);

      const res = await fetch(`/convert?format=${encodeURIComponent(format)}&quality=${encodeURIComponent(quality)}`, {
        method: "POST",
        body: form
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();

      if (!res.ok || !ct.startsWith("image/")) {
        const txt = await res.text().catch(() => "");
        try {
          const data = JSON.parse(txt);
          throw new Error(data?.error || `Server vrátil ${res.status} (${ct})`);
        } catch {
          throw new Error(txt?.slice(0, 200) || `Server vrátil ${res.status} (${ct})`);
        }
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error("Server vrátil prázdny súbor (0 B).");

      it.outSize = blob.size;
      it.outBlobUrl = URL.createObjectURL(blob);
      it.status = "done";

      const ext = format === "jpeg" ? "jpg" : format;
      const base = (it.file.name || "image").replace(/\.[^.]+$/, "");
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
      return true;
    } catch (e) {
      console.error(e);
      it.status = "error";
      render();
      setStatus(e?.message || "Konverzia zlyhala.", "bad");
      return false;
    }
  }

  async function convertAll() {
    if (!files.length) return;

    if (convertBtn) convertBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    setStatus("Konvertujem batch…", "");

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
  }

  convertBtn?.addEventListener("click", convertAll);

  // Initial UI state
  updateButtons();
  render();
})();
