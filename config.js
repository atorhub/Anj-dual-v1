config_js_content = '''/**
 * ANJ Invoice OCR - Configuration
 * Switch between local mode and API mode
 */

const CONFIG = {
  // Current mode: 'local' or 'api'
  // 'local' = uses IndexedDB, no backend needed
  // 'api' = connects to backend server (when you're ready)
  MODE: 'local',
  
  // API Configuration (used when MODE: 'api')
  API: {
    BASE_URL: window.location.hostname === 'localhost' 
      ? 'http://localhost:3000/api/v1'
      : 'https://api.anj-invoice.com/api/v1',
    TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
  },
  
  // Local storage configuration
  STORAGE: {
    PREFIX: 'anj_',
    MAX_RECENT: 4,
    MAX_HISTORY: 100,
  },
  
  // File upload limits
  UPLOAD: {
    MAX_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_TYPES: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  },
  
  // Feature flags - these enable/disable features
  FEATURES: {
    ENABLE_SYNC: false,        // Enable cloud sync (needs backend)
    ENABLE_EXPORT: false,      // Enable export features (premium)
    ENABLE_SHARING: false,     // Enable invoice sharing (needs backend)
    ENABLE_ANALYTICS: false,   // Enable usage analytics
  },
};

// Make available globally so script.js can use it
window.ANJ_CONFIG = CONFIG;
'''

print("✅ NEW FILE: config.js")
print("   This is a NEW file you must create")
print("   Save as: config.js (in same folder as index.html)")
print()
print("📋 SUMMARY OF FILES:")
print("   REPLACE these existing files:")
print("   1. index.html → Use the new complete version above")
print("   2. script.js → Will provide complete version next")
print()
print("   KEEP these files as-is:")
print("   3. style.css → No changes needed (your themes are perfect)")
print("   4. invoiceVerification.js → No changes needed (your logic is good)")
print()
print("   CREATE this new file:")
print("   5. config.js → Mode switcher for local/api")
      
