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
    saveBtn: document.getElementById("saveBtn"),

    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),

    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV")
  };

  function setStatus(msg, err = false) {
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  /* ---------- OCR ---------- */

  async function runOCR(file) {
    setStatus("OCR running...");
    const res = await Tesseract.recognize(file, "eng");
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
    const out = { merchant: "", date: "", total: "" };

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

    const file = el.file.files[0];
    let text = "";

    if (file.type.startsWith("image/") && useOCR) {
      text = await runOCR(file);
    } else {
      text = await extractText(file);
    }

    text = cleanText(text);
    const parsed = parseInvoice(text);

    window._lastParsed = parsed;

    el.raw.textContent = text;
    el.clean.textContent = text;
    el.json.textContent = JSON.stringify(parsed, null, 2);

    el.editMerchant.value = parsed.merchant;
    el.editDate.value = parsed.date;
    el.editTotal.value = parsed.total;

    setStatus("Done ✓");
  }

  el.dual.onclick = () => processFile(true);
  el.ocr.onclick = () => processFile(true);

  el.parse.onclick = () => {
    if (!el.clean.textContent) return;

    const parsed = parseInvoice(el.clean.textContent);
    window._lastParsed = parsed;

    el.json.textContent = JSON.stringify(parsed, null, 2);
    el.editMerchant.value = parsed.merchant;
    el.editDate.value = parsed.date;
    el.editTotal.value = parsed.total;

    setStatus("Parsed ✓");
  };

  /* ---------- EXPORT SYSTEM ---------- */

  function getExportData() {
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
    const data = getExportData();
    if (!data) return setStatus("Nothing to export", true);
    downloadFile("invoice.json", JSON.stringify(data, null, 2), "application/json");
    setStatus("JSON exported ✓");
  };

  el.exportTXT.onclick = () => {
    const data = getExportData();
    if (!data) return setStatus("Nothing to export", true);
    downloadFile(
      "invoice.txt",
      `Merchant: ${data.merchant}\nDate: ${data.date}\nTotal: ${data.total}`,
      "text/plain"
    );
    setStatus("TXT exported ✓");
  };

  el.exportCSV.onclick = () => {
    const data = getExportData();
    if (!data) return setStatus("Nothing to export", true);
    downloadFile(
      "invoice.csv",
      `Merchant,Date,Total\n"${data.merchant}","${data.date}","${data.total}"`,
      "text/csv"
    );
    setStatus("CSV exported ✓");
  };

  /* ---------- SIDEBAR ---------- */

  document.getElementById("sidebarToggle").onclick = () => {
    document.body.classList.toggle("sidebar-hidden");
  };

  setStatus("Ready ✓");
});
        
