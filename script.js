console.log("SCRIPT LOADED");

import { verifyInvoiceTotals } from "./invoiceVerification.js";

// Bind legacy globals explicitly (CRITICAL)
const pdfjsLib = window.pdfjsLib;
const Tesseract = window.Tesseract;

/* =======================
   ANONYMOUS USER ID
======================= */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function initAnonUserId() {
  let anonId = localStorage.getItem("anon_user_id");
  if (!anonId) {
    anonId = generateUUID();
    localStorage.setItem("anon_user_id", anonId);
  }
  return anonId;
}

// Expose helper function globally
window.getAnonUserId = () => localStorage.getItem("anon_user_id");

// Initialize on load
initAnonUserId();

/* =======================
   EVENT TRACKING (HARDENED)
======================= */
// Simple debounce state to prevent duplicate logs within 1 second
const lastTracked = {};

function trackEvent(eventName, meta = {}) {
  const now = Date.now();
  
  // Prevent duplicate logs of the same event within 1 second (1000ms)
  if (lastTracked[eventName] && (now - lastTracked[eventName] < 1000)) {
    return;
  }
  lastTracked[eventName] = now;

  const userId = localStorage.getItem("anon_user_id");
  
  // Derive current page name from active .page-* element
  const activePageEl = document.querySelector(".page.active");
  let pageName = "unknown";
  if (activePageEl) {
    const match = activePageEl.className.match(/page-([^\s]+)/);
    if (match) pageName = match[1];
  }

  console.log(`[TRACK] ${JSON.stringify({
    event: eventName,
    userId: userId,
    timestamp: now,
    page: pageName,
    meta: meta
  }, null, 2)}`);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM READY");
  trackEvent("app_loaded");

  /* =======================
     ELEMENT REFERENCES
  ======================= */
  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),

    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),

    saveBtn: document.getElementById("saveBtn"),
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),

    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),

    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect"),

    sidebarToggle: document.getElementById("sidebarToggle"),

    historyList: document.getElementById("historyList"),
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn")
  };

  /* =======================
     STATE
  ======================= */
  let db = null;
  let hasParsedData = false;
  let selectedHistoryItem = null;
  let currentParsedData = null;
  let lastSavedId = null;

  /* =======================
     STATUS & UI HELPERS
  ======================= */
  function setStatus(msg, err = false) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  function updateParsedUI(enabled) {
    [
      el.saveBtn,
      el.exportJSON,
      el.exportTXT,
      el.exportCSV,
      el.editMerchant,
      el.editDate,
      el.editTotal
    ].forEach(x => {
      if (!x) return;
      x.disabled = !enabled;
      x.style.opacity = enabled ? "1" : "0.5";
      x.style.pointerEvents = enabled ? "auto" : "none";
    });
  }

  updateParsedUI(false);

  /* =======================
     CONFIDENCE HELPERS
  ======================= */
  function showConfidenceHelpOnce() {
    if (localStorage.getItem("hideConfidenceHelp") === "1") return;

    const dontShow = confirm(
      "Parse Confidence indicates how reliably key fields were extracted after parsing.\n\n" +
      "Lower confidence means some fields may require manual review.\n\n" +
      "Press OK to continue.\n\n" +
      "Press Cancel to not show this again."
    );

    if (!dontShow) {
      localStorage.setItem("hideConfidenceHelp", "1");
    }
  }

  /* =======================
     SIDEBAR & NAVIGATION
  ======================= */
  el.sidebarToggle?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-hidden");
  });

  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
  sidebarCloseBtn?.addEventListener("click", () => {
    document.body.classList.add("sidebar-hidden");
  });

  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;

      document.querySelectorAll(".nav-item").forEach(n =>
        n.classList.remove("active")
      );
      item.classList.add("active");

      document.querySelectorAll(".page").forEach(p =>
        p.classList.remove("active")
      );
      document.querySelector(".page-" + page)?.classList.add("active");

      if (window.innerWidth <= 768) {
        document.body.classList.add("sidebar-hidden");
      }
    });
  });

  /* =======================
     THEMES & LAYOUTS
  ======================= */
  el.theme?.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add("theme-" + el.theme.value);
    localStorage.setItem("anj-theme", el.theme.value);
  });

  const savedTheme = localStorage.getItem("anj-theme");
  if (savedTheme && el.theme) {
    el.theme.value = savedTheme;
    document.body.classList.add("theme-" + savedTheme);
  }

  el.layout?.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("layout-")) document.body.classList.remove(c);
    });
    document.body.classList.add("layout-" + el.layout.value);
    localStorage.setItem("anj-layout", el.layout.value);
  });

  const savedLayout = localStorage.getItem("anj-layout");
  if (savedLayout && el.layout) {
    el.layout.value = savedLayout;
    document.body.classList.add("layout-" + savedLayout);
  }

  /* =======================
     PDF & OCR
  ======================= */
  async function pdfToCanvas(file) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  async function runOCR(file) {
    setStatus("OCR running...");

    let source = file;
    if (file.type === "application/pdf") {
      source = await pdfToCanvas(file);
    }

    const result = await Tesseract.recognize(source, "eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          setStatus(`OCR ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    return result.data.text || "";
  }

  async function processFile() {
    if (!el.file || !el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    const file = el.file.files[0];
    const text = await runOCR(file);

    if (el.raw) el.raw.textContent = text || "--";
    if (el.clean) el.clean.textContent = text || "--";
    setStatus("OCR done ✓");
  }

  el.file?.addEventListener("change", () => {
    if (el.file.files[0]) {
      trackEvent("file_selected");
    }
  });

  el.dual?.addEventListener("click", () => {
    trackEvent("dual_ocr_clicked");
    processFile();
  });
  el.ocr?.addEventListener("click", () => {
    trackEvent("quick_ocr_clicked");
    processFile();
  });

  /* =======================
     PARSING
  ======================= */
  function parseInvoice(text) {
    const out = { merchant: "", date: "", total: "" };

    const totalMatch = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const dateMatch = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);

    if (totalMatch) out.total = totalMatch[1];
    if (dateMatch) out.date = dateMatch[0];

    out.merchant = text
      .split(/\n| /)
      .slice(0, 4)
      .join(" ")
      .trim();

    return out;
  }

  el.parse?.addEventListener("click", () => {
    if (!el.clean || !el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const rawText = el.clean.textContent;
    const parsed = parseInvoice(rawText);
    trackEvent("invoice_parsed");
    
    // Fixed: using 'parsed' instead of undefined 'parsedInvoice'
    const verification = verifyInvoiceTotals(parsed);

    if (verification.status === "Verified") {
      setStatus("✅ Verified");
      trackEvent("invoice_verified");
    } else if (verification.status === "Needs Review") {
      setStatus("⚠ Needs Review", true);
    } else {
      setStatus("❌ Unverifiable", true);
    }

    // Update UI with parsed data
    if (el.editMerchant) el.editMerchant.value = parsed.merchant;
    if (el.editDate) el.editDate.value = parsed.date;
    if (el.editTotal) el.editTotal.value = parsed.total;
    if (el.json) el.json.textContent = JSON.stringify(parsed, null, 2);
    
    hasParsedData = true;
    updateParsedUI(true);

    document.querySelector('[data-page="parsed"]')?.click();
  });

  /* =======================
     EDIT FIELD TRACKING
  ======================= */
  // Track when merchant, date, or total fields are edited
  [el.editMerchant, el.editDate, el.editTotal].forEach(field => {
    field?.addEventListener("input", (e) => {
      trackEvent("edit_field_changed", { field: e.target.id, value: e.target.value });
    });
  });

  /* =======================
     HISTORY (IndexedDB)
  ======================= */
  function initDB() {
    const req = indexedDB.open("anj-dual-ocr", 1);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("history")) {
        db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      }
    };

    req.onsuccess = e => {
      db = e.target.result;
      setTimeout(() => loadHistory(), 0);
    };
  }

  function renderHistoryItem(item, list) {
    const li = document.createElement("li");

    li.textContent =
      (item.merchant || "Unknown") +
      " • " +
      new Date(item.timestamp).toLocaleString();

    if (item.id === lastSavedId) {
      li.classList.add("history-active");
      li.scrollIntoView({ block: "nearest" });
    }

    li.addEventListener("click", () => {
      hasParsedData = true;
      selectedHistoryItem = item;

      if (item.id === lastSavedId) {
        lastSavedId = null;
        li.classList.remove("history-active");
      }

      if (el.editMerchant) el.editMerchant.value = item.merchant;
      if (el.editDate) el.editDate.value = item.date;
      if (el.editTotal) el.editTotal.value = item.total;
      if (el.json) el.json.textContent = JSON.stringify(item, null, 2);

      updateParsedUI(true);
      document.querySelector('[data-page="parsed"]')?.click();
    });

    list.appendChild(li);
  }

  function loadHistory(filter = "") {
    if (!db) return;

    if (el.historyList) el.historyList.innerHTML = "";
    if (el.historyPageList) el.historyPageList.innerHTML = "";

    const tx = db.transaction("history", "readonly");
    tx.objectStore("history").openCursor(null, "prev").onsuccess = e => {
      const c = e.target.result;
      if (!c) return;

      const item = c.value;
      const text = `${item.merchant} ${item.date} ${item.total}`.toLowerCase();
      if (!filter || text.includes(filter)) {
        if (el.historyList) renderHistoryItem(item, el.historyList);
        if (el.historyPageList) renderHistoryItem(item, el.historyPageList);
      }
      c.continue();
    };
  }

  el.historySearch?.addEventListener("input", e =>
    loadHistory(e.target.value.toLowerCase())
  );

  el.saveBtn?.addEventListener("click", () => {
    if (!hasParsedData || !db) return;

    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");

    const request = store.add({
      merchant: el.editMerchant.value,
      date: el.editDate.value,
      total: el.editTotal.value,
      timestamp: Date.now()
    });

    request.onsuccess = e => {
      lastSavedId = e.target.result;
    };

    tx.oncomplete = () => {
      trackEvent("history_saved");
      setTimeout(() => {
        loadHistory();
        setStatus("Saved ✓");
      }, 0);
    };

    tx.onerror = () => {
      setStatus("Save failed", true);
    };
  });

  el.clearHistoryBtn?.addEventListener("click", () => {
    if (!confirm("Clear all history?")) return;
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    tx.oncomplete = loadHistory;
  });

  /* =======================
     EXPORTS (GATED)
  ======================= */
  // Task 2: Export Feature Gating
  // Modify existing export button handlers to track attempt and show premium message
  const handleExportAttempt = (type) => {
    // Track the corresponding export_attempted_* event
    trackEvent(`export_attempted_${type}`);
    // Show status message
    setStatus("Export is a premium feature", true);
  };

  el.exportJSON?.addEventListener("click", () => handleExportAttempt("json"));
  el.exportTXT?.addEventListener("click", () => handleExportAttempt("txt"));
  el.exportCSV?.addEventListener("click", () => handleExportAttempt("csv"));

  initDB();
  setStatus("Ready ✓");
});
     
