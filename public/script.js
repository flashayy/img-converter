(() => {
  /* =====================================================
     HELPERS (mini utilitky)
     ===================================================== */

  // skratka na getElementById
  const $ = (id) => document.getElementById(id);

  // prevod bajtov na “ľudské” jednotky (B/KB/MB/GB)
  const prettyBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return "–";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
  };

  // vypočíta percento ušetrenej veľkosti: input -> output
  const pctSaved = (inB, outB) => {
    if (!inB || !outB) return "–";
    return `${((1 - outB / inB) * 100).toFixed(1)}%`;
  };


  /* =====================================================
     DOM ELEMENTS (referencie na UI)
     ===================================================== */

  // upload UI
  const dropzone = $("dropzone");
  const fileInput = $("file");
  const browse = $("browse");

  // nastavenia výstupu
  const formatEl = $("format");
  const qualityEl = $("quality");
  const qVal = $("qVal");

  // hlavné tlačidlá + status hláška
  const convertBtn = $("convert");
  const clearBtn = $("clear");
  const statusEl = $("status");

  // list s položkami + empty placeholder
  const listEl = $("list");
  const emptyState = $("emptyState");

  // sumarizácia: total input, total output, ušetrené
  const summary = $("summary");
  const sumIn = $("sumIn");
  const sumOut = $("sumOut");
  const sumSave = $("sumSave");

  // theme toggle UI
  const themeToggle = $("themeToggle");
  const themeIcon = $("themeIcon");
  const themeText = $("themeText");


  /* =====================================================
     BASIC SANITY CHECK (pomôže pri chybných id v HTML)
     ===================================================== */

  const required = [
    dropzone, fileInput, browse,
    formatEl, qualityEl, qVal,
    convertBtn, clearBtn, statusEl,
    listEl, emptyState,
    summary, sumIn, sumOut, sumSave,
    themeToggle, themeIcon, themeText
  ];

  // ak niečo chýba, iba to vypíšeme do konzoly
  // nech to hneď uvidíš pri debugovaní HTML
  if (required.some(x => !x)) {
    console.error("Missing one or more DOM elements. Check index.html ids.", {
      dropzone, fileInput, browse, formatEl, qualityEl, qVal,
      convertBtn, clearBtn, statusEl, listEl, emptyState,
      summary, sumIn, sumOut, sumSave, themeToggle, themeIcon, themeText
    });
    // stále pokračujeme, aby appka nespadla úplne
  }


  /* =====================================================
     APP STATE (držanie súborov a výsledkov)
     ===================================================== */

  // files = interný zoznam uploadnutých položiek
  // každá položka: { id, file, status, outBlobUrl, outSize }
  // status: "ready" | "working" | "done" | "error"
  let files = [];
  let nextId = 1;


  /* =====================================================
     STATUS MESSAGE (banner pod tlačidlami)
     ===================================================== */

  const setStatus = (msg, type = "") => {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (type ? " " + type : "");
    // type typicky: "ok" / "bad" / "" podľa CSS
  };


  /* =====================================================
     THEME (Dark/Light) + localStorage
     ===================================================== */

  // nastaví theme na <html data-theme="...">
  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);

    // update ikonky + textu
    const isLight = theme === "light";
    if (themeIcon) themeIcon.textContent = isLight ? "☀" : "☾";
    if (themeText) themeText.textContent = isLight ? "Light" : "Dark";

    // uloží do localStorage, aby ostalo aj po refresh
    localStorage.setItem("theme", theme);
  };

  // IIFE: pri štarte načítaj uloženú tému
  (() => {
    const saved = localStorage.getItem("theme");
    applyTheme(saved === "light" ? "light" : "dark");
  })();

  // click handler na prepnutie theme
  themeToggle?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
  });


  /* =====================================================
     QUALITY BADGE (živé číslo pri slideri)
     ===================================================== */

  if (qualityEl && qVal) {
    qVal.textContent = qualityEl.value;
    qualityEl.addEventListener("input", () => (qVal.textContent = qualityEl.value));
  }


  /* =====================================================
     FILE FILTERING (akceptujeme iba JPEG/PNG)
     ===================================================== */

  const normalizePicked = (list) => {
    const out = [];
    for (const f of list) {
      // tu je zámerne filter: iba image/jpeg alebo image/png
      if (/^image\/(jpeg|png)$/.test(f.type)) out.push(f);
    }
    return out;
  };


  /* =====================================================
     UI ENABLE/DISABLE (Convert/Clear)
     ===================================================== */

  const updateButtons = () => {
    const has = files.length > 0;
    if (convertBtn) convertBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
  };


  /* =====================================================
     SUMMARY PANEL (sumár pre batch)
     ===================================================== */

  const updateSummary = () => {
    if (!summary || !sumIn || !sumOut || !sumSave) return;

    // ak nie sú žiadne súbory, summary skryj
    if (!files.length) { summary.hidden = true; return; }

    // spočítaj total input a total output (iba tie čo už majú output)
    let totalIn = 0, totalOut = 0, anyOut = false;

    for (const it of files) {
      totalIn += it.file.size;
      if (it.outSize != null) { totalOut += it.outSize; anyOut = true; }
    }

    // ak nič ešte nebolo skonvertované, tiež skryj
    if (!anyOut) { summary.hidden = true; return; }

    summary.hidden = false;
    sumIn.textContent = prettyBytes(totalIn);
    sumOut.textContent = prettyBytes(totalOut);
    sumSave.textContent = `${prettyBytes(totalIn - totalOut)} (${pctSaved(totalIn, totalOut)})`;
  };


  /* =====================================================
     RENDER (prekreslenie zoznamu súborov)
     ===================================================== */

  const render = () => {
    if (!listEl || !emptyState) return;

    // vymaž existujúce .item DOM nodes
    listEl.querySelectorAll(".item").forEach(n => n.remove());

    // empty state: zobraz ak nie sú files
    emptyState.style.display = files.length ? "none" : "block";

    // vytvor nový DOM pre každý file item
    for (const it of files) {
      const item = document.createElement("div");
      item.className = "item";
      item.dataset.id = String(it.id);

      /* ----- LEFT SIDE: názov, meta, KPI ----- */

      const left = document.createElement("div");

      const top = document.createElement("div");
      top.className = "itemTop";

      const name = document.createElement("div");
      name.className = "itemName";
      name.textContent = it.file.name;

      // badge podľa statusu položky
      const badge = document.createElement("div");
      badge.className = "itemBadge";
      badge.textContent =
        it.status === "ready" ? "Ready" :
        it.status === "working" ? "Converting…" :
        it.status === "done" ? "Done" : "Error";

      top.appendChild(name);
      top.appendChild(badge);

      // metadata (MIME + veľkosť)
      const meta = document.createElement("div");
      meta.className = "itemMeta";
      meta.textContent = `${it.file.type} • ${prettyBytes(it.file.size)}`;

      // KPI blok (pred/po/ušetrené)
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

      /* ----- RIGHT SIDE: actions ----- */

      const actions = document.createElement("div");
      actions.className = "itemActions";

      // download link (funkčný až po konverzii)
      const dl = document.createElement("a");
      dl.className = "smallBtn";
      dl.textContent = "Download";
      dl.href = it.outBlobUrl || "#";
      dl.download = ""; // reálne meno nastavujeme po konverzii
      dl.style.pointerEvents = it.outBlobUrl ? "auto" : "none";
      dl.style.opacity = it.outBlobUrl ? "1" : ".45";

      // retry button (retry/reconvert)
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


  /* =====================================================
     ADD FILES (pridanie do state + UI refresh)
     ===================================================== */

  const addFiles = (newOnes) => {
    // vyfiltruj iba png/jpg
    const accepted = normalizePicked(newOnes);

    // ak nič neprešlo filtrom, vypíš status
    if (!accepted.length) {
      setStatus("Podporované sú len JPG/PNG.", "bad");
      return;
    }

    // pridaj každú položku do state
    for (const f of accepted) {
      files.push({
        id: nextId++,
        file: f,
        status: "ready",
        outBlobUrl: null,
        outSize: null
      });
    }

    setStatus(`Pridané: ${accepted.length} súbor(ov).`, "ok");
    updateButtons();
    render();
    updateSummary();
  };


  /* =====================================================
     CLEAR ALL (vyčistenie state + uvoľnenie blob URL)
     ===================================================== */

  const clearAll = () => {
    // revoke ObjectURL aby neunikala pamäť
    for (const it of files) if (it.outBlobUrl) URL.revokeObjectURL(it.outBlobUrl);

    files = [];

    // reset file inputu (aby si mohol znova vybrať rovnaký súbor)
    if (fileInput) fileInput.value = "";

    setStatus("");
    updateButtons();
    render();
    if (summary) summary.hidden = true;
  };


  /* =====================================================
     UPLOAD INTERACTIONS (klik browse, klik dropzone, enter/space)
     ===================================================== */

  browse?.addEventListener("click", (e) => {
    e.preventDefault();
    fileInput?.click();
  });

  dropzone?.addEventListener("click", () => fileInput?.click());

  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput?.click();
  });

  // keď user vyberie súbory cez file input
  fileInput?.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
  });


  /* =====================================================
     DRAG & DROP (vizuálny “dragover” + drop handler)
     ===================================================== */

  // keď user ťahá súbor nad dropzone, aktivuj highlight
  ["dragenter", "dragover"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  // keď user odíde alebo dropne, vypni highlight
  ["dragleave", "drop"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });

  // samotný drop: pridaj súbory
  dropzone?.addEventListener("drop", (e) => {
    const list = e.dataTransfer?.files;
    if (list?.length) addFiles(list);
  });


  /* =====================================================
     CLEAR BUTTON
     ===================================================== */

  clearBtn?.addEventListener("click", clearAll);


  /* =====================================================
     CONVERT HELPERS
     ===================================================== */

  // zmení status v state a rerenderne UI
  const setItemStatus = (id, status) => {
    const it = files.find(x => x.id === id);
    if (!it) return;
    it.status = status;
    render();
  };


  /* =====================================================
     CONVERT ONE (konvertuje jeden súbor cez /convert)
     ===================================================== */

  async function convertOne(id, force = false) {
    const it = files.find(x => x.id === id);
    if (!it) return false;

    // ochrana proti duplicitnému klikaniu
    if (it.status === "working") return false;

    // ak je už hotovo a nechceš force, tak nič nerob
    if (it.status === "done" && !force) return true;

    // ak existuje starý output, uvoľni URL
    if (it.outBlobUrl) URL.revokeObjectURL(it.outBlobUrl);
    it.outBlobUrl = null;
    it.outSize = null;

    // nastav working
    setItemStatus(id, "working");

    // vyber formát a kvalitu z UI
    const format = formatEl?.value || "avif";
    const quality = qualityEl?.value || "55";

    try {
      // multipart upload
      const form = new FormData();
      form.append("image", it.file);

      // request na backend endpoint /convert
      const res = await fetch(
        `/convert?format=${encodeURIComponent(format)}&quality=${encodeURIComponent(quality)}`,
        { method: "POST", body: form }
      );

      // content-type: očakávame image/*
      const ct = (res.headers.get("content-type") || "").toLowerCase();

      // ak server vráti error (JSON/text), skús ho vytiahnuť
      if (!res.ok || !ct.startsWith("image/")) {
        const txt = await res.text().catch(() => "");
        try {
          const data = JSON.parse(txt);
          throw new Error(data?.error || `Server vrátil ${res.status} (${ct})`);
        } catch {
          throw new Error(txt?.slice(0, 200) || `Server vrátil ${res.status} (${ct})`);
        }
      }

      // výsledok ako Blob (obrázok)
      const blob = await res.blob();

      // ochrana: 0B output je bug
      if (!blob || blob.size === 0) throw new Error("Server vrátil prázdny súbor (0 B).");

      // ulož output info do state
      it.outSize = blob.size;
      it.outBlobUrl = URL.createObjectURL(blob);
      it.status = "done";

      // nastav filename pre download
      const ext = format === "jpeg" ? "jpg" : format;
      const base = (it.file.name || "image").replace(/\.[^.]+$/, "");
      const filename = `${base}.${ext}`;

      // update priamo download button v DOM (zrýchlenie UX)
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


  /* =====================================================
     CONVERT ALL (batch konverzia postupne)
     ===================================================== */

  async function convertAll() {
    if (!files.length) return;

    // zablokuj tlačidlá aby user nerobil chaos počas batchu
    if (convertBtn) convertBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;

    setStatus("Konvertujem batch…", "");

    // postupne (nie paralelne) konvertuj každú položku
    let ok = 0;
    for (const it of files) {
      const r = await convertOne(it.id, true);
      if (r) ok++;
    }

    // odomkni UI
    if (convertBtn) convertBtn.disabled = false;
    if (clearBtn) clearBtn.disabled = false;

    // výsledný status
    if (ok === files.length) setStatus(`Hotovo ✅ Konvertované: ${ok}/${files.length}`, "ok");
    else setStatus(`Dokončené s chybami: ${ok}/${files.length}`, "bad");

    updateSummary();
  }

  // click handler na Convert
  convertBtn?.addEventListener("click", convertAll);


  /* =====================================================
     INITIAL UI STATE (pri načítaní stránky)
     ===================================================== */

  updateButtons();
  render();
})();
