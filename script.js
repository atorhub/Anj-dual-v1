document.addEventListener("DOMContentLoaded", () => {

  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),

    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),

    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect"),

    historyList: document.getElementById("historyList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),

    saveBtn: document.getElementById("saveBtn"),
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),

    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),

    // ✅ ADDED: History page container
    historyPageList: document.getElementById("historyPageList")
  };

  let db;
  let selectedHistoryItem = null;
  let hasParsedData = false; // ✅ ADDED

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* ---------- PARSED UI STATE ---------- */

  // ✅ ADDED
  function updateParsedUI(enabled) {
    [
      el.saveBtn,
      el.exportJSON,
      el.exportTXT,
      el.exportCSV,
      el.editMerchant,
      el.editDate,
      el.editTotal
    ].forEach(elm => {
      if (!elm) return;
      elm.disabled = !enabled;
      elm.style.opacity = enabled ? "1" : "0.5";
      elm.style.pointerEvents = enabled ? "auto" : "none";
    });
  }

  updateParsedUI(false); // default disabled

  /* ---------- OCR / PARSE ---------- */

  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (total) out.total = total[1];
    if (date) out.date = date[0];
    out.merchant = text.split(" ").slice(0, 4).join(" ");
    return out;
  }

  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const parsed = parseInvoice(el.clean.textContent);
    window._lastParsed = parsed;
    selectedHistoryItem = null;
    hasParsedData = true; // ✅ ADDED

    el.json.textContent = JSON.stringify(parsed, null, 2);
    el.editMerchant.value = parsed.merchant || "";
    el.editDate.value = parsed.date || "";
    el.editTotal.value = parsed.total || "";

    updateParsedUI(true); // ✅ ADDED
    setStatus("Parsed ✓");

    document.querySelector('[data-page="parsed"]')?.click();
  };

  /* ---------- HISTORY / INDEXEDDB ---------- */

  function initDB() {
    const req = indexedDB.open("anj-dual-ocr", 1);

    req.onupgradeneeded = e => {
      db = e.target.result;
      db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
    };

    req.onsuccess = e => {
      db = e.target.result;
      loadHistory();
    };
  }

  function renderHistoryItem(item, targetList) {
    const li = document.createElement("li");
    li.textContent =
      (item.merchant || "Unknown") +
      " • " +
      new Date(item.timestamp).toLocaleString();

    li.onclick = () => {
      selectedHistoryItem = item;
      window._lastParsed = item;
      hasParsedData = true;

      el.editMerchant.value = item.merchant || "";
      el.editDate.value = item.date || "";
      el.editTotal.value = item.total || "";
      el.json.textContent = JSON.stringify(item, null, 2);

      updateParsedUI(true); // ✅ ADDED
      setStatus("History item loaded ✓");

      document.querySelector('[data-page="parsed"]')?.click();
    };

    targetList.appendChild(li);
  }

  function loadHistory(filter = "") {
    if (!db) return;

    el.historyList.innerHTML = "";
    if (el.historyPageList) el.historyPageList.innerHTML = "";

    const tx = db.transaction("history", "readonly");
    tx.objectStore("history").openCursor(null, "prev").onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;

      const item = cursor.value;
      const text = `${item.merchant} ${item.date} ${item.total}`.toLowerCase();
      if (filter && !text.includes(filter)) {
        cursor.continue();
        return;
      }

      renderHistoryItem(item, el.historyList);
      if (el.historyPageList) {
        renderHistoryItem(item, el.historyPageList); // ✅ ADDED
      }

      cursor.continue();
    };
  }

  el.historySearch.oninput = () =>
    loadHistory(el.historySearch.value.toLowerCase());

  el.saveBtn.onclick = () => {
    if (!hasParsedData) return;

    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").add({
      merchant: el.editMerchant.value,
      date: el.editDate.value,
      total: el.editTotal.value,
      timestamp: Date.now()
    });

    tx.oncomplete = loadHistory;
    setStatus("Saved to history ✓");
  };

  initDB();
  setStatus("Ready ✓");
});

/* ---------- PAGE NAVIGATION ---------- */

const navItems = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");

navItems.forEach(item => {
  item.addEventListener("click", () => {
    const page = item.dataset.page;

    navItems.forEach(n => n.classList.remove("active"));
    item.classList.add("active");

    pages.forEach(p => p.classList.remove("active"));
    document.querySelector(".page-" + page)?.classList.add("active");

    document.body.className =
      document.body.className.replace(/page-\S+/g, "").trim() +
      " page-" + page;

    if (window.innerWidth <= 768) {
      document.body.classList.add("sidebar-hidden");
    }
  });
});
        
