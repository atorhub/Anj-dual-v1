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
    exportCSV: document.getElementById("exportCSV")
  };

  let db;
  let selectedHistoryItem = null;

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* ---------- THEME & LAYOUT ---------- */

  el.theme.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`theme-${el.theme.value}`);
    localStorage.setItem("anj-theme", el.theme.value);
  });

  el.layout.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("layout-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`layout-${el.layout.value}`);
    localStorage.setItem("anj-layout", el.layout.value);
  });

  const savedTheme = localStorage.getItem("anj-theme");
  const savedLayout = localStorage.getItem("anj-layout");
  if (savedTheme) document.body.classList.add(`theme-${savedTheme}`);
  if (savedLayout) document.body.classList.add(`layout-${savedLayout}`);

  /* ---------- OCR & PDF ---------- */

  async function runOCR(file) {
    setStatus("OCR running…");
    const res = await Tesseract.recognize(file, "eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          setStatus(`OCR ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    return res.data.text || "";
  }

  async function extractText(file) {
    if (file.name.endsWith(".pdf")) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(i => i.str).join(" ") + "\n";
      }
      return text;
    }
    return "";
  }

  function cleanText(txt) {
    return txt.replace(/\s+/g, " ").trim();
  }

  function parseInvoice(text) {
    const out = { merchant: null, date: null, total: null };
    const total = text.match(/total[:\s]*₹?\s*([\d,.]+)/i);
    const date = text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);
    if (total) out.total = total[1];
    if (date) out.date = date[0];
    out.merchant = text.split(" ").slice(0, 4).join(" ");
    return out;
  }

  async function processFile(useOCR) {
    if (!el.file.files[0]) {
      setStatus("No file selected", true);
      return;
    }

    let text = "";
    const file = el.file.files[0];

    if (file.type.startsWith("image/") && useOCR) {
      text = await runOCR(file);
    } else {
      text = await extractText(file);
    }

    text = cleanText(text);
    const parsed = parseInvoice(text);

    window._lastParsed = parsed;
    selectedHistoryItem = null;

    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    el.json.textContent = JSON.stringify(parsed, null, 2);

    el.editMerchant.value = parsed.merchant || "";
    el.editDate.value = parsed.date || "";
    el.editTotal.value = parsed.total || "";

    setStatus("Done ✓");
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);

  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const parsed = parseInvoice(el.clean.textContent);
    window._lastParsed = parsed;
    selectedHistoryItem = null;

    el.json.textContent = JSON.stringify(parsed, null, 2);
    el.editMerchant.value = parsed.merchant || "";
    el.editDate.value = parsed.date || "";
    el.editTotal.value = parsed.total || "";

    setStatus("Parsed ✓");
  };

  /* ---------- EXPORT ---------- */

  function getExportData() {
    if (selectedHistoryItem) return selectedHistoryItem;
    if (!window._lastParsed) return null;
    return {
      merchant: el.editMerchant.value,
      date: el.editDate.value,
      total: el.editTotal.value
    };
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  el.exportJSON.onclick = () => {
    const d = getExportData();
    if (!d) return setStatus("Nothing to export", true);
    downloadFile("invoice.json", JSON.stringify(d, null, 2), "application/json");
    setStatus("JSON exported ✓");
  };

  el.exportTXT.onclick = () => {
    const d = getExportData();
    if (!d) return setStatus("Nothing to export", true);
    downloadFile(
      "invoice.txt",
      `Merchant: ${d.merchant}\nDate: ${d.date}\nTotal: ${d.total}`,
      "text/plain"
    );
    setStatus("TXT exported ✓");
  };

  el.exportCSV.onclick = () => {
    const d = getExportData();
    if (!d) return setStatus("Nothing to export", true);
    downloadFile(
      "invoice.csv",
      `Merchant,Date,Total\n"${d.merchant}","${d.date}","${d.total}"`,
      "text/csv"
    );
    setStatus("CSV exported ✓");
  };

  /* ---------- SIDEBAR ---------- */

  document.getElementById("sidebarToggle").onclick = () =>
    document.body.classList.toggle("sidebar-hidden");

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

  function loadHistory(filter = "") {
    el.historyList.innerHTML = "";
    selectedHistoryItem = null;

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

      const li = document.createElement("li");
      li.textContent =
        (item.merchant || "Unknown") +
        " • " +
        new Date(item.timestamp).toLocaleString();

      li.onclick = () => {
        selectedHistoryItem = item;
        window._lastParsed = item;
        el.editMerchant.value = item.merchant || "";
        el.editDate.value = item.date || "";
        el.editTotal.value = item.total || "";
        el.json.textContent = JSON.stringify(item, null, 2);
        setStatus("History item selected ✓");
      };

      el.historyList.appendChild(li);
      cursor.continue();
    };
  }

  el.historySearch.oninput = () =>
    loadHistory(el.historySearch.value.toLowerCase());

  el.clearHistoryBtn.onclick = () => {
    if (!confirm("Clear ALL history?")) return;
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    tx.oncomplete = () => {
      el.historyList.innerHTML = "";
      selectedHistoryItem = null;
      setStatus("All history cleared ✓");
    };
  };

  el.saveBtn.onclick = () => {
    if (!window._lastParsed) {
      setStatus("Nothing to save", true);
      return;
    }

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
    
