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
    const match = activePageEl.className.match(/page-([^\s]+)/);
    if (match) pageName = match[1];
  }
  console.log(`[TRACK] ${JSON.stringify({ event: eventName, userId, timestamp: now, page: pageName, meta }, null, 2)}`);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM READY");
  trackEvent("app_loaded");

  const el = {
    // Core elements
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    userIdDisplay: document.getElementById("userIdDisplay"),
    
    // OCR buttons
    quickOCR: document.getElementById("quickOCRBtn"),
    dualOCR: document.getElementById("dualOCRBtn"),
    parse: document.getElementById("parseBtn"),
    
    // UI elements
    saveBtn: document.getElementById("saveBtn"),
    uploadCard: document.getElementById("uploadCard"),
    filenamePill: document.getElementById("filenamePill"),
    filenameText: document.getElementById("filenameText"),
    clearFile: document.getElementById("clearFile"),
    ocrActions: document.getElementById("ocrActions"),
    resultsSection: document.getElementById("resultsSection"),
    recentGrid: document.getElementById("recentGrid"),
    clearRecent: document.getElementById("clearRecent"),
    
    // Parsed page
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),
    verificationBadge: document.getElementById("verificationBadge"),
    badgeSubtitle: document.getElementById("badgeSubtitle"),
    saveHint: document.getElementById("saveHint"),
    itemsSection: document.getElementById("itemsSection"),
    itemsTableBody: document.getElementById("itemsTableBody"),
    itemsCount: document.getElementById("itemsCount"),
    parsedBadge: document.getElementById("parsedBadge"),
    
    // Export
    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),
    copyPreview: document.getElementById("copyPreview"),
    
    // Navigation
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarCloseBtn: document.getElementById("sidebarCloseBtn"),
    loginBtn: document.getElementById("loginBtn"),
    
    // Modal
    loginModal: document.getElementById("loginModal"),
    closeLogin: document.getElementById("closeLogin"),
    
    // History
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    historyCount: document.getElementById("historyCount"),
    
    // Settings
    theme: document.getElementById("themeSelect")
  };

  // Display user ID
  if (el.userIdDisplay) {
    const anonId = localStorage.getItem("anon_user_id") || "—";
    el.userIdDisplay.textContent = `User: ${anonId.slice(0, 8)}...`;
  }

  let db = null;
  let hasParsedData = false;
  let currentFile = null;
  let extractedItems = [];
  let parsedData = null;

  function setStatus(msg, err = false) {
    if (!el.status) return;
    el.status.style.whiteSpace = "pre-wrap";
    el.status.textContent = msg;
    el.status.style.color = err ? "#ef4444" : "#22c55e";
  }

  function updateParsedUI(enabled) {
    const elements = [el.saveBtn, el.exportJSON, el.exportTXT, el.exportCSV, el.editMerchant, el.editDate, el.editTotal];
    elements.forEach(x => {
      if (!x) return;
      x.disabled = !enabled;
      x.style.opacity = enabled ? "1" : "0.5";
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
      
      if (window.innerWidth <= 1024) {
        document.body.classList.add("sidebar-hidden");
      }
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

  // Login modal
  el.loginBtn?.addEventListener("click", () => {
    if (el.loginModal) el.loginModal.hidden = false;
    trackEvent("login_modal_opened");
  });

  el.closeLogin?.addEventListener("click", () => {
    if (el.loginModal) el.loginModal.hidden = true;
  });

  el.loginModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => {
    el.loginModal.hidden = true;
  });

  // Theme handling - updated for new theme names
  const themeInputs = document.querySelectorAll('input[name="theme"]');
  themeInputs.forEach(input => {
    input.addEventListener("change", () => {
      const theme = input.value;
      document.body.classList.forEach(c => {
        if (c.startsWith("theme-")) document.body.classList.remove(c);
      });
      document.body.classList.add("theme-" + theme);
      localStorage.setItem("anj-theme", theme);
      trackEvent("theme_changed", { theme });
    });
  });

  const savedTheme = localStorage.getItem("anj-theme");
  if (savedTheme) {
    const savedInput = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
    if (savedInput) {
      savedInput.checked = true;
      document.body.classList.add("theme-" + savedTheme);
    }
  }

  // File upload
  el.file?.addEventListener("change", () => {
    const file = el.file.files[0];
    if (!file) return;
    
    currentFile = file;
    trackEvent("file_selected", { filename: file.name, type: file.type });

    if (el.filenameText) {
      el.filenameText.textContent = file.name.length > 30 ? file.name.slice(0, 27) + '...' : file.name;
    }
    
    if (el.filenamePill) {
      el.filenamePill.hidden = false;
    }
    
    if (el.uploadCard) {
      el.uploadCard.classList.add("has-file");
    }
    
    if (el.ocrActions) {
      el.ocrActions.hidden = false;
    }
  });

  el.clearFile?.addEventListener("click", () => {
    if (el.file) el.file.value = "";
    currentFile = null;
    
    if (el.filenamePill) el.filenamePill.hidden = true;
    if (el.uploadCard) el.uploadCard.classList.remove("has-file");
    if (el.ocrActions) el.ocrActions.hidden = true;
    if (el.resultsSection) el.resultsSection.hidden = true;
    
    trackEvent("file_cleared");
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
        fullText += lineItems.map(item => item.str).join(" ") + "\n";
      });
      
      return fullText.trim();
    } catch (e) {
      return null;
    }
  }

  async function runTesseract(source, logger) {
    const result = await Tesseract.recognize(source, "eng", {
      logger: m => {
        if (m.status === "recognizing text" && logger) {
          logger(m.progress);
        }
      }
    });
    return result.data.text || "";
  }

  async function quickOCR(file) {
    setStatus("Reading file...");
    await new Promise(r => setTimeout(r, 200));
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
    await new Promise(r => setTimeout(r, 200));
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
    await new Promise(r => setTimeout(r, 300));

    let mergedText = pass1Text;
    if (pass2Text.length > pass1Text.length * 1.2) {
      mergedText = pass2Text;
    } else {
      const lines1 = new Set(pass1Text.split('\n'));
      const lines2 = pass2Text.split('\n');
      const uniqueLines2 = lines2.filter(l => !lines1.has(l));
      mergedText = pass1Text + '\n' + uniqueLines2.join('\n');
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
      el.quickOCR.innerHTML = useDual ? '<span class="btn-icon">⏳</span>Processing...' : '<span class="btn-icon">⚡</span>Quick OCR';
    }
    if (el.dualOCR) {
      el.dualOCR.disabled = true;
      el.dualOCR.innerHTML = useDual ? '<span class="btn-icon">🔍</span>Dual OCR' : '<span class="btn-icon">⏳</span>Processing...';
    }

    if (el.uploadCard) el.uploadCard.classList.add("processing");

    trackEvent(useDual ? "dual_ocr_started" : "quick_ocr_started");

    try {
      const rawText = useDual ? await dualOCR(currentFile) : await quickOCR(currentFile);

      if (el.raw) {
        el.raw.textContent = rawText || "--";
      }

      const cleanedText = normalizeOCRText(rawText);
      if (el.clean) {
        el.clean.textContent = cleanedText || "--";
      }

      extractedItems = extractItems(cleanedText);
      parsedData = parseInvoice(cleanedText);

      if (el.resultsSection) {
        el.resultsSection.hidden = false;
        setTimeout(() => el.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }

      if (el.parse) {
        el.parse.disabled = false;
      }

      addToRecent(currentFile.name);
      updateParsedBadge();
      trackEvent(useDual ? "dual_ocr_completed" : "quick_ocr_completed");
    } catch (error) {
      console.error("OCR failed:", error);
      setStatus("OCR failed: " + error.message, true);
      trackEvent("ocr_failed", { error: error.message });
    } finally {
      if (el.quickOCR) {
        el.quickOCR.disabled = false;
        el.quickOCR.innerHTML = '<span class="btn-icon">⚡</span>Quick OCR';
      }
      if (el.dualOCR) {
        el.dualOCR.disabled = false;
        el.dualOCR.innerHTML = '<span class="btn-icon">🔍</span>Dual OCR';
      }
      if (el.uploadCard) el.uploadCard.classList.remove("processing");
    }
  }

  el.quickOCR?.addEventListener("click", () => processOCR(false));
  el.dualOCR?.addEventListener("click", () => processOCR(true));

  function normalizeOCRText(text) {
    if (!text) return "";
    let lines = text.split('\n');

    lines = lines.map(line => {
      line = line.normalize('NFC');
      
      // Fix common OCR spacing issues
      line = line.replace(/A\s*mo\s*unt/gi, 'Amount');
      line = line.replace(/To\s*tal/gi, 'Total');
      line = line.replace(/Inv\s*o\s*ice/gi, 'Invoice');
      line = line.replace(/Inv\s*No/gi, 'Invoice No');
      line = line.replace(/Add\s*re\s*ss/gi, 'Address');
      line = line.replace(/G\s*S\s*T\s*I\s*N/gi, 'GSTIN');
      line = line.replace(/Da\s*te/gi, 'Date');
      
      // Clean up spacing around punctuation
      line = line.replace(/\s*:\s*/g, ': ');
      line = line.replace(/\s*-\s*/g, ' - ');
      
      // Add space between letters and numbers
      line = line.replace(/([A-Za-z])(\d)/g, '$1 $2');
      line = line.replace(/(\d)([A-Za-z])/g, '$1 $2');
      
      // Normalize whitespace
      line = line.replace(/\s+/g, ' ').trim();
      
      return line;
    });

    // Filter out noise
    lines = lines.filter(line => {
      if (/scanned\s*document/i.test(line)) return false;
      if (/very\s*poor\s*quality/i.test(line)) return false;
      return line.trim().length > 0;
    });

    return lines.join('\n');
  }

  function extractItems(text) {
    const items = [];
    const lines = text.split('\n');
    
    // Pattern: ItemName Qty Rate Amount
    lines.forEach(line => {
      // Try pattern: Name Qty Rate Amount
      let match = line.match(/^(\d*)\s*([A-Za-z\s\.]+?)\s+(\d+)\s+([\d\.]+)\s+([\d\.]+)$/);
      if (match) {
        items.push({
          name: match[2].trim(),
          qty: parseInt(match[3]),
          rate: parseFloat(match[4]),
          amount: parseFloat(match[5])
        });
      } else {
        // Try alternative: Name Qty x Rate = Amount
        match = line.match(/^([A-Za-z\s\.]+?)\s+x\s*(\d+)\s+([\d\.]+)\s+([\d\.]+)$/);
        if (match) {
          items.push({
            name: match[1].trim(),
            qty: parseInt(match[2]),
            rate: parseFloat(match[3]),
            amount: parseFloat(match[4])
          });
        }
      }
    });
    
    return items;
  }

  function parseInvoice(text) {
    const lines = text.split('\n');
    const out = { merchant: "", date: "", total: "" };

    // Find merchant (first substantial line that's not a keyword)
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i].trim();
      if (line.length < 3 || line.length > 40) continue;
      if (/invoice|bill|receipt|gst|tax|date|total|address|phone|email/i.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^[=\-]+$/.test(line)) continue;
      
      out.merchant = line;
      break;
    }

    // Find date
    const dateRegex = /\b(\d{1,2}[-\/\. ]\d{1,2}[-\/\. ]\d{2,4})\b|\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/g;
    const dates = text.match(dateRegex);
    if (dates && dates.length > 0) {
      out.date = dates[0];
    }

    // Find total
    const totalKeywords = ["total", "grand total", "net amount", "payable", "amount due"];
    const numberRegex = /(?:₹|RS\.?|INR)?\s*([\d,]+(?:\.\d{2})?)/gi;
    let candidates = [];
    
    lines.forEach((line, idx) => {
      const lowerLine = line.toLowerCase();
      let hasKeyword = totalKeywords.some(kw => lowerLine.includes(kw));
      
      let match;
      while ((match = numberRegex.exec(line)) !== null) {
        const valStr = match[1].replace(/,/g, '');
        const val = parseFloat(valStr);
        if (isNaN(val) || val <= 0) continue;
        
        let score = 0;
        if (hasKeyword) score += 50;
        if (val < 100000) score += 10;
        if (idx > lines.length * 0.5) score += 20;
        if (line.includes('.')) score += 10;
        
        candidates.push({ value: val, score, str: valStr });
      }
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      out.total = candidates[0].str;
    }

    return out;
  }

  el.parse?.addEventListener("click", () => {
    if (!el.clean || !el.clean.textContent || el.clean.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    const rawText = el.clean.textContent;
    parsedData = parseInvoice(rawText);
    trackEvent("invoice_parsed");

    const verification = verifyInvoiceTotals(parsedData, rawText, extractedItems);

      // Update items table
    if (extractedItems.length > 0 && el.itemsSection && el.itemsTableBody) {
      el.itemsSection.hidden = false;
      if (el.itemsCount) el.itemsCount.textContent = `${extractedItems.length} item${extractedItems.length > 1 ? 's' : ''}`;
      
      el.itemsTableBody.innerHTML = extractedItems.map(item => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td class="numeric">${item.qty}</td>
          <td class="numeric">₹${item.rate.toFixed(2)}</td>
          <td class="numeric">₹${item.amount.toFixed(2)}</td>
        </tr>
      `).join('');
    } else {
      if (el.itemsSection) el.itemsSection.hidden = true;
    }

    // Update verification badge
    if (el.verificationBadge) {
      const diff = verification.differenceAmount;
      let statusClass = "";
      let icon = "";
      let title = "";
      let subtitle = "";

      if (verification.status === "Unverifiable") {
        statusClass = "error";
        icon = "❌";
        title = "Cannot Verify";
        subtitle = "Missing item structure or unclear total";
      } else if (Math.abs(diff) <= 0.01) {
        statusClass = "verified";
        icon = "✓";
        title = "Verified";
        subtitle = `Invoice total matches calculated amount from ${extractedItems.length} line items`;
      } else if (diff > 0) {
        statusClass = "warning";
        icon = "⚠";
        title = "Total Mismatch";
        subtitle = `Invoice total is ₹${diff.toFixed(2)} less than calculated`;
      } else {
        statusClass = "warning";
        icon = "⚠";
        title = "Possible Overcharge";
        subtitle = `You may have been overcharged ₹${Math.abs(diff).toFixed(2)}`;
      }

      el.verificationBadge.className = "verification-badge " + statusClass;
      const badgeIcon = el.verificationBadge.querySelector('.badge-icon');
      const badgeTitle = el.verificationBadge.querySelector('.badge-title');
      
      if (badgeIcon) badgeIcon.textContent = icon;
      if (badgeTitle) badgeTitle.textContent = title;
      if (el.badgeSubtitle) el.badgeSubtitle.textContent = subtitle;
    }

    // Update JSON preview
    if (el.json) {
      el.json.textContent = JSON.stringify({ 
        ...parsedData, 
        items: extractedItems,
        verification: {
          status: verification.status,
          computedTotal: verification.computedTotal,
          declaredTotal: verification.declaredTotal,
          difference: verification.differenceAmount
        }
      }, null, 2);
    }
    
    hasParsedData = true;
    updateParsedUI(true);

    // Navigate to parsed page
    document.querySelector('[data-page="parsed"]')?.click();
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Save to history
  el.saveBtn?.addEventListener("click", () => {
    if (!hasParsedData || !db) return;
    
    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");
    
    store.add({
      merchant: el.editMerchant?.value || "",
      date: el.editDate?.value || "",
      total: el.editTotal?.value || "",
      items: extractedItems,
      timestamp: Date.now()
    });
    
    tx.oncomplete = () => {
      trackEvent("history_saved");
      if (el.saveHint) {
        el.saveHint.textContent = "✓ Saved successfully";
        setTimeout(() => el.saveHint.textContent = "", 2000);
      }
      loadHistory();
      updateParsedBadge();
    };
  });

  // Copy preview
  el.copyPreview?.addEventListener("click", () => {
    if (el.json) {
      navigator.clipboard.writeText(el.json.textContent).then(() => {
        const originalText = el.copyPreview.textContent;
        el.copyPreview.textContent = "Copied!";
        setTimeout(() => el.copyPreview.textContent = originalText, 1500);
      });
    }
  });

  // Recent files
  const MAX_RECENT = 4;
  const RECENT_KEY = 'anj_recent_v2';

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
    
    if (items.length === 0) {
      el.recentGrid.innerHTML = `
        <div class="recent-empty">
          <div class="empty-icon">📂</div>
          <p>No recent invoices</p>
          <span>Upload your first document to get started</span>
        </div>
      `;
      return;
    }
    
    el.recentGrid.innerHTML = items.map(item => `
      <div class="recent-card" data-file="${escapeHtml(item.fullName)}">
        <div class="recent-icon">📄</div>
        <div class="recent-name">${escapeHtml(item.name)}</div>
        <div class="recent-time">${escapeHtml(item.time)}</div>
      </div>
    `).join('');
  }

  function addToRecent(filename) {
    const items = loadRecent();
    const newItem = {
      name: filename.length > 25 ? filename.slice(0, 22) + '...' : filename,
      fullName: filename,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    const filtered = items.filter(i => i.fullName !== filename);
    saveRecent([newItem, ...filtered]);
    renderRecent();
  }

  el.clearRecent?.addEventListener("click", () => {
    localStorage.removeItem(RECENT_KEY);
    renderRecent();
    trackEvent("recent_cleared");
  });

  renderRecent();

  // IndexedDB History
  function initDB() {
    const req = indexedDB.open("anj-dual-ocr-v2", 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("history")) {
        db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      loadHistory();
    };
  }

  function loadHistory() {
    if (!db || !el.historyPageList) return;
    
    el.historyPageList.innerHTML = '';
    let count = 0;
    
    const tx = db.transaction("history", "readonly");
    const store = tx.objectStore("history");
    
    store.openCursor(null, "prev").onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) {
        if (el.historyCount) el.historyCount.textContent = count;
        if (count === 0) {
          el.historyPageList.innerHTML = `
            <li class="history-empty">
              <div class="empty-icon">📭</div>
              <p>No saved invoices yet</p>
              <span>Parsed invoices will appear here</span>
            </li>
          `;
        }
        return;
      }
      
      count++;
      const item = cursor.value;
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <div class="history-icon">📄</div>
        <div class="history-info">
          <div class="history-name">${escapeHtml(item.merchant || "Unknown")}</div>
          <div class="history-date">${new Date(item.timestamp).toLocaleString()}</div>
        </div>
        <div class="history-amount">₹${escapeHtml(item.total || "--")}</div>
      `;
      
      li.addEventListener("click", () => {
        if (el.editMerchant) el.editMerchant.value = item.merchant || "";
        if (el.editDate) el.editDate.value = item.date || "";
        if (el.editTotal) el.editTotal.value = item.total || "";
        
        if (item.items && el.itemsSection && el.itemsTableBody) {
          extractedItems = item.items;
          el.itemsSection.hidden = false;
          if (el.itemsCount) el.itemsCount.textContent = `${item.items.length} item${item.items.length > 1 ? 's' : ''}`;
          el.itemsTableBody.innerHTML = item.items.map(i => `
            <tr>
              <td>${escapeHtml(i.name)}</td>
              <td class="numeric">${i.qty}</td>
              <td class="numeric">₹${i.rate.toFixed(2)}</td>
              <td class="numeric">₹${i.amount.toFixed(2)}</td>
            </tr>
          `).join('');
        }
        
        hasParsedData = true;
        updateParsedUI(true);
        document.querySelector('[data-page="parsed"]')?.click();
      });
      
      el.historyPageList.appendChild(li);
      cursor.continue();
    };
  }

  function updateParsedBadge() {
    if (!db || !el.parsedBadge) return;
    
    const tx = db.transaction("history", "readonly");
    const store = tx.objectStore("history");
    const countReq = store.count();
    
    countReq.onsuccess = () => {
      const count = countReq.result;
      el.parsedBadge.textContent = count;
      el.parsedBadge.style.display = count > 0 ? 'block' : 'none';
    };
  }

  el.clearHistoryBtn?.addEventListener("click", () => {
    if (!confirm("Clear all saved history? This cannot be undone.")) return;
    
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    
    tx.oncomplete = () => {
      loadHistory();
      updateParsedBadge();
      trackEvent("history_cleared");
    };
  });

  el.historySearch?.addEventListener("input", e => {
    const term = e.target.value.toLowerCase();
    const items = el.historyPageList?.querySelectorAll('.history-item');
    
    items?.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(term) ? '' : 'none';
    });
  });

  // Export handlers
  [el.exportJSON, el.exportTXT, el.exportCSV].forEach(btn => {
    btn?.addEventListener("click", (e) => {
      const type = e.currentTarget.id.replace('export', '').toLowerCase();
      trackEvent(`export_attempted_${type}`);
      setStatus("Export is a premium feature", true);
    });
  });

  initDB();
  setStatus("Ready ✓");
});
And finally the invoiceVerification.js (unchanged but included for completeness):
JavaScript
Copy
export function verifyInvoiceTotals(parsed, rawText, items = []) {
  const result = {
    status: "Unverifiable",
    computedTotal: 0,
    declaredTotal: parseFloat(parsed.total) || 0,
    differenceAmount: 0,
    itemCount: items.length
  };

  // If we have items, calculate from them
  if (items.length > 0) {
    result.computedTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  } else {
    // Try to extract from text patterns
    const amountMatches = rawText.match(/(\d+\.\d{2})/g) || [];
    const amounts = amountMatches.map(a => parseFloat(a)).filter(a => a > 0);
    
    // Use largest amount as likely total, or sum of line items if we can identify them
    if (amounts.length > 0) {
      // Sort descending
      amounts.sort((a, b) => b - a);
      // If declared total matches one of the amounts, use second largest as computed
      const declaredIndex = amounts.indexOf(result.declaredTotal);
      if (declaredIndex > -1 && amounts.length > 1) {
        // Sum all except the declared total (assuming it's the final total)
        result.computedTotal = amounts.slice(1).reduce((a, b) => a + b, 0);
      } else {
        // Can't determine, use largest as computed
        result.computedTotal = amounts[0];
      }
    }
  }

  result.differenceAmount = result.computedTotal - result.declaredTotal;
  
  if (items.length > 0) {
    result.status = Math.abs(result.differenceAmount) <= 0.01 ? "Verified" : "Mismatch";
  } else if (result.computedTotal > 0) {
    result.status = Math.abs(result.differenceAmount) <= 0.01 ? "Verified" : "Partial";
  }

  return result;
}
