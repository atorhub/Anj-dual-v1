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
    // Core inputs/outputs
    file: document.getElementById("fileInput"),
    raw: document.getElementById("rawText"),
    clean: document.getElementById("cleanedText"),
    json: document.getElementById("jsonPreview"),
    status: document.getElementById("statusBar"),
    userIdDisplay: document.getElementById("userIdDisplay"),

    // Action buttons
    dual: document.getElementById("dualOCRBtn"),
    ocr: document.getElementById("ocrOnlyBtn"),
    parse: document.getElementById("parseBtn"),

    // NEW: UI Flow elements
    uploadFeedback: document.getElementById("uploadFeedback"),
    feedbackFilename: document.getElementById("feedbackFilename"),
    uploadActions: document.getElementById("uploadActions"),
    uploadPromptArea: document.getElementById("uploadPromptArea"),
    resultsSection: document.getElementById("resultsSection"),
    parseBtn: document.getElementById("parseBtn"), // Results header button
    recentGrid: document.getElementById("recentGrid"),

    // Parsed page elements
    saveBtn: document.getElementById("saveBtn"),
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),

    // Export buttons
    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),

    // Navigation
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarCloseBtn: document.getElementById("sidebarCloseBtn"),

    // History
    historyList: document.getElementById("historyList"),
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),

    // Settings (selects populated by JS)
    theme: document.getElementById("themeSelect"),
    layout: document.getElementById("layoutSelect")
  };

  // Display user ID in top bar
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

  // Sidebar nav items
  document.querySelectorAll(".sidebar-nav .nav-item, .sidebar-footer .nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;
      if (!page) return;

      // Update sidebar active states
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");

      // Update page visibility
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const targetPage = document.querySelector(".page-" + page);
      if (targetPage) {
        targetPage.classList.add("active");
        trackEvent("page_navigated", { page: page });
      }

      // Update topbar pills
      document.querySelectorAll(".nav-pill").forEach(pill => {
        pill.classList.toggle("active", pill.dataset.page === page);
      });

      // Close sidebar on mobile
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

      // Sync sidebar
      document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.page === page);
      });

      trackEvent("page_navigated", { page: page });
    });
  });

  /* =======================
     THEMES & LAYOUTS
  ======================= */
  // Initialize theme options
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

  // Layout handling (kept for compatibility, CSS ignores layout-* classes)
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

    // Show filename
    if (el.feedbackFilename) el.feedbackFilename.textContent = file.name;
    if (el.uploadFeedback) {
      el.uploadFeedback.hidden = false;
      el.uploadFeedback.style.animation = "none";
      el.uploadFeedback.offsetHeight; // Trigger reflow
      el.uploadFeedback.style.animation = "";
    }

    // Show OCR buttons with animation
    if (el.uploadActions) {
      el.uploadActions.hidden = false;
      el.uploadActions.style.opacity = "0";
      el.uploadActions.style.transform = "translateY(10px)";
      setTimeout(() => {
        el.uploadActions.style.transition = "all 0.3s ease";
        el.uploadActions.style.opacity = "1";
        el.uploadActions.style.transform = "translateY(0)";
      }, 50);
    }

    // Hide results if they were showing from previous file
    if (el.resultsSection) {
      el.resultsSection.hidden = true;
    }
    if (el.parseBtn) el.parseBtn.hidden = true;

    // Dim the prompt slightly to focus on actions
    if (el.uploadPromptArea) {
      el.uploadPromptArea.style.opacity = "0.7";
    }

    // Fade out filename after 3 seconds
    setTimeout(() => {
      if (el.feedbackFilename && el.uploadFeedback && !el.uploadFeedback.hidden) {
        el.feedbackFilename.style.transition = "opacity 0.5s ease, transform 0.5s ease";
        el.feedbackFilename.style.opacity = "0";
        el.feedbackFilename.style.transform = "translateY(-10px)";
        
        setTimeout(() => {
          if (el.uploadFeedback) el.uploadFeedback.hidden = true;
          if (el.feedbackFilename) {
            el.feedbackFilename.style.opacity = "1";
            el.feedbackFilename.style.transform = "translateY(0)";
            el.feedbackFilename.style.transition = "";
          }
        }, 500);
      }
    }, 3000);
  });

  // Click on prompt area also triggers file input (if not already selected)
  el.uploadPromptArea?.addEventListener("click", (e) => {
    if (currentFile) return; // Already have file, don't re-trigger
    // Let the event bubble to file input
  });

  /* =======================
     PHASE-1 LOCKED: PDF & OCR
     - Scale 3x for signal integrity
     - Tesseract eng default
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

    // PHASE-2: Improve contrast and clarity for OCR
    ctx.filter = 'grayscale(100%) contrast(1.2) brightness(1.1)';
    
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  async function extractTextFromPDF(file) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    
    // Check if selectable text layer exists
    if (textContent.items.length === 0) return null;

    // Group items by their vertical position (y-coordinate) to preserve lines
    const lines = {};
    textContent.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push(item);
    });

    // Sort lines by y (descending) and items within lines by x (ascending)
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

    // PHASE-2: Try direct PDF text extraction first
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

    // Disable buttons during processing
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

      // Wiring Point: rawText UI gets original OCR output
      if (el.raw) el.raw.textContent = rawText || "--";
      
      // Wiring Point: cleanedText UI gets normalized OCR output
      const cleanedText = normalizeOCRText(rawText);
      if (el.clean) el.clean.textContent = cleanedText || "--";
      
      // Show results section with animation
      if (el.resultsSection) {
        el.resultsSection.hidden = false;
        // Smooth scroll to results
        setTimeout(() => {
          el.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
      
      // Show parse button
      if (el.parseBtn) {
        el.parseBtn.hidden = false;
        el.parseBtn.classList.add("btn-pulse");
        setTimeout(() => el.parseBtn.classList.remove("btn-pulse"), 2000);
      }

      // Add to recent (visual only for now)
      addToRecent(currentFile.name);

      trackEvent(dualMode ? "dual_ocr_completed" : "quick_ocr_completed");
      setStatus("OCR done ✓");
    } catch (error) {
      console.error("OCR failed:", error);
      setStatus("OCR failed: " + error.message, true);
      trackEvent("ocr_failed", { error: error.message });
    } finally {
      // Re-enable buttons
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

  // OCR button handlers
  el.dual?.addEventListener("click", () => processFile(true));
  el.ocr?.addEventListener("click", () => processFile(false));

  /* =======================
   RECENT INVOICES (Persistent)
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
    const recentItem = document.createElement("div");
    recentItem.className = "recent-item";
    recentItem.innerHTML = `
      <div class="recent-icon">📄</div>
      <div class="recent-name">${item.name}</div>
      <div class="recent-time">${item.time}</div>
    `;
    el.recentGrid.appendChild(recentItem);
  });
}

function addToRecent(filename) {
  const items = loadRecentFromStorage();
  
  // Add new item at beginning
  const newItem = {
    name: filename.length > 25 ? filename.slice(0, 22) + '...' : filename,
    time: 'Just now',
    fullName: filename,
    timestamp: Date.now()
  };
  
  // Remove duplicates
  const filtered = items.filter(i => i.fullName !== filename);
  
  // Add new and limit
  const updated = [newItem, ...filtered].slice(0, MAX_RECENT);
  
  saveRecentToStorage(updated);
  renderRecentItems();
}

// Load on startup
renderRecentItems();

  /* =======================
     PHASE-1 LOCKED: PARSING & NORMALIZATION
     - Strict numeric row preservation
     - Deterministic label normalization
     - No inference or guessing
  ======================= */

  /**
   * Requirement: normalizeOCRText(text)
   * Implements the Cleaned Text Contract through four deterministic layers.
   */
  function normalizeOCRText(text) {
    if (!text) return "";

    // Initial line split
    let lines = text.split('\n');

    // Layer 1: Base Normalization (per-line)
    lines = lines.map(line => {
      // 1.1: Normalize unicode characters to their canonical form
      line = line.normalize('NFC');
      
      // 1.2: Remove duplicate spaces and trim (conditional for numeric rows)
      const numericMatch = line.match(/\d+/g);
      if (numericMatch && numericMatch.length >= 2) {
        // Numeric-dense row: preserve structure by avoiding aggressive collapse
        line = line.replace(/\s{3,}/g, '   ').trim();
      } else {
        line = line.replace(/\s+/g, ' ').trim();
      }
      
      // 1.3: Fix broken single-letter spacing (e.g., "M e r c h a n t" -> "Merchant")
      line = line.replace(/(?:^|\s)([A-Za-z])(?=\s[A-Za-z](?:\s|$))/g, '$1').replace(/\s([A-Za-z])(\s|$)/g, '$1$2');

      // 1.4: Clean OCR punctuation noise inside words (e.g., "Add.ress" -> "Address")
      line = line.replace(/([A-Za-z])[.,]([A-Za-z])/g, '$1$2');

      return line;
    });

    // Layer 2: Rule-Based Word Repair (per-line)
    lines = lines.map(line => {
        // Merge alphabetic fragments split by OCR (e.g., "Add re ss" -> "Address")
        // This is a conservative rule: only merges short, purely alphabetic fragments.
        return line.replace(/\b([a-zA-Z]{1,5})\s([a-zA-Z]{1,5})\b/g, (match, p1, p2) => {
            // Avoid merging common English words. This is not exhaustive but covers many cases.
            const stopWords = new Set(["a", "an", "as", "at", "be", "by", "do", "go", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we"]);
            if (stopWords.has(p1.toLowerCase())) {
                return match; // Don't merge if the first part is a common short word
            }
            return p1 + p2;
        });
    });

    // Layer 3: Multi-line Word Continuation
    const mergedLines = [];
    for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i];
        if (i + 1 < lines.length) {
            const nextLine = lines[i+1];
            // Check if current line ends with a small, incomplete-looking word
            // and the next line starts with a word. This is a heuristic.
            const match = currentLine.match(/\b([a-zA-Z]{1,4})$/);
            if (match && nextLine.match(/^[a-zA-Z]/)) {
                // Heuristic: if the fragment is very short, merge it with the first word of the next line.
                const firstWordNextLine = nextLine.split(' ')[0];
                currentLine = currentLine.substring(0, currentLine.length - match[1].length) + match[1] + firstWordNextLine;
                lines[i+1] = nextLine.substring(firstWordNextLine.length).trim();
            }
        }
        mergedLines.push(currentLine);
    }
     lines = mergedLines.filter(line => line.length > 0);

    // Layer 4: Label Normalization
    const labelMap = {
      'Addre ss': 'Address',
      'Add re ss': 'Address',
      'lnvoice': 'Invoice',
      'lnv0ice': 'Invoice',
      'T0tal': 'Total',
      'Am0unt': 'Amount',
      'GSTlN': 'GSTIN',
      'GS TIN': 'GSTIN',
    };
     lines = lines.map(line => {
        for (const [key, value] of Object.entries(labelMap)) {
            line = line.replace(new RegExp(`\\b${key}\\b`, 'gi'), value);
        }
        return line;
    });

    return lines.join('\n');
  }
   /**
   * Requirement: classifyOCRQuality(text)
   * Observational only classification of OCR signal quality.
   */
  function classifyOCRQuality(text) {
    if (!text || text.length < 50) return "poor";
     // Check for excessive non-alphanumeric noise
    const noiseChars = (text.match(/[^a-zA-Z0-9\s.,₹]/g) || []).length;
    const noiseRatio = noiseChars / text.length;
    
    // Check for basic structure indicators (presence of digits and capital letters)
    const hasDigits = /\d/.test(text);
    const hasCaps = /[A-Z]/.test(text);
     if (noiseRatio > 0.15 || !hasDigits || !hasCaps) return "poor";
    return "good";
  }

  /**
   * Smart number handling helper
   */
  function cleanNumber(str) {
    if (!str) return "";
    let cleaned = str.replace(/[Oo]/g, '0')
      .replace(/[lI]/g, '1')
                     .replace(/,/g, '.');
    const match = cleaned.match(/[\d\.]+/);
    return match ? match[0] : "";
  }

  /**
   * Confidence Calculation
   * Based ONLY on presence of merchant, date, total, GSTIN
   */
   function calculateConfidence(parsed, text) {
    let score = 0;
    if (parsed.merchant) score += 25;
    if (parsed.date) score += 25;
    if (parsed.total) score += 25;
    if (text.toLowerCase().includes("gstin") || text.toLowerCase().includes("gst no")) score += 25;
    console.log(`[CONFIDENCE] Score: ${score}%`);
    return score;
  }

  function parseInvoice(text) {
    // Wiring Point: Parser uses normalized text only (already normalized in wiring)
    const lines = text.split('\n');
    const out = { merchant: "", date: "", total: "" };
         // Merchant Extraction
    const genericKeywords = ["invoice", "tax", "receipt", "bill", "gst", "address", "tel", "phone", "email"];
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const line = lines[i].trim();
      const isGeneric = genericKeywords.some(k => line.toLowerCase().includes(k));
      const hasManyNumbers = (line.match(/\d/g) || []).length > 5;
       if (line.length > 2 && !isGeneric && !hasManyNumbers) {
        out.merchant = line;
        break;
      }
    }

    // Date Extraction
    const dateRegex = /\b(\d{1,2}[-\/\. ]\d{1,2}[-\/\. ]\d{2,4})\b|\b(\d{1,2} [A-Za-z]{3,9} \d{2,4})\b/g;
     let dateCandidates = [];
    text.replace(dateRegex, (match) => {
      const context = text.substring(Math.max(0, text.indexOf(match) - 20), text.indexOf(match) + match.length + 20);
      if (!context.toLowerCase().includes("gst") && !context.match(/\d{10,}/)) {
        dateCandidates.push(match);
      }
    });
    if (dateCandidates.length > 0) out.date = dateCandidates[0];

    // Total Extraction
    const totalKeywords = ["total", "payable", "amount", "net", "grand", "sum"];
    const numberRegex = /(?:₹|RS|INR|AMT)?\s*([\d\.,]{2,})/gi;
    let candidates = [];
    lines.forEach((line, index) => {
      let match;
      while  ((match = numberRegex.exec(line)) !== null) {
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
      // GOAL 1: Filter for valid candidates and select the LARGEST monetary value
     const validCandidates = candidates.filter(c => c.score > 20);
      if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
        out.total = validCandidates[0].value;
      }
    }

    return out;
  }
   // Parse button handlers (both in results header and old location)
  [el.parse, el.parseBtn].forEach(btn => {
    btn?.addEventListener("click", () => {
      if (!el.clean || !el.clean.textContent || el.clean.textContent === "--") {
        setStatus("Nothing to parse", true);
        return;
      }
       const rawText = el.clean.textContent;
      const parsed = parseInvoice(rawText);
      trackEvent("invoice_parsed");
      
      const verification = verifyInvoiceTotals(parsed, rawText);

      // Confidence Calculation and Display
      const confidence = calculateConfidence(parsed, rawText);
       // --- VERIFICATION SUMMARY GENERATION ---
      let summaryHeadline = "";
      const diff = verification.differenceAmount;
      
      if (verification.status === "Unverifiable") {
        // GOAL 2: Clarify reason for unverifiable invoices
        summaryHeadline = "❌ Unverifiable: Verification failed due to missing item structure or total";
      } else if (Math.abs(diff) <= 0.01) {
         summaryHeadline = "✅ Invoice total matches calculated amount";
      } else if (diff > 0) {
        summaryHeadline = `⚠️ Invoice total is ₹${diff.toFixed(2)} less than calculated amount`;
      } else {
        summaryHeadline = `⚠️ You may have been overcharged ₹${Math.abs(diff).toFixed(2)}`;
      }
       let breakdown = `\n---\nCalculated Total: ₹${verification.computedTotal.toFixed(2)}\nInvoice Total: ₹${verification.declaredTotal.toFixed(2)}\nDifference: ₹${diff.toFixed(2)}`;
    // Tax Clarity
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

      // Confidence and Reason
      const confidenceReason = confidence >= 75 ? "High: Key fields and items verified." : 
                               confidence >= 50 ? "Medium: Some fields missing or items unclear." : 
                               "Low: Major fields missing or math mismatch.";
      breakdown += `\n\nConfidence: ${confidence}% (${confidenceReason})`;
       // OCR Quality Classification (Read-Only Metadata)
      const ocrQuality = classifyOCRQuality(rawText);
      breakdown += `\nOCR Signal Quality: ${ocrQuality.toUpperCase()}`;

      // Final Output to UI
      setStatus(`${summaryHeadline}${breakdown}`, verification.status !== "Verified");

      /**
       * PHASE-2 EXTENSION POINTS (FUTURE):
       * - Multi-format export (Excel/CSV reconstruction)
       * - UI-driven manual line-item overrides
       */
      
      if (verification.status === "Verified") trackEvent("invoice_verified");
          // Update UI with parsed data
      if (el.editMerchant) el.editMerchant.value = parsed.merchant || "";
      if (el.editDate) el.editDate.value = parsed.date || "";
      if (el.editTotal) el.editTotal.value = parsed.total || "";
      if (el.json) el.json.textContent = JSON.stringify(parsed, null, 2);
      
      hasParsedData = true;
      updateParsedUI(true);

      // Hide parse buttons after successful parse
      if (el.parseBtn) el.parseBtn.hidden = true;
      
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
    li.textContent = (item.merchant || "Unknown") + " • " + new Date(item.timestamp).toLocaleString();
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
     EXPORTS (GATED)
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
