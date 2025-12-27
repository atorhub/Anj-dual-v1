document.addEventListener("DOMContentLoaded", () => {

 {

  const el = {
    file: fileInput,
    raw: rawText,
    clean: cleanedText,
    json: jsonPreview,
    status: statusBar,

    dual: dualOCRBtn,
    ocr: ocrOnlyBtn,
    parse: parseBtn,

    saveOCR: saveOCRBtn,
    saveParsed: saveBtn,

    editMerchant,
    editDate,
    editTotal,

    exportJSON,
    exportTXT,
    exportCSV,

    sidebarToggle,
    theme: themeSelect,
    layout: layoutSelect,

    historyList,
    historyPageList,
    historySearch,
    clearHistoryBtn
  };

  let db;
  let currentOCR = null;
  let currentParsed = null;
  let selectedHistoryId = null;

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "red" : "lime";
  }

  /* ---------- SIDEBAR ---------- */
  sidebarToggle.onclick = () =>
    document.body.classList.toggle("sidebar-hidden");

  /* ---------- OCR ---------- */

  async function pdfToCanvas(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  async function runOCR() {
    if (!el.file.files[0]) return setStatus("No file selected", true);

    setStatus("OCR running...");
    let source = el.file.files[0];

    if (source.type === "application/pdf") {
      source = await pdfToCanvas(source);
    }

    const res = await Tesseract.recognize(source, "eng");
    currentOCR = res.data.text || "";

    el.raw.textContent = currentOCR;
    el.clean.textContent = currentOCR;

    el.saveOCR.disabled = false;
    setStatus("OCR done ✓");
  }

  el.dual.onclick = runOCR;
  el.ocr.onclick = runOCR;

  /* ---------- SAVE OCR ---------- */

  function saveOCRSnapshot() {
    if (!currentOCR) return;

    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").add({
      raw: currentOCR,
      cleaned: currentOCR,
      timestamp: Date.now()
    });

    tx.oncomplete = loadHistory;
    setStatus("OCR saved ✓");
  }

  el.saveOCR.onclick = saveOCRSnapshot;

  /* ---------- PARSE ---------- */

  function parseInvoice(text) {
    return {
      merchant: text.split("\n")[0] || "",
      date: (text.match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [""])[0],
      total: (text.match(/total[:\s]*([\d,.]+)/i) || [""])[1] || ""
    };
  }

  el.parse.onclick = () => {
    if (!currentOCR) return setStatus("Nothing to parse", true);

    currentParsed = parseInvoice(currentOCR);

    el.editMerchant.value = currentParsed.merchant;
    el.editDate.value = currentParsed.date;
    el.editTotal.value = currentParsed.total;

    el.json.textContent = JSON.stringify(currentParsed, null, 2);

    [
      el.editMerchant,
      el.editDate,
      el.editTotal,
      el.saveParsed,
      el.exportJSON,
      el.exportTXT,
      el.exportCSV
    ].forEach(e => e.disabled = false);

    setStatus("Parsed ✓");
  };

  /* ---------- SAVE PARSED ---------- */

  el.saveParsed.onclick = () => {
    if (!currentParsed) return;

    currentParsed.merchant = el.editMerchant.value;
    currentParsed.date = el.editDate.value;
    currentParsed.total = el.editTotal.value;

    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").add({
      ...currentParsed,
      timestamp: Date.now()
    });

    tx.oncomplete = loadHistory;
    setStatus("Saved ✓");
  };

  /* ---------- EXPORT ---------- */

  function download(name, content) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content]));
    a.download = name;
    a.click();
  }

  exportJSON.onclick = () =>
    download("invoice.json", JSON.stringify(currentParsed, null, 2));

  exportTXT.onclick = () =>
    download("invoice.txt", JSON.stringify(currentParsed, null, 2));

  exportCSV.onclick = () =>
    download(
      "invoice.csv",
      Object.values(currentParsed).join(",")
    );

  /* ---------- HISTORY ---------- */

  function initDB() {
    const req = indexedDB.open("anj-dual-ocr", 1);
    req.onupgradeneeded = e =>
      e.target.result.createObjectStore("history", {
        keyPath: "id",
        autoIncrement: true
      });
    req.onsuccess = e => {
      db = e.target.result;
      loadHistory();
    };
  }

  function loadHistory() {
    historyList.innerHTML = "";
    historyPageList.innerHTML = "";

    const tx = db.transaction("history", "readonly");
    tx.objectStore("history").openCursor(null, "prev").onsuccess = e => {
      const c = e.target.result;
      if (!c) return;

      const li = document.createElement("li");
      li.textContent = new Date(c.value.timestamp).toLocaleString();
      historyList.appendChild(li);
      historyPageList.appendChild(li.cloneNode(true));
      c.continue();
    };
  }

  initDB();
  setStatus("Ready ✓");
});

/* ---------- NAV ---------- */
document.querySelectorAll(".nav-item").forEach(n =>
  n.onclick = () => {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.querySelector(".page-" + n.dataset.page)?.classList.add("active");
  }
);
    
