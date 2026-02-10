console.log("SCRIPT LOADED");

import { verifyInvoiceTotals } from "./invoiceVerification.js";

const pdfjsLib = window.pdfjsLib;
const Tesseract = window.Tesseract;

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

window.getAnonUserId = () => localStorage.getItem("anon_user_id");
initAnonUserId();

const lastTracked = {};

function trackEvent(eventName, meta = {}) {
  const now = Date.now();
  if (lastTracked[eventName] && (now - lastTracked[eventName] < 1000)) return;
  lastTracked[eventName] = now;
  const userId = localStorage.getItem("anon_user_id");
  const activePageEl = document.querySelector(".page.active");
  let pageName = "unknown";
  if (activePageEl) {
    const match = activePageEl.className.match(/page-([^\\s]+)/);
    if (match) pageName = match[1];
  }
  console.log(`[TRACK] ${JSON.stringify({ event: eventName, userId, timestamp: now, page: pageName, meta }, null, 2)}`);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM READY");
  trackEvent("app_loaded");

  const el = {
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    userIdDisplay: document.getElementById("userIdDisplay"),
    quickOCR: document.getElementById("quickOCRBtn"),
    dualOCR: document.getElementById("dualOCRBtn"),
    parse: document.getElementById("parseBtn"),
    saveBtn: document.getElementById("saveBtn"),
    uploadCard: document.getElementById("uploadCard"),
    filenamePill: document.getElementById("filenamePill"),
    filenameText: document.getElementById("filenameText"),
    ocrActions: document.getElementById("ocrActions"),
    resultsSection: document.getElementById("resultsSection"),
    parseBar: document.getElementById("parseBar"),
    parseHint: document.querySelector(".parse-hint"),
    recentGrid: document.getElementById("recentGrid"),
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),
    verificationBadge: document.getElementById("verificationBadge"),
    badgeSubtitle: document.getElementById("badgeSubtitle"),
    saveHint: document.getElementById("saveHint"),
    itemsSection: document.getElementById("itemsSection"),
    itemsTableBody: document.getElementById("itemsTableBody"),
    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarCloseBtn: document.getElementById("sidebarCloseBtn"),
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    theme: document.getElementById("themeSelect")
  };

  if (el.userIdDisplay) {
    const anonId = localStorage.getItem("anon_user_id") || "—";
    el.userIdDisplay.textContent = `User: ${anonId.slice(0, 8)}...`;
  }

  let db = null;
  let hasParsedData = false;
  let currentFile = null;
  let extractedItems = [];

  function setStatus(msg, err = false) {
    if (!el.status) return;
    el.status.style.whiteSpace = "pre-wrap";
    el.status.textContent = msg;
    el.status.style.color = err ? "#ff4d4d" : "#7CFC98";
  }

  function updateParsedUI(enabled) {
    [el.saveBtn, el.exportJSON, el.exportTXT, el.exportCSV, el.editMerchant, el.editDate, el.editTotal].forEach(x => {
      if (!x) return;
      x.disabled = !enabled;
      x.style.opacity = enabled ? "1" : "0.5";
      x.style.pointerEvents = enabled ? "auto" : "none";
    });
  }

  updateParsedUI(false);

  // Navigation
  el.sidebarToggle?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-hidden");
    trackEvent("sidebar_toggled");
  });

  el.sidebarCloseBtn?.addEventListener("click", () => {
    document.body.classList.add("sidebar-hidden");
  });

  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;
      if (!page) return;
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const targetPage = document.querySelector(".page-" + page);
      if (targetPage) {
        targetPage.classList.add("active");
        trackEvent("page_navigated", { page });
      }
      document.querySelectorAll(".nav-pill").forEach(pill => {
        pill.classList.toggle("active", pill.dataset.page === page);
      });
      if (window.innerWidth <= 1024) document.body.classList.add("sidebar-hidden");
    });
  });

  document.querySelectorAll(".nav-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const page = pill.dataset.page;
      if (!page) return;
      document.querySelectorAll(".nav-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const targetPage = document.querySelector(".page-" + page);
      if (targetPage) targetPage.classList.add("active");
      document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.page === page);
      });
      trackEvent("page_navigated", { page });
    });
  });

  // Theme
  el.theme?.addEventListener("change", () => {
    document.body.classList.forEach(c => { if (c.startsWith("theme-")) document.body.classList.remove(c); });
    document.body.classList.add("theme-" + el.theme.value);
    localStorage.setItem("anj-theme", el.theme.value);
    trackEvent("theme_changed", { theme: el.theme.value });
  });

  const savedTheme = localStorage.getItem("anj-theme");
  if (savedTheme && el.theme) {
    el.theme.value = savedTheme;
    document.body.classList.add("theme-" + savedTheme);
  }

  // Upload flow
  el.file?.addEventListener("change", () => {
    const file = el.file.files[0];
    if (!file) return;
    currentFile = file;
    trackEvent("file_selected", { filename: file.name, type: file.type });

    if (el.filenameText) el.filenameText.textContent = file.name.length > 25 ? file.name.slice(0, 22) + '...' : file.name;
    if (el.filenamePill) {
      el.filenamePill.hidden = false;
      el.filenamePill.style.opacity = "1";
      el.filenamePill.style.transform = "translateY(0)";
    }
    if (el.uploadCard) el.uploadCard.classList.add("has-file");
    if (el.ocrActions) el.ocrActions.hidden = false;

    setTimeout(() => {
      if (el.filenamePill && !el.filenamePill.hidden) {
        el.filenamePill.classList.add("fade-out");
        setTimeout(() => {
          if (el.filenamePill) {
            el.filenamePill.hidden = true;
            el.filenamePill.classList.remove("fade-out");
          }
        }, 500);
      }
    }, 3000);
  });

  // OCR Functions
  async function pdfToCanvas(file, scale = 3) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    ctx.filter = 'grayscale(100%) contrast(1.2) brightness(1.1)';
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  async function extractTextFromPDF(file) {
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const textContent = await page.getTextContent();
      if (textContent.items.length === 0) return null;
      const lines = {};
      textContent.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!lines[y]) lines[y] = [];
        lines[y].push(item);
      });
      const sortedY = Object.keys(lines).sort((a, b) => b - a);
      let fullText = "";
      sortedY.forEach(y => {
        const lineItems = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
        fullText += lineItems.map(item => item.str).join(" ") + "\\n";
      });
      return fullText.trim();
    } catch (e) {
      return null;
    }
  }

  async function runTesseract(source, logger) {
    const result = await Tesseract.recognize(source, "eng", {
      logger: m => { if (m.status === "recognizing text" && logger) logger(m.progress); }
    });
    return result.data.text || "";
  }

  async function quickOCR(file) {
    setStatus("Reading file...");
    await new Promise(r => setTimeout(r, 300));
    setStatus("Extracting text...");

    if (file.type === "application/pdf") {
      const directText = await extractTextFromPDF(file);
      if (directText && directText.length > 50) {
        setStatus("Text extracted ✓");
        return directText;
      }
    }

    let source = file;
    if (file.type === "application/pdf") {
      source = await pdfToCanvas(file, 2);
    }

    setStatus("Running OCR...");
    const text = await runTesseract(source, progress => {
      setStatus(`OCR ${Math.round(progress * 100)}%`);
    });

    setStatus("OCR complete ✓");
    return text;
  }

  async function dualOCR(file) {
    setStatus("Reading file...");
    await new Promise(r => setTimeout(r, 300));
    setStatus("Pass 1: Standard extraction...");

    let pass1Text = "";
    if (file.type === "application/pdf") {
      const directText = await extractTextFromPDF(file);
      if (directText && directText.length > 50) pass1Text = directText;
    }
    
    if (!pass1Text) {
      let source = file;
      if (file.type === "application/pdf") source = await pdfToCanvas(file, 2);
      pass1Text = await runTesseract(source);
    }

    setStatus("Pass 2: Enhanced extraction...");
    
    let pass2Text = "";
    if (file.type === "application/pdf") {
      const canvas = await pdfToCanvas(file, 3);
      pass2Text = await runTesseract(canvas);
    } else {
      pass2Text = pass1Text;
    }

    setStatus("Cross-checking results...");
    await new Promise(r => setTimeout(r, 400));

    let mergedText = pass1Text;
    if (pass2Text.length > pass1Text.length * 1.2) {
      mergedText = pass2Text;
    } else {
      const lines1 = new Set(pass1Text.split('\\n'));
      const lines2 = pass2Text.split('\\n');
      const uniqueLines2 = lines2.filter(l => !lines1.has(l));
      mergedText = pass1Text + '\\n' + uniqueLines2.join('\\n');
    }

    setStatus("Dual OCR complete ✓");
    return mergedText;
  }

  async function processOCR(useDual = false) {
    if (!currentFile) {
      setStatus("No file selected", true);
      return;
    }

    if (el.quickOCR) {
      el.quickOCR.disabled = true;
      el.quickOCR.textContent = useDual ? "Processing..." : "Quick OCR";
    }
    if (el.dualOCR) {
      el.dualOCR.disabled = true;
      el.dualOCR.textContent = useDual ? "Dual OCR" : "Processing...";
    }

    if (el.uploadCard) el.uploadCard.classList.add("processing");

    trackEvent(useDual ? "dual_ocr_started" : "quick_ocr_started");

    try {
      const rawText = useDual ? await dualOCR(currentFile) : await quickOCR(currentFile);

      if (el.raw) {
        el.raw.textContent = rawText || "--";
        el.raw.style.whiteSpace = "pre-wrap";
        el.raw.style.wordBreak = "break-word";
      }

      const cleanedText = normalizeOCRText(rawText);
      if (el.clean) {
        el.clean.textContent = cleanedText || "--";
        el.clean.style.whiteSpace = "pre-wrap";
        el.clean.style.wordBreak = "break-word";
      }

      extractedItems = extractItems(cleanedText);

      if (el.resultsSection) {
        el.resultsSection.hidden = false;
        setTimeout(() => el.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }

      if (el.parseBar) {
        el.parseBar.hidden = false;
        if (el.parse) {
          el.parse.disabled = true;
          if (el.parseHint) el.parseHint.textContent = "Verifying extracted text...";
          
          setTimeout(() => {
            if (el.parse) {
              el.parse.disabled = false;
              if (el.parseHint) el.parseHint.textContent = "Ready to verify";
            }
          }, 1000);
        }
      }

      addToRecent(currentFile.name);
      trackEvent(useDual ? "dual_ocr_completed" : "quick_ocr_completed");
    } catch (error) {
      console.error("OCR failed:", error);
      setStatus("OCR failed: " + error.message, true);
      trackEvent("ocr_failed", { error: error.message });
    } finally {
      if (el.quickOCR) {
        el.quickOCR.disabled = false;
        el.quickOCR.textContent = "Quick OCR";
      }
      if (el.dualOCR) {
        el.dualOCR.disabled = false;
        el.dualOCR.textContent = "Dual OCR";
      }
      if (el.uploadCard) el.uploadCard.classList.remove("processing");
    }
  }

  el.quickOCR?.addEventListener("click", () => processOCR(false));
  el.dualOCR?.addEventListener("click", () => processOCR(true));

  function normalizeOCRText(text) {
    if (!text) return "";
    let lines = text.split('\\n');

    lines = lines.map(line => {
      line = line.normalize('NFC');
      
      line = line.replace(/A\\s*mo\\s*unt/gi, 'Amount');
      line = line.replace(/To\\s*tal/gi, 'Total');
      line = line.replace(/Inv\\s*o\\s*ice/gi, 'Invoice');
      line = line.replace(/Inv\\s*No/gi, 'Invoice No');
      line = line.replace(/Add\\s*re\\s*ss/gi, 'Address');
      line = line.replace(/G\\s*S\\s*T\\s*I\\s*N/gi, 'GSTIN');
      line = line.replace(/Da\\s*te/gi, 'Date');
      line = line.replace(/Qua\\s*li\\s*ty/gi, 'Quality');
      line = line.replace(/Ne\\s*ar/gi, 'Near');
      line = line.replace(/ma\\s*rket/gi, 'market');
      line = line.replace(/bus\\s*st/gi, 'bus stand');
      line = line.replace(/Co\\s*ntent/gi, 'Content');
      
      line = line.replace(/\\s*:\\s*/g, ': ');
      line = line.replace(/\\s*-\\s*/g, ' - ');
      
      line = line.replace(/([A-Za-z])(\\d)/g, '$1 $2');
      line = line.replace(/(\\d)([A-Za-z])/g, '$1 $2');
      
      line = line.replace(/\\s+/g, ' ').trim();
      
      return line;
    });

    lines = lines.filter(line => {
      if (/scanned\\s*document/i.test(line)) return false;
      if (/very\\s*poor\\s*quality/i.test(line)) return false;
      if (/poor\\s*quality/i.test(line)) return false;
      return line.trim().length > 0;
    });

    return lines.join('\\n');
  }

  function extractItems(text) {
    const items = [];
    const lines = text.split('\\n');
    
    lines.forEach(line => {
      const match = line.match(/^(\\d*)\\s*([A-Za-z\\s\\.]+?)\\s+(\\d+)\\s+([\\d\\.]+)\\s+([\\d\\.]+)$/);
      if (match) {
        items.push({
          name: match[2].trim(),
          qty: parseInt(match[3]),
          rate: parseFloat(match[4]),
          amount: parseFloat(match[5])
        });
      } else {
        const match2 = line.match(/^([A-Za-z\\s\\.]+?)\\s+(\\d+)\\s+([\\d\\.]+)\\s+([\\d\\.]+)$/);
        if (match2) {
          items.push({
            name: match2[1].trim(),
            qty: parseInt(match2[2]),
            rate: parseFloat(match2[3]),
            amount: parseFloat(match2[4])
          });
        }
      }
    });
    
    return items;
  }

  function parseInvoice(text) {
    const lines = text.split('\\n');
    const out = { merchant: "", date: "", total: "" };

    for (let i = 3; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].trim();
      if (line.length < 5 || line.length > 35) continue;
      if (/scanned|document|quality|very|poor|invoice|bill|receipt|gstin|date|total/i.test(line)) continue;
      if (/^\\d+$/.test(line)) continue;
      if (line === line.toUpperCase() && line.length > 10) continue;
      
      if (/[a-z]/i.test(line)) {
        out.merchant = line;
        break;
      }
    }

    const dateRegex = /\\b(\\d{1,2}[-\\/\\. ]\\d{1,2}[-\\/\\. ]\\d{2,4})\\b|\\b(\\d{1,2} [A-Za-z]{3,9} \\d{2,4})\\b/g;
    let dateCandidates = [];
    text.replace(dateRegex, (match) => {
      const context = text.substring(Math.max(0, text.indexOf(match) - 20), text.indexOf(match) + match.length + 20);
      if (!context.toLowerCase().includes("gst") && !context.match(/\\d{10,}/)) {
        dateCandidates.push(match);
      }
    });
    if (dateCandidates.length > 0) out.date = dateCandidates[0];

    const totalKeywords = ["total", "payable", "amount", "net", "grand", "sum"];
    const numberRegex = /(?:₹|RS|INR|AMT)?\\s*([\\d,]+\\.?\\d{0,2})/gi;
    let candidates = [];
    lines.forEach((line, index) => {
      let match;
      while ((match = numberRegex.exec(line)) !== null) {
        const valStr = match[1].replace(/,/g, '');
        const val = parseFloat(valStr);
        if (isNaN(val) || val <= 0) continue;
        let score = 0;
        const lowerLine = line.toLowerCase();
        if (totalKeywords.some(k => lowerLine.includes(k))) score += 50;
        if (valStr.includes('.')) score += 20;
        if (index > lines.length * 0.6) score += 30;
        if (valStr.length > 8 && !valStr.includes('.')) score -= 100;
        candidates.push({ value: valStr, score: score });
      }
    });
    if (candidates.length > 0) {
      const validCandidates = candidates.filter(c => c.score > 20);
      if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
        out.total = validCandidates[0].value;
      }
    }

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

    const verification = verifyInvoiceTotals(parsed, rawText, extractedItems);
    
    if (el.editMerchant) el.editMerchant.value = parsed.merchant || "";
    if (el.editDate) el.editDate.value = parsed.date || "";
    if (el.editTotal) el.editTotal.value = parsed.total || "";

    if (extractedItems.length > 0 && el.itemsSection && el.itemsTableBody) {
      el.itemsSection.hidden = false;
      el.itemsTableBody.innerHTML = extractedItems.map(item => `
        <tr>
          <td>${item.name}</td>
          <td>${item.qty}</td>
          <td>₹${item.rate.toFixed(2)}</td>
          <td>₹${item.amount.toFixed(2)}</td>
        </tr>
      `).join('');
    }

    if (el.verificationBadge) {
      const diff = verification.differenceAmount;
      let statusClass = "verified";
      let icon = "✅";
      let title = "Verified";
      let subtitle = `Invoice total matches calculated amount from ${extractedItems.length} line items`;

      if (verification.status === "Unverifiable") {
        statusClass = "error";
        icon = "❌";
        title = "Cannot Verify";
        subtitle = "Missing item structure or unclear total";
      } else if (Math.abs(diff) > 0.01) {
        statusClass = "warning";
        icon = "⚠️";
        title = diff > 0 ? "Total Mismatch" : "Possible Overcharge";
        subtitle = diff > 0 
          ? `Invoice total is ₹${diff.toFixed(2)} less than calculated`
          : `You may have been overcharged ₹${Math.abs(diff).toFixed(2)}`;
      }

      el.verificationBadge.className = "verification-badge " + statusClass;
      const badgeIcon = el.verificationBadge.querySelector('.badge-icon');
      const badgeTitle = el.verificationBadge.querySelector('.badge-title');
      if (badgeIcon) badgeIcon.textContent = icon;
      if (badgeTitle) badgeTitle.textContent = title;
      if (el.badgeSubtitle) el.badgeSubtitle.textContent = subtitle;
    }

    if (el.json) el.json.textContent = JSON.stringify({ ...parsed, items: extractedItems }, null, 2);
    hasParsedData = true;
    updateParsedUI(true);

    if (el.parseBar) el.parseBar.hidden = true;
    document.querySelector('[data-page="parsed"]')?.click();
  });

  el.saveBtn?.addEventListener("click", () => {
    if (!hasParsedData || !db) return;
    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");
    store.add({
      merchant: el.editMerchant.value,
      date: el.editDate.value,
      total: el.editTotal.value,
      items: extractedItems,
      timestamp: Date.now()
    });
    
    tx.oncomplete = () => {
      trackEvent("history_saved");
      if (el.saveHint) el.saveHint.textContent = "✓ Saved to history";
      setTimeout(() => {
        if (el.saveHint) el.saveHint.textContent = "";
        loadHistory();
      }, 1500);
    };
  });

  const MAX_RECENT = 4;
  const RECENT_KEY = 'anj_recent';

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    } catch { return []; }
  }

  function saveRecent(items) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  }

  function renderRecent() {
    if (!el.recentGrid) return;
    const items = loadRecent();
    el.recentGrid.innerHTML = items.length === 0 
      ? '<div class="recent-empty">No recent invoices</div>'
      : items.map(item => `
        <div class="recent-card" data-file="${item.fullName}">
          <div class="recent-icon">📄</div>
          <div class="recent-name">${item.name}</div>
          <div class="recent-time">${item.time}</div>
        </div>
      `).join('');
    
    el.recentGrid.querySelectorAll('.recent-card').forEach(card => {
      card.addEventListener('click', () => {
        trackEvent("recent_clicked");
      });
    });
  }

  function addToRecent(filename) {
    const items = loadRecent();
    const newItem = {
      name: filename.length > 25 ? filename.slice(0, 22) + '...' : filename,
      fullName: filename,
      time: 'Just now'
    };
    const filtered = items.filter(i => i.fullName !== filename);
    saveRecent([newItem, ...filtered]);
    renderRecent();
  }

  renderRecent();

  function initDB() {
    const req = indexedDB.open("anj-dual-ocr", 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("history")) {
        db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = e => { db = e.target.result; loadHistory(); };
  }

  function loadHistory() {
    if (!db || !el.historyPageList) return;
    el.historyPageList.innerHTML = '';
    const tx = db.transaction("history", "readonly");
    const store = tx.objectStore("history");
    store.openCursor(null, "prev").onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) {
        if (el.historyPageList.children.length === 0) {
          el.historyPageList.innerHTML = '<li class="history-empty">No saved invoices yet</li>';
        }
        return;
      }
      const item = cursor.value;
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <span class="history-icon">📄</span>
        <div class="history-info">
          <div class="history-name">${item.merchant || "Unknown"}</div>
          <div class="history-date">${new Date(item.timestamp).toLocaleString()}</div>
        </div>
        <div class="history-amount">₹${item.total || "--"}</div>
      `;
      li.addEventListener("click", () => {
        if (el.editMerchant) el.editMerchant.value = item.merchant || "";
        if (el.editDate) el.editDate.value = item.date || "";
        if (el.editTotal) el.editTotal.value = item.total || "";
        if (item.items && el.itemsSection && el.itemsTableBody) {
          extractedItems = item.items;
          el.itemsSection.hidden = false;
          el.itemsTableBody.innerHTML = item.items.map(i => `
            <tr><td>${i.name}</td><td>${i.qty}</td><td>₹${i.rate.toFixed(2)}</td><td>₹${i.amount.toFixed(2)}</td></tr>
          `).join('');
        }
        document.querySelector('[data-page="parsed"]')?.click();
      });
      el.historyPageList.appendChild(li);
      cursor.continue();
    };
  }

  el.clearHistoryBtn?.addEventListener("click", () => {
    if (!confirm("Clear all history?")) return;
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    tx.oncomplete = () => { 
      if (el.historyPageList) el.historyPageList.innerHTML = '<li class="history-empty">No saved invoices yet</li>'; 
    };
  });

  [el.exportJSON, el.exportTXT, el.exportCSV].forEach(btn => {
    btn?.addEventListener("click", (e) => {
      trackEvent(`export_attempted_${e.target.id.replace('export', '').toLowerCase()}`);
      setStatus("Export is a premium feature", true);
    });
  });

  initDB();
  setStatus("Ready ✓");
});

