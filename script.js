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

    /* ✅ ADDED */
    historyList: document.getElementById("historyList")
  };

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* THEME SWITCH – SAFE */
  el.theme.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`theme-${el.theme.value}`);
  });

  /* LAYOUT SWITCH – SAFE */
  el.layout.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("layout-")) document.body.classList.remove(c);
    });
    document.body.classList.add(`layout-${el.layout.value}`);
  });

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
      setStatus("Reading PDF…");
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

  /* -------- INDEXEDDB (HISTORY STORAGE) -------- */
  let db;

  function initDB() {
    const request = indexedDB.open("anj-dual-ocr", 1);

    request.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains("history")) {
        db.createObjectStore("history", {
          keyPath: "id",
          autoIncrement: true
        });
      }
    };

    request.onsuccess = e => {
      db = e.target.result;
      loadHistory();
    };

    request.onerror = () => {
      console.error("IndexedDB failed to open");
    };
  }

  function saveToHistory(data) {
    if (!db) return;

    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");

    store.add({
      ...data,
      timestamp: Date.now()
    });

    tx.oncomplete = loadHistory;
  }

  function loadHistory() {
    if (!db || !el.historyList) return;

    el.historyList.innerHTML = "";

    const tx = db.transaction("history", "readonly");
    const store = tx.objectStore("history");
    const req = store.openCursor(null, "prev");

    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;

      const item = cursor.value;
      const li = document.createElement("li");
      li.textContent =
        (item.merchant || "Unknown") +
        " • " +
        new Date(item.timestamp).toLocaleString();

      li.onclick = () => {
        el.json.textContent = JSON.stringify(item, null, 2);
      };

      el.historyList.appendChild(li);
      cursor.continue();
    };
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
    const finalResult = parseInvoice(text);

    el.raw.textContent = text || "--";
    el.clean.textContent = text || "--";
    el.json.textContent = JSON.stringify(finalResult, null, 2);

    /* expose save hook */
    window._lastParsed = finalResult;

    setStatus("Done ✓");
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);

  el.parse.onclick = () => {
    if (!el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }
    const result = parseInvoice(el.clean.textContent);
    el.json.textContent = JSON.stringify(result, null, 2);
    window._lastParsed = result;
    setStatus("Parsed ✓");
  };

  const sidebarToggle = document.getElementById("sidebarToggle");
  sidebarToggle.onclick = () =>
    document.body.classList.toggle("sidebar-hidden");

  /* -------- SAVE TRIGGER -------- */
  initDB();

  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault();
      if (!window._lastParsed) return;

      saveToHistory(window._lastParsed);
      setStatus("Saved to history ✓");
    }
  });

  setStatus("Ready ✓");
});
      
