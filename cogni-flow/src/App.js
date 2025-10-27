import React, { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";
import * as pdfjsLib from "pdfjs-dist";

// Firebase Configuration
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// Supported output languages (UI remains English; content is generated in target language)
const LANG_OPTIONS = [
  { code: 'en', label: 'English', tts: 'en-US' },
  { code: 'hi', label: 'Hindi', tts: 'hi-IN' },
  { code: 'es', label: 'Spanish', tts: 'es-ES' },
  { code: 'fr', label: 'French', tts: 'fr-FR' },
  { code: 'de', label: 'German', tts: 'de-DE' },
  { code: 'pt', label: 'Portuguese', tts: 'pt-PT' },
  { code: 'it', label: 'Italian', tts: 'it-IT' },
  { code: 'ja', label: 'Japanese', tts: 'ja-JP' },
  { code: 'ko', label: 'Korean', tts: 'ko-KR' },
  { code: 'zh', label: 'Chinese (Simplified)', tts: 'zh-CN' },
  { code: 'ar', label: 'Arabic', tts: 'ar-SA' },
  { code: 'bn', label: 'Bengali', tts: 'bn-IN' },
  { code: 'te', label: 'Telugu', tts: 'te-IN' },
];

const firebaseConfig = {
  apiKey: "AIzaSyDyy8AM0mc9oLi8ixywP4qo2dpJp2TYG6o",
  authDomain: "cogni-flow-d41db.firebaseapp.com",
  projectId: "cogni-flow-d41db",
  storageBucket: "cogni-flow-d41db.firebasestorage.app",
  messagingSenderId: "812584499671",
  appId: "1:812584499671:web:14516059d67a937ec47392",
  measurementId: "G-5W2RWBEHLE",
};

try {
  const app = initializeApp(firebaseConfig);
  getAnalytics(app);
} catch (e) {
  console.log("Firebase init error:", e);
}

// Gemini API configuration
// ⚠️ IMPORTANT: If you get 404 errors, your API key may be invalid/expired.
// Get a new key at: https://makersuite.google.com/app/apikey
// Consider using environment variables for better security in production.
const apiKey = "AIzaSyAaiJHfFeKRrF8Wy5rqUCwhN2l3-EEi-2Q"; 

// Build a robust list of candidate endpoints across API versions and model aliases
// Dynamic endpoint resolution — probes ListModels and builds a working list for this key
const API_PREFERRED_MODELS = [
  "gemini-2.0-flash", "gemini-2.0-flash-exp",
  "gemini-1.5-flash", "gemini-1.5-flash-8b"
];
const API_VERSIONS = ["v1beta", "v1"]; // some keys only enable models on v1
const apiEndpointsRef = { current: [] };

async function resolveApiEndpoints() {
  if (apiEndpointsRef.current.length) return apiEndpointsRef.current;
  const discovered = [];
  try {
    for (const v of API_VERSIONS) {
      const url = `https://generativelanguage.googleapis.com/${v}/models?key=${apiKey}`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const models = data?.models || data?.data || [];
        for (const m of models) {
          const name = m?.name || m?.id || ""; // e.g., models/gemini-1.5-flash
          if (!name) continue;
          const modelId = name.replace(/^models\//, "");
          const lower = modelId.toLowerCase();
          const hasGen = (m?.supportedGenerationMethods || m?.generationMethods || [])
            .map(x => String(x).toLowerCase()).includes("generatecontent");
          const deprecated = (m?.state || '').toLowerCase().includes('deprecated');
          // Only include generation-capable, non-deprecated, non-pro models
          if (!hasGen || deprecated) continue;
          if (lower.includes('pro')) continue;
          discovered.push({ v, modelId });
        }
      } catch {}
    }
  } catch {}

  // Order by our preference list first, then others
  const ordered = [];
  const pushIf = (modelId, v) => {
    const endpoint = `https://generativelanguage.googleapis.com/${v}/models/${modelId}:generateContent?key=${apiKey}`;
    if (!ordered.includes(endpoint)) ordered.push(endpoint);
  };
  for (const pref of API_PREFERRED_MODELS) {
    const hits = discovered.filter(d => d.modelId.startsWith(pref));
    hits.forEach(h => pushIf(h.modelId, h.v));
  }
  // Fallbacks: any remaining discovered
  discovered.forEach(h => pushIf(h.modelId, h.v));
  // Ultimate fallback if probe failed
  if (!ordered.length) {
    for (const v of API_VERSIONS) {
      for (const m of API_PREFERRED_MODELS) pushIf(m, v);
    }
  }
  apiEndpointsRef.current = ordered;
  return ordered;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("input");
  const [outputLang, setOutputLang] = useState('en');
  const [theme, setTheme] = useState("scheme1");
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [fileInput, setFileInput] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [genProgress, setGenProgress] = useState({
    notes: 'idle',
    mindmap: 'idle',
    quiz: 'idle',
    flashcard: 'idle'
  });
  const [notesContent, setNotesContent] = useState("");
  const [mindmapContent, setMindmapContent] = useState("");
  const [quizContent, setQuizContent] = useState("");
  const [flashcardContent, setFlashcardContent] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    fontSize: 16,
    fontFamily: "Lexend, Arial, sans-serif",
    textAlign: "left",
    lineHeight: 1.5,
    letterSpacing: 0,
    bionic: false,
    fastMode: false,
  });
  const [showColorPopup, setShowColorPopup] = useState(false);
  const [flashcardColors, setFlashcardColors] = useState({ front: "", back: "", text: "#000000" });
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const speechSentencesRef = useRef([]);
  const currentUtteranceRef = useRef(null);
  const endFallbackTimerRef = useRef(null);
  const [smartNotesColors, setSmartNotesColors] = useState({
    background: "#ffffff",
    text: "#2C3E50",
  });

  const statusIcon = (s) => (s === 'done' ? '✅' : s === 'running' ? '⏳' : s === 'error' ? '⚠️' : '');
  const fileInputRef = useRef(null);
  const notesContentRef = useRef(null);
  const mindmapContentRef = useRef(null);
  const quizContentRef = useRef(null);
  const inputTextRef = useRef(null);
  const handleJumpToInput = useCallback(() => {
    setActiveTab('input');
    // Wait for tab to render
    setTimeout(() => {
      if (inputTextRef.current) {
        inputTextRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inputTextRef.current.focus();
      }
    }, 60);
  }, []);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("cogniSet");
    if (saved) setSettings(JSON.parse(saved));
  }, []);

  useEffect(() => {
    document.body.style.fontSize = `${settings.fontSize}px`;
    document.body.style.fontFamily = settings.fontFamily;
    document.body.style.lineHeight = settings.lineHeight;
    document.body.style.letterSpacing = `${settings.letterSpacing}px`;
    localStorage.setItem("cogniSet", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  // ----- PDF download helpers -----
  const loadScript = (src) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });

  const ensureHtml2Pdf = async () => {
    if (!window.html2pdf) {
      await loadScript('https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js');
    }
  };

  const downloadAsPdf = async (element, filename) => {
    if (!element) {
      showErrorDialog('Nothing to download. Generate content first.');
      return;
    }
    try {
      await ensureHtml2Pdf();
      const opt = {
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      };
      window.html2pdf().set(opt).from(element).save();
    } catch (e) {
      showErrorDialog('Failed to export PDF', e);
    }
  };

  // Initialize default flashcard colors from CSS variables
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const primary = (styles.getPropertyValue('--theme-primary-accent') || '#5BB5A2').trim();
    const secondary = (styles.getPropertyValue('--theme-secondary-accent') || '#4DD0E1').trim();
    setFlashcardColors(prev => ({
      front: prev.front || primary,
      back: prev.back || secondary,
      text: prev.text || '#000000',
    }));
  }, [theme]);

  const resetSpeechControls = useCallback(() => {
    window.speechSynthesis.cancel();
    if (endFallbackTimerRef.current) {
      clearTimeout(endFallbackTimerRef.current);
      endFallbackTimerRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentSentenceIndex(0);
    speechSentencesRef.current = [];
    currentUtteranceRef.current = null;
  }, []);

  const showErrorDialog = (msg, err) => {
    console.error(msg, err || "");
    setErrorMessage(msg + (err?.message ? `: ${err.message}` : ""));
    setShowError(true);
  };

  const cleanHtmlResponse = (response) => {
    if (!response) {
      console.error("❌ Empty response received");
      return "";
    }
    
    console.log("🔧 Cleaning response, original length:", response.length);
    let cleaned = response.trim();
    
    // Remove markdown code fences
    cleaned = cleaned.replace(/^```html\s*/i, "");
    cleaned = cleaned.replace(/^```\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/i, "");
    
    // Remove ONE set of quotes if wrapped
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1);
    }
    
    cleaned = cleaned.trim();
    
    // CRITICAL: Remove AI explanations that appear after the HTML
    // Find where actual HTML content ends (after closing </html>, </div>, or </body>)
    const htmlEndPatterns = [
      new RegExp("<\\/html>\\s*", "i"),
      new RegExp("<\\/body>\\s*", "i"),
      new RegExp("<\\/div>\\s*$", "i")
    ];
    
    for (const pattern of htmlEndPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        const endIndex = match.index + match[0].length;
        // Check if there's significant text after the HTML
        const afterHtml = cleaned.substring(endIndex).trim();
        if (afterHtml.length > 50) {
          // Likely AI explanation - cut it off
          console.log("✂️ Removing AI explanation text after HTML");
          cleaned = cleaned.substring(0, endIndex);
          break;
        }
      }
    }
    
    cleaned = cleaned.trim();
    console.log("✨ Cleaned response length:", cleaned.length);
    console.log("📝 First 200 chars:", cleaned.substring(0, 200));
    
    // Validation
    if (cleaned.length < 20) {
      console.error("⚠️ Cleaned content too short! Returning original.");
      return response;
    }
    
    return cleaned;
  };

  const sanitizeHtmlForDisplay = (html) => {
    if (!html || typeof html !== "string") return "";
    let sanitized = html;
    // Remove script and style blocks entirely
    sanitized = sanitized.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
    sanitized = sanitized.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
    // Remove inline event handlers like onclick, onchange, etc.
    sanitized = sanitized.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
    sanitized = sanitized.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
    sanitized = sanitized.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
    // Unhide elements hidden via style or hidden attribute
    sanitized = sanitized.replace(/style\s*=\s*"[^"]*display\s*:\s*none;?[^"]*"/gi, (m) => m.replace(/display\s*:\s*none;?/i, ""));
    sanitized = sanitized.replace(/style\s*=\s*'[^']*display\s*:\s*none;?[^']*'/gi, (m) => m.replace(/display\s*:\s*none;?/i, ""));
    sanitized = sanitized.replace(/\shidden(=\"?hidden\"?)?/gi, "");
    return sanitized;
  };

  const extractTextFromContent = (htmlContent) => {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlContent;
    
    // Remove script and style elements
    tempDiv.querySelectorAll('script, style').forEach(el => el.remove());

    function walk(node, builder) {
        if (node.nodeType === Node.TEXT_NODE) {
            builder.push(node.nodeValue);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toUpperCase();
            
            // Add space before block elements for separation
            if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DIV', 'BLOCKQUOTE', 'BR', 'TR'].includes(tagName)) {
                builder.push(' ');
            }

            for (let child of node.childNodes) {
                walk(child, builder);
            }
            
            // Add sentence break after block elements
            if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DIV', 'BLOCKQUOTE', 'BR', 'TR'].includes(tagName)) {
                builder.push('. ');
            }
        }
    }

    const textParts = [];
    walk(tempDiv, textParts);
    let text = textParts.join('');
    
    // Clean up whitespace, multiple periods, and other noise
    text = text.replace(/\s+/g, ' ').replace(/\s*(\.\s*)+/g, '. ').trim();
    
    console.log("📝 Extracted text for speech:", text.substring(0, 300) + "...");
    console.log("📊 Total text length:", text.length);
    console.log("--- FULL EXTRACTED TEXT ---");
    console.log(text);
    console.log("--- END FULL EXTRACTED TEXT ---");
    
    return text;
  };

  // Apply "bionic reading" emphasis to the beginning of words in HTML
  const applyBionicToHtml = (html) => {
    if (!html || typeof html !== 'string') return html;
    try {
      const container = document.createElement('div');
      container.innerHTML = html;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      const toWrap = [];
      while (true) {
        const node = walker.nextNode();
        if (!node) break;
        const parentTag = node.parentElement?.tagName?.toUpperCase();
        if (!parentTag || parentTag === 'SCRIPT' || parentTag === 'STYLE') continue;
        const text = node.nodeValue;
        if (!text || !/\w{4,}/.test(text)) continue;
        toWrap.push(node);
      }

      toWrap.forEach((textNode) => {
        const txt = textNode.nodeValue || '';
        const replaced = txt.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ]{4,})\b/g, (m) => {
          const split = Math.ceil(m.length * 0.45);
          const head = m.slice(0, split);
          const tail = m.slice(split);
          return `<strong class="bionic">${head}</strong>${tail}`;
        });
        if (replaced !== txt) {
          const span = document.createElement('span');
          span.innerHTML = replaced;
          textNode.parentNode?.replaceChild(span, textNode);
          // unwrap span to avoid extra wrappers
          while (span.firstChild) {
            span.parentNode?.insertBefore(span.firstChild, span);
          }
          span.parentNode?.removeChild(span);
        }
      });
      return container.innerHTML;
    } catch {
      return html;
    }
  };

  // Heuristic extraction of the main article content from a full web page HTML
  const extractMainContentHtmlFromPage = (rawHtml) => {
    try {
      if (!rawHtml || typeof rawHtml !== 'string') return rawHtml;
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');

      // 1) Remove obvious noise elements
      const noiseSelectors = [
        'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'form',
        'header', 'footer', 'aside', 'nav',
        'button', '.newsletter', '.subscribe', '.subscription', '.signup', '.paywall',
        '.breadcrumbs', '.breadcrumb', '.pagination', '.pager', '.share', '.social'
      ];
      doc.querySelectorAll(noiseSelectors.join(',')).forEach((el) => el.remove());

      // 2) Remove elements whose id/class looks like ads or policy banners
      const badTokens = [
        'ad', 'ads', 'advert', 'banner', 'promo', 'cookie', 'consent', 'gdpr', 'policy', 'terms',
        'related', 'recommend', 'sidebar', 'nav', 'header', 'footer', 'share', 'social'
      ];
      doc.querySelectorAll('[id], [class]').forEach((el) => {
        const signature = ((el.id || '') + ' ' + (el.className || '')).toLowerCase();
        if (badTokens.some((t) => signature.includes(t))) {
          // Avoid removing the core article containers by keeping large blocks
          const textLen = (el.textContent || '').trim().length;
          if (textLen < 1200) el.remove();
        }
      });

      // 3) Pick the best candidate node by text length
      const candidates = Array.from(
        doc.querySelectorAll(
          'article, main, [role="main"], .article, .post, .post-content, .entry-content, #content, .content, .story, .article-body, .content-body'
        )
      );
      const pickBestByText = (nodes) =>
        nodes
          .map((el) => ({ el, len: (el.innerText || '').trim().length }))
          .sort((a, b) => b.len - a.len)[0]?.el;

      let best = pickBestByText(candidates);
      if (!best) {
        const divs = Array.from(doc.querySelectorAll('div'));
        best = pickBestByText(divs);
      }
      if (!best) return rawHtml;

      // Return a minimal container HTML for downstream extraction
      const container = doc.createElement('div');
      container.appendChild(best.cloneNode(true));
      return container.innerHTML;
    } catch (e) {
      return rawHtml; // Fail open
    }
  };

  const stripIrrelevantLines = (text) => {
    if (!text) return text;
    const badPatterns = [
      /cookie/i, /consent/i, /privacy/i, /terms/i, /policy/i, /subscribe/i,
      /newsletter/i, /advert/i, /advertisement/i, /sponsored/i, /follow us/i,
      /sign\s*up/i, /contact\s*us/i, /share\s*this/i, /footer/i, /copyright/i
    ];
    return text
      .split(/\n+/)
      .filter(line => line.trim().length > 0 && !badPatterns.some(p => p.test(line)))
      .join('\n');
  };

  const fetchUrlContent = async (url) => {
    console.log("🔍 Attempting to fetch URL:", url);
    
    // Try direct fetch first
    try {
      const directResponse = await fetch(url, {
        mode: "cors",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; Cogni-Flow/1.0)",
        },
      });
      if (directResponse.ok) {
        const textContent = await directResponse.text();
        const mainHtml = extractMainContentHtmlFromPage(textContent);
        const extractedContent = extractTextFromContent(mainHtml);
        console.log("✅ Direct fetch successful, extracted length:", extractedContent?.length);
        if (extractedContent && extractedContent.length > 100) return extractedContent;
      }
    } catch (error) {
      console.log("⚠️ Direct fetch failed (expected for most sites):", error.message);
    }
    
    // Try multiple proxy services
    const proxies = [
      { name: "Jina Reader", url: "https://r.jina.ai/http/", type: "jina" },
      { name: "AllOrigins", url: "https://api.allorigins.win/get?url=", type: "allorigins" },
      { name: "CORS Anywhere (Heroku)", url: "https://cors-anywhere.herokuapp.com/", type: "direct" },
      { name: "ThingProxy", url: "https://thingproxy.freeboard.io/fetch/", type: "direct" },
    ];
    
    for (const proxy of proxies) {
      try {
        console.log(`🔄 Trying ${proxy.name}...`);
        let proxyUrl = '';
        if (proxy.type === 'allorigins') proxyUrl = proxy.url + encodeURIComponent(url);
        else proxyUrl = proxy.url + url;
          
        const response = await fetch(proxyUrl, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        
        if (!response.ok) {
          console.log(`❌ ${proxy.name} returned status ${response.status}`);
          throw new Error(`HTTP ${response.status}`);
        }
        
        let responseData;
        if (proxy.type === "allorigins") {
          const jsonResponse = await response.json();
          responseData = jsonResponse.contents;
        } else {
          responseData = await response.text();
        }

        if (responseData) {
          if (proxy.type === 'jina') {
            const cleaned = stripIrrelevantLines(responseData).trim();
            if (cleaned.length > 200) return cleaned;
          }
          const mainHtml = extractMainContentHtmlFromPage(responseData);
          const extractedContent = extractTextFromContent(mainHtml);
          console.log(`✅ ${proxy.name} successful! Extracted ${extractedContent?.length} characters`);
          if (extractedContent && extractedContent.length > 50) {
            return extractedContent;
          }
        }
      } catch (error) {
        console.log(`❌ ${proxy.name} failed:`, error.message);
      }
    }
    
    console.error("💥 All proxy attempts failed");
    throw new Error("Unable to fetch content from URL. This may be due to website restrictions. Please copy and paste the article text directly into the text box instead.");
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileInput(file);

    if (file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const pdfData = new Uint8Array(event.target.result);
          const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
          const concurrency = 4;
          let current = 1;
          const results = new Array(pdf.numPages);
          const worker = async () => {
            while (current <= pdf.numPages) {
              const pageIndex = current++;
              const page = await pdf.getPage(pageIndex);
              const text = await page.getTextContent();
              results[pageIndex - 1] = text.items.map((s) => s.str).join(" ");
            }
          };
          await Promise.all(Array.from({ length: Math.min(concurrency, pdf.numPages) }, worker));
          setTextInput(results.join(" "));
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') console.error("Failed to read PDF:", error);
          showErrorDialog("Failed to read the PDF file. It might be corrupted or protected.");
        }
      };
      reader.onerror = () => {
        showErrorDialog("Failed to read file");
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        setTextInput(content);
      };
      reader.onerror = () => {
        showErrorDialog("Failed to read file");
      };
      reader.readAsText(file);
    }
  };

  const handleClearFile = () => {
    setFileInput(null);
    setTextInput("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const processFile = async (file) => {
    if (!file) return;
    setFileInput(file);
    if (file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const pdfData = new Uint8Array(event.target.result);
          const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
          let textContent = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const text = await page.getTextContent();
            textContent += text.items.map((s) => s.str).join(" ");
          }
          setTextInput(textContent);
        } catch (error) {
          console.error("Failed to read PDF:", error);
          showErrorDialog("Failed to read the PDF file. It might be corrupted or protected.");
        }
      };
      reader.onerror = () => {
        showErrorDialog("Failed to read file");
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        setTextInput(content);
      };
      reader.onerror = () => {
        showErrorDialog("Failed to read file");
      };
      reader.readAsText(file);
    }
  };

  const callGeminiAPI = async (endpoint, prompt, overrides = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log("🔄 Calling Gemini API...");
      console.log("📍 Endpoint:", endpoint.split('?')[0]); // Log without API key
    }
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 45000); // 45s safety timeout

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: overrides.temperature ?? 0.25,
          maxOutputTokens: overrides.maxOutputTokens ?? 4096,
          topP: overrides.topP ?? 0.95,
          topK: overrides.topK ?? 40,
        },
      }),
      signal: abortController.signal,
    }).finally(() => clearTimeout(timeout));
    
    if (!response.ok) {
      let errorText = await response.text();
      let errorDetails = "";
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      if (process.env.NODE_ENV !== 'production') console.error("❌ API Error Response:", errorJson);
      } catch {
        errorDetails = errorText.substring(0, 200);
        if (process.env.NODE_ENV !== 'production') console.error("❌ API Error:", response.status, errorText);
      }
      
      throw new Error(`API failed: ${response.status} - ${errorDetails}`);
    }
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      if (process.env.NODE_ENV !== 'production') console.error("❌ No text in API response:", data);
      throw new Error("No content generated");
    }
    
    console.log("✅ API response received, length:", text.length);
    return text;
  };

  const handleGenerate = async () => {
    if (!textInput && !urlInput) {
      showErrorDialog("Please provide text, a file, or a URL");
      return;
    }
    
    setIsGenerating(true);
    setGenStatus("Processing input...");
    let sourceText = textInput;
    
    try {
      if (urlInput && !sourceText) {
        setGenStatus("Fetching content from URL...");
        try {
          sourceText = await fetchUrlContent(urlInput);
          if (!sourceText || sourceText.length < 100) {
            showErrorDialog("Could not extract enough content from URL. Try pasting text directly.");
            setIsGenerating(false);
            setGenStatus("");
            return;
          }
          setTextInput(sourceText);
        } catch (urlError) {
          console.error("URL fetch error:", urlError);
          showErrorDialog(
            "Unable to fetch content from this URL. " +
            "This can happen due to website security restrictions (CORS policy). " +
            "\n\n✅ Solution: Please copy the article text from the website and paste it directly into the text box above, then click Generate again."
          );
          setIsGenerating(false);
          setGenStatus("");
          return;
        }
      }
      
      if (!sourceText || sourceText.trim().length < 50) {
        showErrorDialog("Please provide more content (at least 50 characters)");
        setIsGenerating(false);
        setGenStatus("");
        return;
      }
      
      const truncatedText = sourceText.substring(0, 30000);
      console.log("📄 Processing text, length:", truncatedText.length);
      
      const langNote = outputLang === 'en' ? '' : `Write all output in ${outputLang}. Use natural, correct ${outputLang} vocabulary and grammar.`;
      const quickHint = `If asked for quick draft, produce a concise outline first, then extend.`;
      const prompts = {
        notes: `${langNote}\nCreate comprehensive study notes in HTML format. STRICT RULES: 1) Return ONLY HTML (no markdown, no explanations); 2) Use semantic structure with <h2> section headings and <h3> subheadings, followed by <p> paragraphs and <ul><li> bullets; 3) Include at least 5-10 bullet points across sections; 4) Do not repeat the prompt text verbatim—summarize and elaborate; 5) Highlight 5–10 critical terms or definitions using <mark> (do not overuse); 6) Use <strong> to emphasize important phrases inside bullets; 7) No external links or policy text; 8) Avoid empty sections. Content:\n\n${truncatedText}`,

        mindmap: `${langNote}\nCreate a clean, compact, COLORED HTML mind map. STRICT RULES:\n\n1) Return ONLY HTML (no scripts).\n2) Structure: <div class=\"mm-root\"><h2>Root Topic</h2><div class=\"mm-branches\"> ... nested <div class=\"mm-node\"><h3>Branch <span class=\"mm-badge\"></span></h3><ul><li>subpoint</li>...</ul><!-- optional second level --><div class=\"mm-node\"><h4>Sub-branch</h4><ul><li>detail</li></ul></div></div> ... </div></div>.\n3) Use 4–6 top-level branches; each branch provides 4–6 concise bullets (≤ 11 words). Labels must be short and scannable.\n4) Include a small <style> block at the very top that defines a cohesive, pastel color palette and applies it to branches. Use these CSS rules (use exactly these class names):\n<style>\n.mm-root{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:1040px;margin:0 auto;padding:12px}\n.mm-branches{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}\n.mm-node{background:#fff;border:1px solid #e6e8eb;border-left-width:6px;border-radius:12px;padding:12px 14px;box-shadow:0 2px 8px rgba(0,0,0,.05)}\n.mm-node h3{margin:0 0 8px 0;font-size:16px;line-height:1.3}\n.mm-node h4{margin:10px 0 6px 0;font-size:14px;color:#444}\n.mm-node ul{margin:0;padding-left:18px}\n.mm-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:9999px;background:#eef2f7;margin-left:8px;color:#334155}\n/* cohesive pastel palette for top-level nodes */\n.mm-c1{--mm-bg:#FFF1F2;--mm-border:#FB7185}.mm-c2{--mm-bg:#ECFEFF;--mm-border:#22D3EE}.mm-c3{--mm-bg:#F0FDF4;--mm-border:#34D399}.mm-c4{--mm-bg:#FEFCE8;--mm-border:#FACC15}.mm-c5{--mm-bg:#EEF2FF;--mm-border:#6366F1}.mm-c6{--mm-bg:#FAE8FF;--mm-border:#C084FC}.mm-c7{--mm-bg:#FFF7ED;--mm-border:#FB923C}.mm-c8{--mm-bg:#E0F2FE;--mm-border:#38BDF8}\n/* apply vars */\n.mm-node.mm-c1,.mm-node.mm-c2,.mm-node.mm-c3,.mm-node.mm-c4,.mm-node.mm-c5,.mm-node.mm-c6,.mm-node.mm-c7,.mm-node.mm-c8{background:var(--mm-bg);border-left-color:var(--mm-border)}\n/* children inherit colored border only for subtlety */\n.mm-node .mm-node{background:#fff;border-left-color:var(--mm-border)}\n</style>\n5) Assign classes cyclically to the TOP-LEVEL branch nodes only: mm-c1..mm-c8 in order.\n6) Under each branch title, set the badge text to \"4–6 key points\".\n7) Avoid repeating the same idea across branches; focus on key concepts and relationships. Prefer verbs and concrete nouns.\n\nContent:\n\n${truncatedText}`,

        quiz: `${langNote}\nGenerate 10 multiple-choice questions in PURE STATIC HTML (no scripts). STRICT RULES: 1) Return ONLY HTML; 2) NO <script>, NO <style>, NO event handlers (like onclick); 3) For each question, use <div class="q"> with the question text in <strong>, followed by a <ul> of four <li> options labeled A) B) C) D); 4) Immediately after the options, include <p class="answer"><strong>Answer:</strong> X)</p> where X is the correct option letter. Use only semantic HTML. No comments, no explanations after the HTML. Content:\n\n${truncatedText}`,
        
        flashcard: `${langNote}\nCreate 10 flashcards in PURE STATIC HTML (no scripts). STRICT RULES: 1) Return ONLY HTML; 2) NO <script>, NO <style>, NO inline event handlers; 3) Structure each card as <div class="flashcard"><div class="card-front">Q...</div><div class="card-back">A...</div></div>; 4) Do NOT include any CSS transforms or rotation; 5) Keep content concise. Content:\n\n${truncatedText}`
      };

      const types = Object.entries(prompts);
      const generateOne = async ([type, prompt]) => {
        setGenProgress((p) => ({ ...p, [type]: 'running' }));
        let lastError = null;
        const endpoints = await resolveApiEndpoints();
        for (let i = 0; i < endpoints.length; i++) {
          const endpoint = endpoints[i];
          try {
            // 1) Quick outline for immediate UI feedback
            const quickResp = await callGeminiAPI(
              endpoint,
              `${prompt}\n\nFIRST produce a very short outline only with section titles, using <div> and <h2>/<ul><li>> minimal structure.`,
              { maxOutputTokens: settings.fastMode ? 192 : 256 }
            );
            if (quickResp && quickResp.length > 50) {
              const quickClean = cleanHtmlResponse(quickResp);
              if (type === 'notes') {
                const sanitized = sanitizeHtmlForDisplay(quickClean);
                const maybeBionic = settings.bionic ? applyBionicToHtml(sanitized) : sanitized;
                setNotesContent(maybeBionic);
              }
              else if (type === 'mindmap') setMindmapContent(quickClean);
              else if (type === 'quiz') setQuizContent(sanitizeHtmlForDisplay(quickClean));
              else if (type === 'flashcard') setFlashcardContent(sanitizeHtmlForDisplay(quickClean));
            }

            // 2) Full version replaces the outline when ready
            const response = await callGeminiAPI(
              endpoint,
              prompt,
              { maxOutputTokens: settings.fastMode ? 2048 : 4096 }
            );
            if (!response || response.length < 100) continue;
            const cleanedResponse = cleanHtmlResponse(response);
            if (!cleanedResponse || cleanedResponse.length < 50) throw new Error('Too short');
            switch (type) {
              case 'notes': {
                const sanitized = sanitizeHtmlForDisplay(cleanedResponse);
                const maybeBionic = settings.bionic ? applyBionicToHtml(sanitized) : sanitized;
                setNotesContent(maybeBionic);
                break;
              }
              case 'mindmap': setMindmapContent(cleanedResponse); break;
              case 'quiz': setQuizContent(sanitizeHtmlForDisplay(cleanedResponse)); break;
              case 'flashcard': setFlashcardContent(sanitizeHtmlForDisplay(cleanedResponse)); break;
              default: break;
            }
            setGenProgress((p) => ({ ...p, [type]: 'done' }));
            return true;
          } catch (e) {
            const msg = (e?.message || '').toLowerCase();
            if (msg.includes('404') || msg.includes('not found') || msg.includes('not supported') || msg.includes('model')) { lastError = e; continue; }
            lastError = e;
          }
        }
        setGenProgress((p) => ({ ...p, [type]: 'error' }));
        throw lastError || new Error('Unknown error');
      };

      // Run all generations in parallel
      await Promise.all(types.map(generateOne));
      
      console.log("🎉 ALL CONTENT GENERATED SUCCESSFULLY!");
      setGenStatus("✅ All materials generated successfully!");
      setGenProgress({ notes: 'done', mindmap: 'done', quiz: 'done', flashcard: 'done' });
      setActiveTab("notes");
      setTimeout(() => setGenStatus(""), 3000);
      
    } catch (error) {
      console.error("💥 Generation error:", error);
      showErrorDialog(`Failed to generate materials: ${error.message}. Please try with shorter text or check your API quota.`, error);
      setGenStatus("");
    } finally {
      setIsGenerating(false);
    }
  };

  const splitIntoSentences = (text) => {
    if (!text || text.length === 0) {
      console.error("❌ No text to split into sentences");
      return [];
    }
    
    // Split by sentence-ending punctuation. The previous step should have added periods.
    // This regex handles sentences ending with . ! ? and followed by space or end of string.
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];
    
    const chunkByLength = (str, limit = 220) => {
      const chunks = [];
      let remaining = str.trim();
      while (remaining.length > limit) {
        let cut = remaining.lastIndexOf(' ', limit);
        if (cut < 80) cut = limit; // avoid tiny trailing chunk
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) chunks.push(remaining);
      return chunks;
    };

    const cleanedSentences = sentences
      .flatMap((s) => chunkByLength(s))
      .map((s) => s.trim())
      .filter((s) => s.length > 3); // Filter out very short fragments
    
    console.log("🔊 Split into", cleanedSentences.length, "sentences");
    cleanedSentences.slice(0, 5).forEach((s, i) => console.log(`  [${i}] "${s}"`));
    
    console.log("--- FULL SENTENCES ARRAY ---");
    console.log(JSON.stringify(cleanedSentences, null, 2));
    console.log("--- END FULL SENTENCES ARRAY ---");

    return cleanedSentences;
  };

  const initializeSpeech = () => {
    if (!notesContent) {
      showErrorDialog("No notes to read. Please generate content first.");
      return false;
    }
    const textToSpeak = extractTextFromContent(notesContent);
    if (!textToSpeak) {
      showErrorDialog("No readable text found in notes.");
      return false;
    }
    const sentences = splitIntoSentences(textToSpeak);
    if (sentences.length === 0) {
      showErrorDialog("Could not parse text into sentences.");
      return false;
    }
    speechSentencesRef.current = sentences;
    return true;
  };

  const proceedToNext = useCallback(() => {
    if (endFallbackTimerRef.current) {
      clearTimeout(endFallbackTimerRef.current);
      endFallbackTimerRef.current = null;
    }
    setCurrentSentenceIndex(i => i + 1);
  }, []);

  const speakCurrentSentence = useCallback(() => {
    const sentences = speechSentencesRef.current;
    const index = currentSentenceIndex;

    if (index >= sentences.length) {
      console.log("🎉 All sentences completed");
      resetSpeechControls();
      return;
    }

    const sentenceText = sentences[index];
    console.log(`🔊 Speaking sentence ${index + 1}/${sentences.length}: "${sentenceText.substring(0, 50)}..."`);
    
    const utterance = new SpeechSynthesisUtterance(sentenceText);
    // Pick a voice matching the selected output language when available
    try {
      const langCfg = LANG_OPTIONS.find(l => l.code === outputLang);
      if (langCfg) {
        const voices = window.speechSynthesis.getVoices?.() || [];
        const preferred = voices.find(v => v.lang?.toLowerCase().startsWith(langCfg.tts.toLowerCase().slice(0,2))) || voices.find(v => v.lang === langCfg.tts);
        if (preferred) utterance.voice = preferred;
        if (langCfg.tts) utterance.lang = langCfg.tts;
      }
    } catch {}
    utterance.rate = speechSpeed;
    utterance.pitch = 1;
    utterance.volume = 1;
    
    utterance.onend = proceedToNext;
    
    utterance.onerror = (event) => {
      console.error("❌ Speech error:", event);
      proceedToNext();
    };
    
    currentUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);

    // Fallback in case onend doesn't fire on some platforms
    const estimatedMs = Math.max(1500, (sentenceText.length / 15) * 1000 / speechSpeed);
    if (endFallbackTimerRef.current) clearTimeout(endFallbackTimerRef.current);
    endFallbackTimerRef.current = setTimeout(() => {
      console.warn("⏱️ Fallback advancing to next sentence");
      proceedToNext();
    }, estimatedMs + 500);
  }, [currentSentenceIndex, speechSpeed, resetSpeechControls, proceedToNext]);

  useEffect(() => {
    if (isPlaying && !isPaused) {
      speakCurrentSentence();
    } else {
      window.speechSynthesis.cancel();
      if (endFallbackTimerRef.current) {
        clearTimeout(endFallbackTimerRef.current);
      }
    }
  }, [currentSentenceIndex, isPlaying, isPaused, speakCurrentSentence]);

  const handlePlay = () => {
    console.log("▶️ Play button clicked");
    
    if (isPlaying && !isPaused) {
      console.log("⏹️ Stopping playback");
      resetSpeechControls();
      return;
    }
    
    if (isPaused) {
      console.log("▶️ Resuming playback");
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
      return;
    }
    
    console.log("🎬 Starting fresh playback");
    window.speechSynthesis.cancel(); 
    
    // If we're starting from scratch or re-starting, re-init
    if (currentSentenceIndex === 0) {
      if (!initializeSpeech()) {
        console.error("❌ Speech initialization failed");
        resetSpeechControls();
        return;
      }
    }
    
    console.log("✅ Speech initialized, starting playback");
    setIsPlaying(true);
    setIsPaused(false);
    // The useEffect will now trigger the speech.
  };

  const handlePause = () => {
    if (window.speechSynthesis.speaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      setIsPlaying(false);
    }
  };

  const handleRewind = () => {
    if (isPlaying || isPaused) {
      window.speechSynthesis.cancel();
      setCurrentSentenceIndex((prevIndex) => Math.max(0, prevIndex - 2));
      setTimeout(speakCurrentSentence, 120);
    }
  };

  const handleSkip = () => {
    if (isPlaying || isPaused) {
      window.speechSynthesis.cancel();
      setCurrentSentenceIndex((prevIndex) => prevIndex + 1);
      setTimeout(speakCurrentSentence, 120);
    }
  };

  const onChangeSpeed = (value) => {
    const speedValue = parseFloat(value);
    setSpeechSpeed(speedValue);
    if (isPlaying) {
      window.speechSynthesis.cancel();
      setTimeout(speakCurrentSentence, 120);
    }
  };

  const handleTabChange = (tab) => {
    // Allow switching if not generating, or if the target tab's content is done
    if (isGenerating) {
      const doneByTab = {
        notes: genProgress.notes === 'done',
        mindmap: genProgress.mindmap === 'done',
        quiz: genProgress.quiz === 'done',
        flashcard: genProgress.flashcard === 'done',
        input: true,
      };
      if (!doneByTab[tab]) {
        alert("⏳ Still generating. You can open any tab that shows ✅ in the header.");
        return;
      }
    }
    window.speechSynthesis.cancel();
    resetSpeechControls();
    setActiveTab(tab);
  };

  return (
    <div className="App" data-theme={theme}>
      <div className="main-image-header" style={{ position: 'relative' }}>
        <img 
          src={process.env.PUBLIC_URL + "/Main-Image.gif"} 
          alt="Cogni-Flow Main Visual" 
          className="main-header-image" 
        />
        <button
          onClick={handleJumpToInput}
          className="scroll-to-input-btn"
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #5BB5A2 0%, #4DD0E1 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '9999px',
            padding: '10px 16px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}
          title="Scroll down"
        >
          ↓ Scroll Down
        </button>
      </div>

      <header className="header">
        <div className="logo-container">
          <img 
            alt="Cogni-Flow Logo" 
            className="header-logo" 
            src={process.env.PUBLIC_URL + "/Header-logo.png"} 
            style={{ width: '48px', height: '48px' }}
          />
          <h1 className="header-title">CogniFlow</h1>
        </div>
        <div className="right">
          <button onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
          <button onClick={() => setShowColorPopup(true)} title="Switch Color Scheme">🎨</button>
        </div>
      </header>

      <main>
        <nav>
          <button className={activeTab === "input" ? "tab-btn active" : "tab-btn"} onClick={() => handleTabChange("input")}>📝 Input</button>
          {(() => {
            const enabled = !isGenerating || genProgress.notes === 'done';
            return (
              <button
                className={activeTab === "notes" ? "tab-btn active" : "tab-btn"}
                onClick={() => handleTabChange("notes")}
                disabled={!enabled}
                title={enabled ? "Open Smart Notes" : "Generating…"}
              >
                📚 Smart Notes {isGenerating ? statusIcon(genProgress.notes) : ''}
              </button>
            );
          })()}
          {(() => {
            const enabled = !isGenerating || genProgress.mindmap === 'done';
            return (
              <button
                className={activeTab === "mindmap" ? "tab-btn active" : "tab-btn"}
                onClick={() => handleTabChange("mindmap")}
                disabled={!enabled}
                title={enabled ? "Open Mind Map" : "Generating…"}
              >
                🧠 Mind Map {isGenerating ? statusIcon(genProgress.mindmap) : ''}
              </button>
            );
          })()}
          {(() => {
            const enabled = !isGenerating || genProgress.quiz === 'done';
            return (
              <button
                className={activeTab === "quiz" ? "tab-btn active" : "tab-btn"}
                onClick={() => handleTabChange("quiz")}
                disabled={!enabled}
                title={enabled ? "Open Quiz" : "Generating…"}
              >
                ❓ Quiz {isGenerating ? statusIcon(genProgress.quiz) : ''}
              </button>
            );
          })()}
          {(() => {
            const enabled = !isGenerating || genProgress.flashcard === 'done';
            return (
              <button
                className={activeTab === "flashcard" ? "tab-btn active" : "tab-btn"}
                onClick={() => handleTabChange("flashcard")}
                disabled={!enabled}
                title={enabled ? "Open Flashcards" : "Generating…"}
              >
                🎴 Flashcards {isGenerating ? statusIcon(genProgress.flashcard) : ''}
              </button>
            );
          })()}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="langSelect" style={{ fontSize: '12px', opacity: 0.8 }}>Language:</label>
            <select
              id="langSelect"
              value={outputLang}
              onChange={(e) => setOutputLang(e.target.value)}
              className="tab-btn"
              style={{ padding: '6px 8px' }}
            >
              {LANG_OPTIONS.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </nav>

        {activeTab === "input" && (
          <section className="tab-panel active">
            <textarea
              ref={inputTextRef}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste your text here and watch the magic happen! Upload a file or enter a link to get started..."
            />
            <div className="upload-section">
              <h3>Upload Document</h3>
              <p>Upload a document to generate notes, mind maps, quizzes, and flashcards.</p>
              <p style={{ fontSize: '13px', color: '#4b5563', marginTop: '6px' }}>
                Pro tip: results are faster and often better with smaller files (≤ 10–20 pages).
                For long PDFs, split into sections and generate per chapter.
              </p>
              <div className="upload-controls">
                <label htmlFor="file-upload" className="custom-file-upload">
                  Choose File
                </label>
                <input
                  id="file-upload"
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => processFile(e.target.files[0])}
                  accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx"
                />
                <div
                  className={"drop-zone" + (isDragging ? " dragover" : "")}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                    const files = e.dataTransfer?.files;
                    if (files && files.length > 0) processFile(files[0]);
                  }}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                >
                  or drag & drop
                </div>
                {fileInput && (
                  <div className="file-info">
                    <span>{fileInput.name}</span>
                    <button onClick={handleClearFile} className="clear-file-btn">
                      &times;
                    </button>
                  </div>
                )}
              </div>
            </div>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste a public article link here (e.g., Medium, Wikipedia, news articles)"
            />
            <p style={{ 
              fontSize: '14px', 
              color: '#666', 
              marginTop: '8px', 
              fontStyle: 'italic',
              textAlign: 'center'
            }}>
              💡 Tip: If URL fetching doesn't work, copy the article text and paste it in the text box above
            </p>
            <div className="center-btn">
              <button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? "⏳ Generating..." : "🚀 Generate Learning Materials"}
              </button>
            </div>
            {genStatus && <div id="genStatus">{genStatus}</div>}
          </section>
        )}

        {activeTab === "notes" && (
          <section className="tab-panel active">
            {(!notesContent && isGenerating) ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="loading-spinner" />
                <p style={{ marginTop: '12px', fontWeight: '600' }}>Generating materials...</p>
                <p style={{ marginTop: '8px', opacity: 0.9, fontSize: '14px' }}>
                  Notes {statusIcon(genProgress.notes)} {'  •  '}
                  Mind Map {statusIcon(genProgress.mindmap)} {'  •  '}
                  Quiz {statusIcon(genProgress.quiz)} {'  •  '}
                  Flashcards {statusIcon(genProgress.flashcard)}
                </p>
              </div>
            ) : notesContent ? (
              <>
                <div className="speech-controls">
                  <button onClick={handlePlay} className="speech-btn primary">
                    {isPlaying && !isPaused ? "⏹ Stop" : isPaused ? "▶️ Resume" : "🔊 Read Aloud"}
                  </button>
                  <button onClick={handlePause} disabled={!isPlaying || isPaused} className="speech-btn">⏸ Pause</button>
                  <button onClick={handleRewind} disabled={!isPlaying && !isPaused} className="speech-btn">⏪ Rewind</button>
                  <button onClick={handleSkip} disabled={!isPlaying && !isPaused} className="speech-btn">⏩ Skip</button>
                  <div className="speed-control">
                    <label htmlFor="speedSlider">Speed:</label>
                    <input
                      id="speedSlider"
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={speechSpeed}
                      onChange={(e) => onChangeSpeed(e.target.value)}
                    />
                    <span>{speechSpeed.toFixed(1)}x</span>
                  </div>
                </div>
                <div className="notes-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button onClick={() => downloadAsPdf(notesContentRef.current, 'Smart-Notes.pdf')}>📥 Download PDF</button>
                </div>
                {isGenerating && (
                  <div style={{ textAlign: 'center', marginTop: '8px', opacity: 0.85, fontSize: '14px' }}>
                    Mind Map {statusIcon(genProgress.mindmap)} {'  •  '}
                    Quiz {statusIcon(genProgress.quiz)} {'  •  '}
                    Flashcards {statusIcon(genProgress.flashcard)}
                  </div>
                )}
                <div 
                  className="content-display"
                  ref={notesContentRef}
                  style={{ 
                    '--content-align': settings.textAlign,
                    padding: '20px',
                    minHeight: '300px',
                    color: smartNotesColors.text,
                    background: smartNotesColors.background,
                  }} 
                  dangerouslySetInnerHTML={{ __html: notesContent }} 
                />
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <p style={{ fontSize: '20px', opacity: 0.7 }}>
                  📝 No notes generated yet.<br/>
                  Go to the <strong>Input</strong> tab and click "Generate Learning Materials"!
                </p>
              </div>
            )}
          </section>
        )}

        {activeTab === "mindmap" && (
          <section className="tab-panel active">
            {isGenerating && genProgress.mindmap !== 'done' ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="loading-spinner" />
                <p style={{ marginTop: '12px' }}>Generating mind map...</p>
              </div>
            ) : mindmapContent ? (
              <>
                <div className="speech-controls" style={{ justifyContent: 'flex-end' }}>
                  <button className="speech-btn" onClick={() => downloadAsPdf(mindmapContentRef.current, 'Mind-Map.pdf')}>📥 Download PDF</button>
                </div>
                <div 
                  className="content-display"
                  ref={mindmapContentRef}
                  style={{ padding: '20px', minHeight: '300px', color: '#000000', '--content-align': settings.textAlign }}
                  dangerouslySetInnerHTML={{ __html: mindmapContent }} 
                />
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <p style={{ fontSize: '20px', opacity: 0.7 }}>
                  🧠 No mind map yet. Generate materials first!
                </p>
              </div>
            )}
          </section>
        )}

        {activeTab === "quiz" && (
          <section className="tab-panel active">
            {isGenerating && genProgress.quiz !== 'done' ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="loading-spinner" />
                <p style={{ marginTop: '12px' }}>Generating quiz...</p>
              </div>
            ) : quizContent ? (
              <>
                <div className="speech-controls" style={{ justifyContent: 'flex-end' }}>
                  <button className="speech-btn" onClick={() => downloadAsPdf(quizContentRef.current, 'Quiz.pdf')}>📥 Download PDF</button>
                </div>
                <div 
                  className="content-display"
                  ref={quizContentRef}
                  style={{ padding: '20px', minHeight: '300px', color: '#000000', '--content-align': settings.textAlign }}
                  dangerouslySetInnerHTML={{ __html: quizContent }} 
                />
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <p style={{ fontSize: '20px', opacity: 0.7 }}>
                  ❓ No quiz yet. Generate materials first!
                </p>
              </div>
            )}
          </section>
        )}

        {activeTab === "flashcard" && (
          <section className="tab-panel active">
            {isGenerating && genProgress.flashcard !== 'done' ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="loading-spinner" />
                <p style={{ marginTop: '12px' }}>Generating flashcards...</p>
              </div>
            ) : flashcardContent ? (
              <div
                className="flashcard-host content-display"
                style={{ 
                  padding: '20px', 
                  minHeight: '300px',
                  '--flashcard-front-bg': flashcardColors.front,
                  '--flashcard-back-bg': flashcardColors.back,
                  '--flashcard-text': flashcardColors.text
                }}
                onClick={(e) => {
                  const card = e.target.closest(".flashcard");
                  if (card) card.classList.toggle("flipped");
                }}
                dangerouslySetInnerHTML={{ __html: flashcardContent }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <p style={{ fontSize: '20px', opacity: 0.7 }}>
                  🎴 No flashcards yet. Generate materials first!
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {showSettings && (
        <div className="modal-bg" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>⚙️ Settings</h2>
            <div className="form-row">
              <label htmlFor="fsRange">Font Size: {settings.fontSize}px</label>
              <p className="form-help">Controls the size of text in generated materials.</p>
              <input
                id="fsRange"
                type="range"
                min="12"
                max="24"
                value={settings.fontSize}
                onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ffSelect">Font Family</label>
              <p className="form-help">Pick a comfortable reading font.</p>
              <select 
                id="ffSelect"
                value={settings.fontFamily} 
                onChange={(e) => setSettings({ ...settings, fontFamily: e.target.value })}
              >
                <option>Lexend, Arial, sans-serif</option>
                <option>Inter, Arial, sans-serif</option>
                <option>Helvetica Neue, Helvetica, Arial, sans-serif</option>
                <option>Roboto, Arial, sans-serif</option>
                <option>Source Sans 3, Inter, Arial, sans-serif</option>
                <option>Atkinson Hyperlegible, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif</option>
                <option>Verdana, Geneva, sans-serif</option>
                <option>Georgia, Times New Roman, serif</option>
                <option>Merriweather, Georgia, serif</option>
                <option>OpenDyslexic, Arial, sans-serif</option>
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="taSelect">Text Align</label>
              <p className="form-help">Choose how text aligns in generated content.</p>
              <select 
                id="taSelect"
                value={settings.textAlign} 
                onChange={(e) => setSettings({ ...settings, textAlign: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="lhRange">Line Height: {settings.lineHeight}</label>
              <p className="form-help">Adjust vertical spacing between lines for readability.</p>
              <input
                id="lhRange"
                type="range"
                min="1.2"
                max="2.5"
                step="0.1"
                value={settings.lineHeight}
                onChange={(e) => setSettings({ ...settings, lineHeight: parseFloat(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label htmlFor="lsRange">Letter Spacing: {settings.letterSpacing}px</label>
              <p className="form-help">Adjust horizontal spacing between characters.</p>
              <input
                id="lsRange"
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={settings.letterSpacing}
                onChange={(e) => setSettings({ ...settings, letterSpacing: parseFloat(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={settings.fastMode}
                  onChange={(e) => setSettings({ ...settings, fastMode: e.target.checked })}
                />
                Fast mode (quicker drafts, fewer tokens)
              </label>
              <p className="form-help">Enable when you want faster results. Quality is preserved by a later refinement pass.</p>
            </div>
            <div className="form-row">
              <p className="form-help">Emphasize the beginning of words to aid scanning.</p>
              <label htmlFor="bionicToggle" className="checkbox-inline">
                <input
                  id="bionicToggle"
                  type="checkbox"
                  checked={settings.bionic}
                  onChange={(e) => setSettings({ ...settings, bionic: e.target.checked})}
                />
                Bionic Reading
              </label>
            </div>
            <div className="actions">
              <button onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showColorPopup && (
        <div className="modal-bg" onClick={() => setShowColorPopup(false)}>
          <div className="modal color-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>🎨 Color Settings</h2>
            <p className="form-help">Choose colors for flashcards.</p>
            <div className="color-picker-row">
              <div className="color-picker-control">
                <label htmlFor="fcFront">Flashcard Question (Front)</label>
                <input
                  id="fcFront"
                  type="color"
                  value={flashcardColors.front}
                  onChange={(e) => setFlashcardColors({ ...flashcardColors, front: e.target.value })}
                />
                <input
                  type="text"
                  value={flashcardColors.front}
                  onChange={(e) => setFlashcardColors({ ...flashcardColors, front: e.target.value })}
                  className="hex-input"
                  maxLength="7"
                />
                <p className="form-help">Background color used when showing the question.</p>
              </div>
              <div className="color-picker-control">
                <label htmlFor="fcBack">Flashcard Answer (Back)</label>
                <input
                  id="fcBack"
                  type="color"
                  value={flashcardColors.back}
                  onChange={(e) => setFlashcardColors({ ...flashcardColors, back: e.target.value })}
                />
                <input
                  type="text"
                  value={flashcardColors.back}
                  onChange={(e) => setFlashcardColors({ ...flashcardColors, back: e.target.value })}
                  className="hex-input"
                  maxLength="7"
                />
                <p className="form-help">Background color used when the card is flipped.</p>
              </div>
              <div className="color-picker-control">
                <label htmlFor="fcText">Flashcard Text</label>
                <input
                  id="fcText"
                  type="color"
                  value={flashcardColors.text}
                  onChange={(e) => setFlashcardColors({ ...flashcardColors, text: e.target.value })}
                />
                <input
                  type="text"
                  value={flashcardColors.text}
                  onChange={(e) => setFlashcardColors({ ...flashcardColors, text: e.target.value })}
                  className="hex-input"
                  maxLength="7"
                />
                <p className="form-help">Text color applied to both sides of the flashcard.</p>
              </div>
            </div>
            <div className="actions">
              <button onClick={() => setShowColorPopup(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showError && (
        <div className="modal-bg" onClick={() => setShowError(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: "#ff000d" }}>❌ Error</h2>
            <p className="mb-4" style={{ color: '#000000' }}>{errorMessage}</p>
            <button onClick={() => setShowError(false)}>Got It!</button>
          </div>
        </div>
      )}
    </div>
  );
}