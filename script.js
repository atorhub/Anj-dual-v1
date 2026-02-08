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

window.getAnonUserId = () => localStorage.getItem("anon_user_id");
initAnonUserId();

/* =======================
   EVENT TRACKING
======================= */
const lastTracked = {};

function trackEvent(eventName, meta = {}) {
  const now = Date.now();
  if (lastTracked[eventName] && (now - lastTracked[eventName] < 1000)) {
    return;
  }
  lastTracked[eventName] = now;

  const userId = localStorage.getItem("anon_user_id");
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
    // Core
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    userIdDisplay: document.getElementById("userIdDisplay"),

    // Buttons
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),
    saveBtn: document.getElementById("saveBtn"),

    // NEW: UI Flow elements
    uploadCard: document.getElementById("uploadCard"),
    filenamePill: document.getElementById("filenamePill"),
    filenameText: document.getElementById("filenameText"),
    ocrActions: document.getElementById("ocrActions"),
    resultsSection: document.getElementById("resultsSection"),
    parseBar: document.getElementById("parseBar"),
    recentGrid: document.getElementById("recentGrid"),

    // Parsed page
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),
    verificationBadge: document.getElementById("verificationBadge"),

    // Export
    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),

    // Nav
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarCloseBtn: document.getElementById("sidebarCloseBtn"),

    // History
    historyList: document.getElementById("historyList"),
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),

    // Settings
    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect")
  };

  // Display user ID
  if (el.userIdDisplay) {
    const anonId = localStorage.getItem("anon_user_id") || "—";
    el.userIdDisplay.textContent = `User: ${anonId.slice(0, 8)}...`;
  }

  /* =======================
     STATE
  ======================= */
  let db = null;
  let hasParsedData = false;
  let selectedHistoryItem = null;
  let currentParsedData = null;
  let lastSavedId = null;
  let currentFile = null;

  /* =======================
     STATUS & UI HELPERS
  ======================= */
  function setStatus(msg, err = false) {
    if (!el.status) return;
    el.status.style.whiteSpace = "pre-wrap";
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
     SIDEBAR & NAVIGATION
  ======================= */
  el.sidebarToggle?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-hidden");
    trackEvent("sidebar_toggled");
  });

  el.sidebarCloseBtn?.addEventListener("click", () => {
    document.body.classList.add("sidebar-hidden");
  });

  // Sidebar nav
  document.querySelectorAll(".sidebar-nav .nav-item, .sidebar-footer .nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;
      if (!page) return;

      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");

      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const targetPage = document.querySelector(".page-" + page);
      if (targetPage) {
        targetPage.classList.add("active");
        trackEvent("page_navigated", { page: page });
      }

      document.querySelectorAll(".nav-pill").forEach(pill => {
        pill.classList.toggle("active", pill.dataset.page === page);
      });

      if (window.innerWidth <= 1024) {
        document.body.classList.add("sidebar-hidden");
      }
    });
  });

  // Topbar pills
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

      trackEvent("page_navigated", { page: page });
    });
  });

  /* =======================
     THEMES & LAYOUTS
  ======================= */
  if (el.theme) {
    const themeOptions = [
      { value: "carbon", text: "Carbon Black (Default)" },
      { value: "aqua-pro", text: "Aqua Pro" },
      { value: "slate", text: "Slate Grey" },
      { value: "midnight-blue", text: "Midnight Blue" },
      { value: "ivory", text: "Ivory Light" },
      { value: "soft-teal", text: "Soft Teal" },
      { value: "monochrome", text: "Monochrome" },
      { value: "high-contrast", text: "High Contrast" },
      { value: "abstract", text: "Abstract Flow" },
      { value: "bloom", text: "Quiet Bloom" }
    ];
    
    el.theme.innerHTML = themeOptions.map(opt => 
      `<option value="${opt.value}">${opt.text}</option>`
    ).join('');
  }

  el.theme?.addEventListener("change", () => {
    document.body.classList.forEach(c => {
      if (c.startsWith("theme-")) document.body.classList.remove(c);
    });
    document.body.classList.add("theme-" + el.theme.value);
    localStorage.setItem("anj-theme", el.theme.value);
    trackEvent("theme_changed", { theme: el.theme.value });
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
     UPLOAD UI FLOW
  ======================= */

  // File selected - show filename and OCR buttons
  el.file?.addEventListener("change", () => {
    const file = el.file.files[0];
    if (!file) return;
    
    currentFile = file;
    trackEvent("file_selected", { filename: file.name, type: file.type });

    // Show filename pill
    if (el.filenameText) {
      el.filenameText.textContent = file.name.length > 25 ? file.name.slice(0, 22) + '...' : file.name;
    }
    if (el.filenamePill) {
      el.filenamePill.hidden = false;
      el.filenamePill.style.opacity = "1";
      el.filenamePill.style.transform = "translateY(0)";
    }
    
    // Visual feedback on card
    if (el.uploadCard) el.uploadCard.classList.add("has-file");
    
    // Show OCR buttons
    if (el.ocrActions) el.ocrActions.hidden = false;
    
    // Hide results if they were showing from previous file
    if (el.resultsSection) el.resultsSection.hidden = true;
    if (el.parseBar) el.parseBar.hidden = true;

    // Fade out filename after 3 seconds
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

  /* =======================
     PDF & OCR
  ======================= */
  async function pdfToCanvas(file) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    ctx.filter = 'grayscale(100%) contrast(1.2) brightness(1.1)';
    
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  async function extractTextFromPDF(file) {
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
  }

  async function runOCR(file) {
    setStatus("Extraction starting...");

    if (file.type === "application/pdf") {
      try {
        const directText = await extractTextFromPDF(file);
        if (directText && directText.length > 50) {
          setStatus("Direct PDF text extracted ✓");
          return directText;
        }
      } catch (e) {
        console.warn("Direct extraction failed, falling back to OCR", e);
      }
    }

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

  async function processFile(dualMode = false) {
    if (!currentFile) {
      setStatus("No file selected", true);
      return;
    }

    if (el.dual) {
      el.dual.disabled = true;
      el.dual.textContent = dualMode ? "Processing..." : "Dual OCR";
    }
    if (el.ocr) {
      el.ocr.disabled = true;
      el.ocr.textContent = "Processing...";
    }

    trackEvent(dualMode ? "dual_ocr_started" : "quick_ocr_started");

    try {
      const rawText = await runOCR(currentFile);

      // Set raw text
      if (el.raw) {
        el.raw.textContent = rawText || "--";
        // Force wrapping styles
        el.raw.style.whiteSpace = "pre-wrap";
        el.raw.style.wordBreak = "break-word";
        el.raw.style.maxWidth = "100%";
      }
      
      // Set cleaned text
      const cleanedText = normalizeOCRText(rawText);
      if (el.clean) {
        el.clean.textContent = cleanedText || "--";
        // Force wrapping styles
        el.clean.style.whiteSpace = "pre-wrap";
        el.clean.style.wordBreak = "break-word";
        el.clean.style.maxWidth = "100%";
      }
      
      // Show results section
      if (el.resultsSection) {
        el.resultsSection.hidden = false;
        setTimeout(() => {
          el.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
      
      // Show parse button
      if (el.parseBar) {
        el.parseBar.hidden = false;
      }

      // Add to recent
      addToRecent(currentFile.name);

      trackEvent(dualMode ? "dual_ocr_completed" : "quick_ocr_completed");
      setStatus("OCR done ✓");
    } catch (error) {
      console.error("OCR failed:", error);
      setStatus("OCR failed: " + error.message, true);
      trackEvent("ocr_failed", { error: error.message });
    } finally {
      if (el.dual) {
        el.dual.disabled = false;
        el.dual.textContent = "Dual OCR";
      }
      if (el.ocr) {
        el.ocr.disabled = false;
        el.ocr.textContent = "Quick OCR";
      }
    }
  }

  el.dual?.addEventListener("click", () => processFile(true));
  el.ocr?.addEventListener("click", () => processFile(false));

  /* =======================
     RECENT INVOICES
  ======================= */
  const MAX_RECENT = 4;
  const RECENT_STORAGE_KEY = 'anj_recent_invoices';

  function loadRecentFromStorage() {
    try {
      const stored = localStorage.getItem(RECENT_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  function saveRecentToStorage(items) {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  }

  function renderRecentItems() {
    if (!el.recentGrid) return;
    
    const items = loadRecentFromStorage();
    
    el.recentGrid.innerHTML = '';
    
    if (items.length === 0) {
      el.recentGrid.innerHTML = '<div class="recent-empty">No recent invoices</div>';
      return;
    }
    
    items.forEach(item => {
      const recentCard = document.createElement("div");
      recentCard.className = "recent-card";
      recentCard.innerHTML = `
        <div class="recent-icon">📄</div>
        <div class="recent-name">${item.name}</div>
        <div class="recent-time">${item.time}</div>
      `;
      el.recentGrid.appendChild(recentCard);
    });
  }

  function addToRecent(filename) {
    const items = loadRecentFromStorage();
    
    const newItem = {
      name: filename.length > 25 ? filename.slice(0, 22) + '...' : filename,
      time: 'Just now',
      fullName: filename,
      timestamp: Date.now()
    };
    
    const filtered = items.filter(i => i.fullName !== filename);
    const updated = [newItem, ...filtered].slice(0, MAX_RECENT);
    
    saveRecentToStorage(updated);
    renderRecentItems();
  }

  renderRecentItems();

  /* =======================
     TEXT NORMALIZATION - IMPROVED
  ======================= */
  function normalizeOCRText(text) {
    if (!text) return "";

    let lines = text.split('\n');

    // Layer 1: Base cleaning
    lines = lines.map(line => {
      line = line.normalize('NFC');
      
      // Fix multiple spaces but preserve structure for numeric lines
      const numericMatch = line.match(/\d+/g);
      if (numericMatch && numericMatch.length >= 2) {
        line = line.replace(/\s{3,}/g, '   ').trim();
      } else {
        line = line.replace(/\s+/g, ' ').trim();
      }
      
      // Fix broken single letters
      line = line.replace(/(?:^|\s)([A-Za-z])(?=\s[A-Za-z](?:\s|$))/g, '$1').replace(/\s([A-Za-z])(\s|$)/g, '$1$2');
      
      // Clean punctuation noise
      line = line.replace(/([A-Za-z])[.,]([A-Za-z])/g, '$1$2');

      return line;
    });

    // NEW: Aggressive cleaning for scanned documents
    lines = lines.map(line => {
      // Fix merged words with capitals (InvNo: → Inv No:)
      line = line.replace(/([a-z])([A-Z])/g, '$1 $2');
      
      // Normalize multiple question marks
      line = line.replace(/\?{2,}/g, '??');
      
      // Fix spaces around colons and other punctuation
      line = line.replace(/\s*:\s*/g, ': ');
      line = line.replace(/\s*-\s*/g, ' - ');
      
      // Fix numbers stuck to letters (A12→3 → A12-3)
      line = line.replace(/([A-Za-z])(\d)/g, '$1 $2');
      line = line.replace(/(\d)([A-Za-z])/g, '$1 $2');
      
      // Fix multiple spaces again after all replacements
      line = line.replace(/\s+/g, ' ').trim();
      
      return line;
    });

    // Layer 2: Word repair
    lines = lines.map(line => {
      return line.replace(/\b([a-zA-Z]{1,5})\s([a-zA-Z]{1,5})\b/g, (match, p1, p2) => {
        const stopWords = new Set(["a", "an", "as", "at", "be", "by", "do", "go", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we"]);
        if (stopWords.has(p1.toLowerCase())) {
          return match;
        }
        return p1 + p2;
      });
    });

    // Layer 3: Multi-line continuation
    const mergedLines = [];
    for (let i = 0; i < lines.length; i++) {
      let currentLine = lines[i];
      if (i + 1 < lines.length) {
        const nextLine = lines[i+1];
        const match = currentLine.match(/\b([a-zA-Z]{1,4})$/);
        if (match && nextLine.match(/^[a-zA-Z]/)) {
          const firstWordNextLine = nextLine.split(' ')[0];
          currentLine = currentLine.substring(0, currentLine.length - match[1].length) + match[1] + firstWordNextLine;
          lines[i+1] = nextLine.substring(firstWordNextLine.length).trim();
        }
      }
      mergedLines.push(currentLine);
    }
    lines = mergedLines.filter(line => line.length > 0);

    // Layer 4: Label normalization
    const labelMap = {
      'Addre ss': 'Address',
      'Add re ss': 'Address',
      'lnvoice': 'Invoice',
      'lnv0ice': 'Invoice',
      'T0tal': 'Total',
      'Am0unt': 'Amount',
      'GSTlN': 'GSTIN',
      'GS TIN': 'GSTIN',
      'Inv No': 'Invoice No',
      'InvNo': 'Invoice No',
      'Da te': 'Date',
      'To tal': 'Total',
      'Amo unt': 'Amount'
    };

    lines = lines.map(line => {
      for (const [key, value] of Object.entries(labelMap)) {
        line = line.replace(new RegExp(`\\b${key}\\b`, 'gi'), value);
      }
      return line;
    });

    return lines.join('\n');
  }

  function classifyOCRQuality(text) {
    if (!text || text.length < 50) return "poor";
    
    const noiseChars = (text.match(/[^a-zA-Z0-9\s.,₹]/g) || []).length;
    const noiseRatio = noiseChars / text.length;
    const hasDigits = /\d/.test(text);
    const hasCaps = /[A-Z]/.test(text);
    
    if (noiseRatio > 0.15 || !hasDigits || !hasCaps) return "poor";
    return "good";
  }

  function cleanNumber(str) {
    if (!str) return "";
    let cleaned = str.replace(/[Oo]/g, '0')
                     .replace(/[lI]/g, '1')
                     .replace(/,/g, '.');
    const match = cleaned.match(/[\d\.]+/);
    return match ? match[0] : "";
  }
   function calculateConfidence(parsed, text) {
    let score = 0;
    if (parsed.merchant) score += 25;
    if (parsed.date) score += 25;
    if (parsed.total) score += 25;
    if (text.toLowerCase().includes("gstin") || text.toLowerCase().includes("gst no")) score += 25;
    
    console.log(`[CONFIDENCE] Score: ${score}%`);
      return score;
  }

  /* =======================
     PARSER - IMPROVED (Skip headers)
  ======================= */
  function parseInvoice(text) {
    const lines = text.split('\n');
    const out = { merchant: "", date: "", total: "" };
         // IMPROVED: Skip first 3 lines (header garbage), look deeper
    for (let i = 3; i < Math.min(lines.length, 15); i++) {
      const line = lines[i].trim();
      
      // Skip if too short, too long, or contains garbage words
      if (line.length < 5 || line.length > 40) continue;
      
      // Skip lines with "scanned", "document", "quality", "very poor"
      if (/scanned|document|quality|very\s*poor|poor\s*quality/i.test(line)) continue;
      
      // Skip pure numbers
      if (/^\d+$/.test(line)) continue;
      
      // Skip lines that are all caps (usually headers)
      if (line === line.toUpperCase() && line.length > 10) continue;
      
      const genericKeywords = ["invoice", "tax", "receipt", "bill", "gst", "address", "tel", "phone", "email"];
      const isGeneric = genericKeywords.some(k => line.toLowerCase().includes(k));
      const hasManyNumbers = (line.match(/\d/g) || []).length > 8;
      
      if (!isGeneric && !hasManyNumbers && line.match(/[a-z]/i)) {
        out.merchant = line;
        break;
      }
    }

    // Date extraction
    const dateRegex = /\b(\d{1,2}[-\/\. ]\d{1,2}[-\/\. ]\d{2,4})\b|\b(\d{1,2} [A-Za-z]{3,9} \d{2,4})\b/g;
    let dateCandidates = [];
    text.replace(dateRegex, (match) => {
      const context = text.substring(Math.max(0, text.indexOf(match) - 20), text.indexOf(match) + match.length + 20);
      if (!context.toLowerCase().includes("gst") && !context.match(/\d{10,}/)) {
        dateCandidates.push(match);
      }
    });
    if (dateCandidates.length > 0) out.date = dateCandidates[0];

    // Total extraction
    const totalKeywords = ["total", "payable", "amount", "net", "grand", "sum"];
    const numberRegex = /(?:₹|RS|INR|AMT)?\s*([\d\.,]{2,})/gi;
    let candidates = [];
    lines.forEach((line, index) => {
      let match;
      while ((match = numberRegex.exec(line)) !== null) {
        const valStr = cleanNumber(match[1]);
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

  // Parse button handlers
  [el.parse, document.getElementById('parseBtn')].forEach(btn => {
    btn?.addEventListener("click", () => {
      if (!el.clean || !el.clean.textContent || el.clean.textContent === "--") {
        setStatus("Nothing to parse", true);
        return;
      }

      const rawText = el.clean.textContent;
      const parsed = parseInvoice(rawText);
      trackEvent("invoice_parsed");
      
      const verification = verifyInvoiceTotals(parsed, rawText);
      const confidence = calculateConfidence(parsed, rawText);
      
      let summaryHeadline = "";
      const diff = verification.differenceAmount;
      
      if (verification.status === "Unverifiable") {
        summaryHeadline = "❌ Unverifiable: Verification failed due to missing item structure or total";
      } else if (Math.abs(diff) <= 0.01) {
        summaryHeadline = "✅ Invoice total matches calculated amount";
      } else if (diff > 0) {
        summaryHeadline = `⚠️ Invoice total is ₹${diff.toFixed(2)} less than calculated amount`;
      } else {
        summaryHeadline = `⚠️ You may have been overcharged ₹${Math.abs(diff).toFixed(2)}`;
      }
      
      let breakdown = `\n---\nCalculated Total: ₹${verification.computedTotal.toFixed(2)}\nInvoice Total: ₹${verification.declaredTotal.toFixed(2)}\nDifference: ₹${diff.toFixed(2)}`;
      
      const cgstMatch = rawText.match(/CGST\s*[:\-]?\s*([\d\.]+)/i);
      const sgstMatch = rawText.match(/SGST\s*[:\-]?\s*([\d\.]+)/i);
      const igstMatch = rawText.match(/IGST\s*[:\-]?\s*([\d\.]+)/i);
      const gstMatch = rawText.match(/GST\s*[:\-]?\s*([\d\.]+)/i);

      if (cgstMatch || sgstMatch || igstMatch) {
        breakdown += "\n\nTax Breakdown:";
        if (cgstMatch) breakdown += `\n- CGST: ₹${cgstMatch[1]}`;
        if (sgstMatch) breakdown += `\n- SGST: ₹${sgstMatch[1]}`;
        if (igstMatch) breakdown += `\n- IGST: ₹${igstMatch[1]}`;
      } else if (gstMatch) {
        breakdown += `\n\nTax Breakdown:\n- GST: ₹${gstMatch[1]}`;
      } else if (rawText.toLowerCase().includes("tax") || rawText.toLowerCase().includes("gst")) {
        breakdown += "\n\n⚠️ Tax exists but structure is unclear.";
      }

      const confidenceReason = confidence >= 75 ? "High: Key fields and items verified." : 
                               confidence >= 50 ? "Medium: Some fields missing or items unclear." : 
                               "Low: Major fields missing or math mismatch.";
      breakdown += `\n\nConfidence: ${confidence}% (${confidenceReason})`;
      
      const ocrQuality = classifyOCRQuality(rawText);
      breakdown += `\nOCR Signal Quality: ${ocrQuality.toUpperCase()}`;

      setStatus(`${summaryHeadline}${breakdown}`, verification.status !== "Verified");

      if (verification.status === "Verified") trackEvent("invoice_verified");
      
      if (el.editMerchant) el.editMerchant.value = parsed.merchant || "";
      if (el.editDate) el.editDate.value = parsed.date || "";
      if (el.editTotal) el.editTotal.value = parsed.total || "";
      if (el.json) el.json.textContent = JSON.stringify(parsed, null, 2);
      
      // Update verification badge
      if (el.verificationBadge) {
        const badgeIcon = el.verificationBadge.querySelector('.badge-icon');
        const badgeTitle = el.verificationBadge.querySelector('.badge-title');
        const badgeSubtitle = el.verificationBadge.querySelector('.badge-subtitle');
        
        if (badgeIcon) badgeIcon.textContent = verification.status === "Verified" ? "✅" : "⚠️";
        if (badgeTitle) badgeTitle.textContent = verification.status === "Verified" ? "Verified" : "Verification Issues";
        if (badgeSubtitle) badgeSubtitle.textContent = summaryHeadline;
        
        el.verificationBadge.className = "verification-badge " + (verification.status === "Verified" ? "verified" : "warning");
      }
      
      hasParsedData = true;
      updateParsedUI(true);

      if (el.parseBar) el.parseBar.hidden = true;
      
      document.querySelector('[data-page="parsed"]')?.click();
    });
  });

  /* =======================
     EDIT FIELD TRACKING
  ======================= */
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
    li.className = "history-item";
    li.innerHTML = `
      <span class="history-icon">📄</span>
      <div class="history-info">
        <div class="history-name">${item.merchant || "Unknown"}</div>
        <div class="history-date">${new Date(item.timestamp).toLocaleString()}</div>
      </div>
      <div class="history-amount">${item.total || "--"}</div>
    `;
    
    if (item.id === lastSavedId) {
      li.style.borderLeft = "3px solid var(--accent)";
    }
    
    li.addEventListener("click", () => {
      hasParsedData = true;
      selectedHistoryItem = item;
      if (item.id === lastSavedId) {
        lastSavedId = null;
        li.style.borderLeft = "";
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

  el.historySearch?.addEventListener("input", e => loadHistory(e.target.value.toLowerCase()));

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
    
    request.onsuccess = e => { lastSavedId = e.target.result; };
    tx.oncomplete = () => {
      trackEvent("history_saved");
      setTimeout(() => {
        loadHistory();
        setStatus("Saved ✓");
      }, 0);
    };
    tx.onerror = () => { setStatus("Save failed", true); };
  });

  el.clearHistoryBtn?.addEventListener("click", () => {
    if (!confirm("Clear all history?")) return;
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    tx.oncomplete = loadHistory;
  });

  /* =======================
     EXPORTS
  ======================= */
  const handleExportAttempt = (type) => {
    trackEvent(`export_attempted_${type}`);
    setStatus("Export is a premium feature", true);
  };

  el.exportJSON?.addEventListener("click", () => handleExportAttempt("json"));
  el.exportTXT?.addEventListener("click", () => handleExportAttempt("txt"));
  el.exportCSV?.addEventListener("click", () => handleExportAttempt("csv"));

  initDB();
  setStatus("Ready ✓");
});
