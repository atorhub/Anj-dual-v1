console.log("SCRIPT LOADED");

import { verifyInvoiceTotals } from "./invoiceVerification.js";

const pdfjsLib = window.pdfjsLib;
const Tesseract = window.Tesseract;

// ==================== UTILITIES ====================

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

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== STATE ====================

let db = null;
let hasParsedData = false;
let currentFile = null;
let extractedItems = [];
let parsedData = null;

// ==================== DOM READY ====================

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM READY");
  
  initAnonUserId();
  trackEvent("app_loaded");

  // ==================== ELEMENT REFERENCES ====================
  
  const el = {
    // Core inputs/outputs
    fileInput: document.getElementById("fileInput"),
    rawText: document.getElementById("rawText"),
    cleanedText: document.getElementById("cleanedText"),
    jsonPreview: document.getElementById("jsonPreview"),
    statusBar: document.getElementById("statusBar"),
    userIdDisplay: document.getElementById("userIdDisplay"),
    
    // OCR buttons
    quickOCRBtn: document.getElementById("quickOCRBtn"),
    dualOCRBtn: document.getElementById("dualOCRBtn"),
    parseBtn: document.getElementById("parseBtn"),
    
    // Upload UI
    uploadCard: document.getElementById("uploadCard"),
    filenamePill: document.getElementById("filenamePill"),
    filenameText: document.getElementById("filenameText"),
    clearFileBtn: document.getElementById("clearFile"),
    ocrActions: document.getElementById("ocrActions"),
    resultsSection: document.getElementById("resultsSection"),
    
    // Recent section
    recentGrid: document.getElementById("recentGrid"),
    clearRecentBtn: document.getElementById("clearRecent"),
    
    // Parsed page fields
    editMerchant: document.getElementById("editMerchant"),
    editDate: document.getElementById("editDate"),
    editTotal: document.getElementById("editTotal"),
    verificationBadge: document.getElementById("verificationBadge"),
    badgeSubtitle: document.getElementById("badgeSubtitle"),
    saveBtn: document.getElementById("saveBtn"),
    saveHint: document.getElementById("saveHint"),
    itemsSection: document.getElementById("itemsSection"),
    itemsTableBody: document.getElementById("itemsTableBody"),
    itemsCount: document.getElementById("itemsCount"),
    parsedBadge: document.getElementById("parsedBadge"),
    
    // Export
    exportJSON: document.getElementById("exportJSON"),
    exportTXT: document.getElementById("exportTXT"),
    exportCSV: document.getElementById("exportCSV"),
    copyPreviewBtn: document.getElementById("copyPreview"),
    
    // Navigation
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarCloseBtn: document.getElementById("sidebarCloseBtn"),
    loginBtn: document.getElementById("loginBtn"),
    
    // Modal
    loginModal: document.getElementById("loginModal"),
    closeLoginBtn: document.getElementById("closeLogin"),
    
    // History page
    historyPageList: document.getElementById("historyPageList"),
    historySearch: document.getElementById("historySearch"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    historyCount: document.getElementById("historyCount"),
    
    // Theme inputs (radio buttons)
    themeInputs: document.querySelectorAll('input[name="theme"]')
  };

  // ==================== INITIAL UI SETUP ====================
  
  if (el.userIdDisplay) {
    const anonId = localStorage.getItem("anon_user_id") || "—";
    el.userIdDisplay.textContent = `User: ${anonId.slice(0, 8)}...`;
  }

  function setStatus(msg, isError = false) {
    if (!el.statusBar) return;
    el.statusBar.textContent = msg;
    el.statusBar.style.color = isError ? "#ef4444" : "#22c55e";
  }

  function updateParsedUI(enabled) {
    const elements = [
      el.saveBtn, 
      el.exportJSON, 
      el.exportTXT, 
      el.exportCSV,
      el.editMerchant, 
      el.editDate, 
      el.editTotal
    ];
    
    elements.forEach(elem => {
      if (!elem) return;
      elem.disabled = !enabled;
      if (elem.tagName === 'INPUT') {
        elem.style.opacity = enabled ? "1" : "0.6";
      } else {
        elem.style.opacity = enabled ? "1" : "0.5";
        elem.style.cursor = enabled ? "pointer" : "not-allowed";
      }
    });
  }

  updateParsedUI(false);
  setStatus("Ready ✓");

  // ==================== SIDEBAR TOGGLE ====================
  
  // Toggle sidebar open/closed
  el.sidebarToggle?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.toggle("sidebar-hidden");
    const isHidden = document.body.classList.contains("sidebar-hidden");
    trackEvent("sidebar_toggled", { state: isHidden ? "closed" : "open" });
    console.log("Sidebar toggled:", isHidden ? "hidden" : "visible");
  });

  // Close sidebar button (mobile)
  el.sidebarCloseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    document.body.classList.add("sidebar-hidden");
    trackEvent("sidebar_closed");
  });

  // ==================== NAVIGATION ====================
  
  // Sidebar nav items
  document.querySelectorAll(".sidebar .nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (!page) return;

      console.log("Navigating to:", page);

      // Update active states in sidebar
      document.querySelectorAll(".sidebar .nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");

      // Switch pages
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const targetPage = document.querySelector(`.page-${page}`);
      if (targetPage) {
        targetPage.classList.add("active");
        trackEvent("page_navigated", { page, source: "sidebar" });
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
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      const page = pill.dataset.page;
      if (!page) return;

      console.log("Topbar navigating to:", page);

      // Update pill active states
      document.querySelectorAll(".nav-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      // Switch pages
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const targetPage = document.querySelector(`.page-${page}`);
      if (targetPage) {
        targetPage.classList.add("active");
        trackEvent("page_navigated", { page, source: "topbar" });
      }

      // Sync sidebar
      document.querySelectorAll(".sidebar .nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.page === page);
      });
    });
  });

  // ==================== THEME SWITCHING ====================
  
  // Theme radio buttons
  el.themeInputs?.forEach(input => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      
      const theme = input.value;
      console.log("Theme changed to:", theme);
      
      // Remove all theme classes
      document.body.classList.forEach(c => {
        if (c.startsWith("theme-")) document.body.classList.remove(c);
      });
      
      // Add new theme
      document.body.classList.add(`theme-${theme}`);
      localStorage.setItem("anj-theme", theme);
      trackEvent("theme_changed", { theme });
    });
  });

  // Load saved theme
  const savedTheme = localStorage.getItem("anj-theme");
  if (savedTheme) {
    const savedInput = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
    if (savedInput) {
      savedInput.checked = true;
      document.body.classList.add(`theme-${savedTheme}`);
    }
  }

  // ==================== LOGIN MODAL ====================
  
  el.loginBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (el.loginModal) {
      el.loginModal.hidden = false;
      trackEvent("login_modal_opened");
    }
  });

  el.closeLoginBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (el.loginModal) el.loginModal.hidden = true;
  });

  // Close on backdrop click
  el.loginModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => {
    el.loginModal.hidden = true;
  });

  // Close on escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.loginModal && !el.loginModal.hidden) {
      el.loginModal.hidden = true;
    }
  });

  // ==================== FILE UPLOAD ====================
  
  // File input change
  el.fileInput?.addEventListener("change", () => {
    const file = el.fileInput.files[0];
    if (!file) return;
    
    currentFile = file;
    console.log("File selected:", file.name);
    trackEvent("file_selected", { filename: file.name, type: file.type, size: file.size });

    // Show filename pill
    if (el.filenameText) {
      el.filenameText.textContent = file.name.length > 30 ? file.name.slice(0, 27) + '...' : file.name;
    }
    
    if (el.filenamePill) {
      el.filenamePill.hidden = false;
    }
    
    // Update upload card state
    if (el.uploadCard) {
      el.uploadCard.classList.add("has-file");
    }
    
    // Show OCR action buttons
    if (el.ocrActions) {
      el.ocrActions.hidden = false;
    }
    
    // Hide results from previous file
    if (el.resultsSection) {
      el.resultsSection.hidden = true;
    }
  });

  // Clear file button
  el.clearFileBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (el.fileInput) el.fileInput.value = "";
    currentFile = null;
    
    if (el.filenamePill) el.filenamePill.hidden = true;
    if (el.uploadCard) el.uploadCard.classList.remove("has-file");
    if (el.ocrActions) el.ocrActions.hidden = true;
    if (el.resultsSection) el.resultsSection.hidden = true;
    
    trackEvent("file_cleared");
  });

  // Click on upload card triggers file input
  el.uploadCard?.addEventListener("click", (e) => {
    if (e.target === el.fileInput || e.target.closest('.upload-input')) return;
    if (currentFile) return; // Don't trigger if file already selected
    el.fileInput?.click();
  });

  // ==================== OCR PROCESSING ====================
  
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
      console.error("PDF text extraction failed:", e);
      return null;
    }
  }

  async function runTesseract(source, onProgress) {
    const result = await Tesseract.recognize(source, "eng", {
      logger: m => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(m.progress);
        }
      }
    });
    return result.data.text || "";
  }

  async function performQuickOCR(file) {
    setStatus("Reading file...");
    await new Promise(r => setTimeout(r, 150));

    // Try direct PDF extraction first
    if (file.type === "application/pdf") {
      setStatus("Extracting text from PDF...");
      const directText = await extractTextFromPDF(file);
      if (directText && directText.length > 50) {
        setStatus("Text extracted ✓");
        return directText;
      }
    }

    // Fall back to OCR
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

  async function performDualOCR(file) {
    setStatus("Reading file...");
    await new Promise(r => setTimeout(r, 150));
    setStatus("Pass 1: Standard extraction...");

    // Pass 1: Standard
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

    // Pass 2: Enhanced
    setStatus("Pass 2: Enhanced extraction...");
    let pass2Text = "";
    if (file.type === "application/pdf") {
      const canvas = await pdfToCanvas(file, 3);
      pass2Text = await runTesseract(canvas);
    } else {
      // For images, just use pass 1
      pass2Text = pass1Text;
    }

    setStatus("Merging results...");
    await new Promise(r => setTimeout(r, 200));

    // Merge: prefer longer, supplement with unique lines
    let mergedText = pass1Text;
    if (pass2Text.length > pass1Text.length * 1.1) {
      mergedText = pass2Text;
    } else {
      const lines1 = new Set(pass1Text.split('\n').map(l => l.trim()));
      const lines2 = pass2Text.split('\n').map(l => l.trim());
      const uniqueLines2 = lines2.filter(l => l && !lines1.has(l));
      if (uniqueLines2.length > 0) {
        mergedText = pass1Text + '\n' + uniqueLines2.join('\n');
      }
    }

    setStatus("Dual OCR complete ✓");
    return mergedText;
  }

  async function processOCR(useDual = false) {
    if (!currentFile) {
      setStatus("No file selected", true);
      return;
    }

    console.log("Starting OCR:", useDual ? "Dual" : "Quick");

    // Update button states
    if (el.quickOCRBtn) {
      el.quickOCRBtn.disabled = true;
      el.quickOCRBtn.innerHTML = useDual 
        ? '<span class="btn-icon">⏳</span>Processing...' 
        : '<span class="btn-icon">⚡</span>Quick OCR';
    }
    
    if (el.dualOCRBtn) {
      el.dualOCRBtn.disabled = true;
      el.dualOCRBtn.innerHTML = useDual 
        ? '<span class="btn-icon">🔍</span>Dual OCR'
        : '<span class="btn-icon">⏳</span>Processing...';
    }

    if (el.uploadCard) {
      el.uploadCard.classList.add("processing");
    }

    trackEvent(useDual ? "dual_ocr_started" : "quick_ocr_started");

    try {
      const rawText = useDual 
        ? await performDualOCR(currentFile) 
        : await performQuickOCR(currentFile);

      console.log("OCR complete, text length:", rawText.length);

      // Display raw text
      if (el.rawText) {
        el.rawText.textContent = rawText || "--";
      }

      // Clean and display
      const cleanedText = normalizeOCRText(rawText);
      if (el.cleanedText) {
        el.cleanedText.textContent = cleanedText || "--";
      }

      // Extract items for verification
      extractedItems = extractLineItems(cleanedText);
      console.log("Extracted items:", extractedItems.length);

      // Show results section
      if (el.resultsSection) {
        el.resultsSection.hidden = false;
        // Smooth scroll
        setTimeout(() => {
          el.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }

      // Enable parse button
      if (el.parseBtn) {
        el.parseBtn.disabled = false;
      }

      // Add to recent
      addToRecent(currentFile.name);
      
      trackEvent(useDual ? "dual_ocr_completed" : "quick_ocr_completed", { 
        textLength: rawText.length,
        itemsFound: extractedItems.length 
      });

    } catch (error) {
      console.error("OCR failed:", error);
      setStatus("OCR failed: " + error.message, true);
      trackEvent("ocr_failed", { error: error.message });
    } finally {
      // Reset button states
      if (el.quickOCRBtn) {
        el.quickOCRBtn.disabled = false;
        el.quickOCRBtn.innerHTML = '<span class="btn-icon">⚡</span>Quick OCR';
      }
      if (el.dualOCRBtn) {
        el.dualOCRBtn.disabled = false;
        el.dualOCRBtn.innerHTML = '<span class="btn-icon">🔍</span>Dual OCR';
      }
      if (el.uploadCard) {
        el.uploadCard.classList.remove("processing");
      }
    }
  }

  // OCR button event listeners
  el.quickOCRBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    processOCR(false);
  });

  el.dualOCRBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    processOCR(true);
  });

  // ==================== TEXT PROCESSING ====================
  
  function normalizeOCRText(text) {
    if (!text) return "";
    let lines = text.split('\n');

    lines = lines.map(line => {
      // Normalize unicode
      line = line.normalize('NFC');
      
      // Fix common OCR spacing issues
      const fixes = [
        [/A\s*mo\s*unt/gi, 'Amount'],
        [/To\s*tal/gi, 'Total'],
        [/Gr\s*and\s*To\s*tal/gi, 'Grand Total'],
        [/Sub\s*To\s*tal/gi, 'Sub Total'],
        [/Inv\s*o\s*ice/gi, 'Invoice'],
        [/Inv\s*No/gi, 'Invoice No'],
        [/Bill\s*No/gi, 'Bill No'],
        [/Add\s*re\s*ss/gi, 'Address'],
        [/G\s*S\s*T\s*I\s*N/gi, 'GSTIN'],
        [/C\s*G\s*ST/gi, 'CGST'],
        [/S\s*G\s*ST/gi, 'SGST'],
        [/Da\s*te/gi, 'Date'],
        [/Qua\s*li\s*ty/gi, 'Quality'],
        [/Ne\s*ar/gi, 'Near'],
        [/ma\s*rket/gi, 'market'],
        [/bus\s*st/gi, 'bus stand']
      ];

      fixes.forEach(([pattern, replacement]) => {
        line = line.replace(pattern, replacement);
      });
      // Clean punctuation spacing
      line = line.replace(/\s*:\s*/g, ': ');
      line = line.replace(/\s*-\s*/g, ' - ');
      
      // Space between letters and numbers
      line = line.replace(/([A-Za-z])(\d)/g, '$1 $2');
      line = line.replace(/(\d)([A-Za-z])/g, '$1 $2');
      
      // Normalize whitespace
      line = line.replace(/\s+/g, ' ').trim();
      
      return line;
    });

    // Filter noise
    lines = lines.filter(line => {
      const lower = line.toLowerCase();
      if (lower.includes('scanned') && lower.includes('document')) return false;
      if (lower.includes('very') && lower.includes('poor')) return false;
      if (lower.includes('poor') && lower.includes('quality')) return false;
      return line.trim().length > 0;
    });

    return lines.join('\n');
  }

  function extractLineItems(text) {
    const items = [];
    const lines = text.split('\n');
    
    lines.forEach(line => {
      // Pattern 1: Name Qty Rate Amount (with optional leading number)
      let match = line.match(/^(?:\d+[\.\)]?\s*)?([A-Za-z][A-Za-z\s\.\-]+?)\s+(\d+)\s+([\d\.]+)\s+([\d\.]+)$/);
      
      if (match) {
        items.push({
          name: match[1].trim(),
          qty: parseInt(match[2]),
          rate: parseFloat(match[3]),
          amount: parseFloat(match[4])
        });
      } else {
        // Pattern 2: Name xQty Rate Amount
        match = line.match(/^([A-Za-z][A-Za-z\s\.\-]+?)\s+x\s*(\d+)\s+([\d\.]+)\s+([\d\.]+)$/);
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

  function parseInvoiceData(text) {
    const lines = text.split('\n');
    const result = { merchant: "", date: "", total: "" };

    // Find merchant - first substantial line
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].trim();
      
      // Skip short/long lines
      if (line.length < 3 || line.length > 40) continue;
      
      // Skip keywords
      const skipWords = ['invoice', 'bill', 'receipt', 'tax', 'gst', 'date', 'total', 
                        'address', 'phone', 'email', 'www', 'http', 'scanned', 'quality'];
      if (skipWords.some(w => line.toLowerCase().includes(w))) continue;
      
      // Skip pure numbers
      if (/^\d+$/.test(line)) continue;
      
      // Skip separator lines
      if (/^[=\-_]+$/.test(line)) continue;
      
      // Must have some letters
      if (!/[a-zA-Z]/.test(line)) continue;
      
      result.merchant = line;
      break;
    }

    // Find date
    const datePatterns = [
      /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
      /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/,
      /\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        result.date = match[1];
        break;
      }
    }

    // Find total
    const totalKeywords = ['total', 'grand total', 'net amount', 'amount payable', 'amount due', 'sum'];
    const candidates = [];
    
    lines.forEach((line, idx) => {
      const lowerLine = line.toLowerCase();
      const hasKeyword = totalKeywords.some(kw => lowerLine.includes(kw));
      
      // Find all numbers in line
      const numMatches = line.match(/(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{2})?)/g);
      if (numMatches) {
        numMatches.forEach(match => {
          const numStr = match.replace(/[₹RsINR,\s]/gi, '');
          const num = parseFloat(numStr);
          if (isNaN(num) || num <= 0) return;
          
          let score = 0;
          if (hasKeyword) score += 50;
          if (num < 100000) score += 10;
          if (idx > lines.length * 0.4) score += 20;
          if (match.includes('.')) score += 5;
          
          candidates.push({ value: num, str: numStr, score });
        });
      }
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      result.total = candidates[0].str;
    }

    return result;
  }

  // ==================== PARSE & VERIFY ====================
  
  el.parseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    
    if (!el.cleanedText || !el.cleanedText.textContent || el.cleanedText.textContent === "--") {
      setStatus("Nothing to parse", true);
      return;
    }

    console.log("Parsing invoice...");
    trackEvent("invoice_parse_clicked");

    const rawText = el.cleanedText.textContent;
    parsedData = parseInvoiceData(rawText);

    // Update form fields
    if (el.editMerchant) el.editMerchant.value = parsedData.merchant || "";
    if (el.editDate) el.editDate.value = parsedData.date || "";
    if (el.editTotal) el.editTotal.value = parsedData.total || "";

    // Update items table
    if (extractedItems.length > 0) {
      if (el.itemsSection) el.itemsSection.hidden = false;
      if (el.itemsCount) {
        el.itemsCount.textContent = `${extractedItems.length} item${extractedItems.length > 1 ? 's' : ''}`;
      }
      
      if (el.itemsTableBody) {
        el.itemsTableBody.innerHTML = extractedItems.map(item => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td class="numeric">${item.qty}</td>
            <td class="numeric">₹${item.rate.toFixed(2)}</td>
            <td class="numeric">₹${item.amount.toFixed(2)}</td>
          </tr>
        `).join('');
      }
    } else {
      if (el.itemsSection) el.itemsSection.hidden = true;
    }

    // Run verification
    const verification = verifyInvoiceTotals(parsedData, rawText, extractedItems);
    console.log("Verification result:", verification);

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
        subtitle = extractedItems.length === 0 
          ? "No line items detected in document"
          : "Missing total or unclear structure";
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

      // Apply classes
      el.verificationBadge.className = "verification-badge " + statusClass;
      
      // Update content
      const badgeIcon = el.verificationBadge.querySelector('.badge-icon');
      const badgeTitle = el.verificationBadge.querySelector('.badge-title');
      
      if (badgeIcon) badgeIcon.textContent = icon;
      if (badgeTitle) badgeTitle.textContent = title;
      if (el.badgeSubtitle) el.badgeSubtitle.textContent = subtitle;
    }

    // Update JSON preview
    if (el.jsonPreview) {
      const previewData = {
        merchant: parsedData.merchant,
        date: parsedData.date,
        total: parsedData.total,
        items: extractedItems,
        verification: {
          status: verification.status,
          computedTotal: verification.computedTotal,
          declaredTotal: verification.declaredTotal,
          difference: verification.differenceAmount
        }
      };
      el.jsonPreview.textContent = JSON.stringify(previewData, null, 2);
    }
    
    hasParsedData = true;
    updateParsedUI(true);

    // Navigate to parsed page
    const parsedNav = document.querySelector('[data-page="parsed"]');
    if (parsedNav) parsedNav.click();
    
    trackEvent("invoice_parsed", { 
      merchant: parsedData.merchant,
      hasItems: extractedItems.length > 0,
      verificationStatus: verification.status
    });
  });

  // ==================== SAVE & HISTORY ====================
  
  el.saveBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    
    if (!hasParsedData || !db) {
      setStatus("Nothing to save", true);
      return;
    }

    console.log("Saving to history...");
    
    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");
    
    const record = {
      merchant: el.editMerchant?.value || "",
      date: el.editDate?.value || "",
      total: el.editTotal?.value || "",
      items: extractedItems,
      timestamp: Date.now()
    };
    
    const request = store.add(record);
    
    request.onsuccess = () => {
      console.log("Saved successfully");
      trackEvent("history_saved");
      
      if (el.saveHint) {
        el.saveHint.textContent = "✓ Saved successfully";
        setTimeout(() => el.saveHint.textContent = "", 2000);
      }
      
      loadHistory();
      updateParsedBadge();
    };
    
    request.onerror = () => {
      setStatus("Failed to save", true);
    };
  });

  // Copy preview
  el.copyPreviewBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    
    if (!el.jsonPreview) return;
    
    navigator.clipboard.writeText(el.jsonPreview.textContent).then(() => {
      const originalText = el.copyPreviewBtn.textContent;
      el.copyPreviewBtn.textContent = "Copied!";
      setTimeout(() => {
        el.copyPreviewBtn.textContent = originalText;
      }, 1500);
      
      trackEvent("preview_copied");
    });
  });

  // ==================== RECENT FILES ====================
  
  const MAX_RECENT = 4;
  const RECENT_KEY = 'anj_recent_v2';

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    } catch { 
      return []; 
    }
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
    
    // Add click handlers
    el.recentGrid.querySelectorAll('.recent-card').forEach(card => {
      card.addEventListener('click', () => {
        trackEvent("recent_item_clicked");
        // Could implement re-upload functionality here
      });
    });
  }

  function addToRecent(filename) {
    const items = loadRecent();
    const now = new Date();
    
    const newItem = {
      name: filename.length > 25 ? filename.slice(0, 22) + '...' : filename,
      fullName: filename,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    // Remove duplicates
    const filtered = items.filter(i => i.fullName !== filename);
    
    // Add new and save
    saveRecent([newItem, ...filtered]);
    renderRecent();
  }

  el.clearRecentBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(RECENT_KEY);
    renderRecent();
    trackEvent("recent_cleared");
  });

  renderRecent();

  // ==================== INDEXEDDB HISTORY ====================
  
  function initDB() {
    const req = indexedDB.open("anj-dual-ocr-v2", 1);
    
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("history")) {
        const store = db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    
    req.onsuccess = e => {
      db = e.target.result;
      console.log("Database opened");
      loadHistory();
      updateParsedBadge();
    };
    
    req.onerror = e => {
      console.error("Database failed to open:", e);
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
        // Done
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
        console.log("History item clicked:", item.id);
        
        // Populate form
        if (el.editMerchant) el.editMerchant.value = item.merchant || "";
        if (el.editDate) el.editDate.value = item.date || "";
        if (el.editTotal) el.editTotal.value = item.total || "";
        
        // Populate items
        if (item.items && item.items.length > 0) {
          extractedItems = item.items;
          if (el.itemsSection) {
            el.itemsSection.hidden = false;
          }
          if (el.itemsCount) {
            el.itemsCount.textContent = `${item.items.length} item${item.items.length > 1 ? 's' : ''}`;
          }
          if (el.itemsTableBody) {
            el.itemsTableBody.innerHTML = item.items.map(i => `
              <tr>
                <td>${escapeHtml(i.name)}</td>
                <td class="numeric">${i.qty}</td>
                <td class="numeric">₹${i.rate.toFixed(2)}</td>
                <td class="numeric">₹${i.amount.toFixed(2)}</td>
              </tr>
            `).join('');
          }
        }
        
        hasParsedData = true;
        updateParsedUI(true);
        
        // Navigate to parsed
        const parsedNav = document.querySelector('[data-page="parsed"]');
        if (parsedNav) parsedNav.click();
        
        trackEvent("history_item_loaded", { id: item.id });
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
      if (el.parsedBadge) {
        el.parsedBadge.textContent = count;
        el.parsedBadge.style.display = count > 0 ? 'flex' : 'none';
      }
    };
  }

  el.clearHistoryBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    
    if (!confirm("Clear all saved history? This cannot be undone.")) return;
    
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    
    tx.oncomplete = () => {
      loadHistory();
      updateParsedBadge();
      trackEvent("history_cleared");
    };
  });

  // History search
  el.historySearch?.addEventListener("input", e => {
    const term = e.target.value.toLowerCase().trim();
    const items = el.historyPageList?.querySelectorAll('.history-item');
    
    items?.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(term) ? '' : 'none';
    });
  });

  // ==================== EXPORT HANDLERS ====================
  
  const exportButtons = [
    { btn: el.exportJSON, type: 'json' },
    { btn: el.exportTXT, type: 'txt' },
    { btn: el.exportCSV, type: 'csv' }
  ];

  exportButtons.forEach(({ btn, type }) => {
    btn?.addEventListener("click", (e) => {
      e.preventDefault();
      trackEvent(`export_attempted_${type}`);
      setStatus("Export is a premium feature", true);
      
      // Visual feedback
      btn.style.transform = "scale(0.95)";
      setTimeout(() => btn.style.transform = "", 150);
    });
  });

  // ==================== INITIALIZE ====================
  
  initDB();
  
  console.log("App initialized successfully");
});
