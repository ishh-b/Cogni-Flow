import React, { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";
import * as pdfjsLib from "pdfjs-dist";

// Firebase Configuration
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
const API_ENDPOINTS = [
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, // Fallback to 1.5-pro if 2.5-flash fails
];

export default function App() {
  const [activeTab, setActiveTab] = useState("input");
  const [theme, setTheme] = useState("scheme1");
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [fileInput, setFileInput] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
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
  });
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const speechSentencesRef = useRef([]);
  const currentUtteranceRef = useRef(null);
  const endFallbackTimerRef = useRef(null);
  const [showColorPopup, setShowColorPopup] = useState(false);
  const [smartNotesColors, setSmartNotesColors] = useState({
    background: "#ffffff",
    text: "#2C3E50",
  });
  const fileInputRef = useRef(null);

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
        const extractedContent = extractTextFromContent(textContent);
        console.log("✅ Direct fetch successful, extracted length:", extractedContent?.length);
        if (extractedContent && extractedContent.length > 100) return extractedContent;
      }
    } catch (error) {
      console.log("⚠️ Direct fetch failed (expected for most sites):", error.message);
    }
    
    // Try multiple proxy services
    const proxies = [
      { name: "AllOrigins", url: "https://api.allorigins.win/get?url=", type: "allorigins" },
      { name: "CORS Anywhere (Heroku)", url: "https://cors-anywhere.herokuapp.com/", type: "direct" },
      { name: "ThingProxy", url: "https://thingproxy.freeboard.io/fetch/", type: "direct" },
    ];
    
    for (const proxy of proxies) {
      try {
        console.log(`🔄 Trying ${proxy.name}...`);
        const proxyUrl = proxy.type === "allorigins" 
          ? proxy.url + encodeURIComponent(url) 
          : proxy.url + url;
          
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
          const extractedContent = extractTextFromContent(responseData);
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

  const handleClearFile = () => {
    setFileInput(null);
    setTextInput("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const callGeminiAPI = async (endpoint, prompt) => {
    console.log("🔄 Calling Gemini API...");
    console.log("📍 Endpoint:", endpoint.split('?')[0]); // Log without API key
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.25, 
          maxOutputTokens: 8192,
          topP: 0.95,
          topK: 40
        },
      }),
    });
    
    if (!response.ok) {
      let errorText = await response.text();
      let errorDetails = "";
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
        console.error("❌ API Error Response:", errorJson);
      } catch {
        errorDetails = errorText.substring(0, 200);
        console.error("❌ API Error:", response.status, errorText);
      }
      
      throw new Error(`API failed: ${response.status} - ${errorDetails}`);
    }
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      console.error("❌ No text in API response:", data);
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
      
      const prompts = {
        notes: `Create comprehensive study notes in HTML format. IMPORTANT: Return ONLY the HTML code, no explanations or markdown. Use proper HTML tags like <div>, <h2>, <h3>, <p>, <ul>, <li>, <strong>. Make it well-structured and easy to read. Add inline styles for colors if needed. Content:\n\n${truncatedText}`,
        
        mindmap: `Create an HTML mind map with nested <div> elements. IMPORTANT: Return ONLY the HTML code, no explanations. Use inline CSS for styling (colors, borders, padding, margins). Structure it as a visual hierarchy with a main topic and branches. Content:\n\n${truncatedText}`,
        
        quiz: `Generate 10 multiple-choice questions in PURE STATIC HTML (no scripts). STRICT RULES: 1) Return ONLY HTML; 2) NO <script>, NO <style>, NO event handlers (like onclick); 3) For each question, use <div class="q"> with the question text in <strong>, followed by a <ul> of four <li> options labeled A) B) C) D); 4) Immediately after the options, include <p class="answer"><strong>Answer:</strong> X)</p> where X is the correct option letter. Use only semantic HTML. No comments, no explanations after the HTML. Content:\n\n${truncatedText}`,
        
        flashcard: `Create 10 flashcards in PURE STATIC HTML (no scripts). STRICT RULES: 1) Return ONLY HTML; 2) NO <script>, NO <style>, NO inline event handlers; 3) Structure each card as <div class="flashcard"><div class="card-front">Q...</div><div class="card-back">A...</div></div>; 4) Do NOT include any CSS transforms or rotation; 5) Keep content concise. Content:\n\n${truncatedText}`
      };

      for (const [type, prompt] of Object.entries(prompts)) {
        setGenStatus(`Generating ${type}... (may take 10-30 seconds)`);
        let success = false;
        let lastError = null;
        
        for (let i = 0; i < API_ENDPOINTS.length; i++) {
          const endpoint = API_ENDPOINTS[i];
          try {
            console.log(`\n🔄 Trying endpoint ${i + 1}/${API_ENDPOINTS.length} for ${type}`);
            const response = await callGeminiAPI(endpoint, prompt);
            
            if (!response || response.length < 100) {
              console.warn(`⚠️ Response too short for ${type}:`, response?.length);
              continue;
            }
            
            const cleanedResponse = cleanHtmlResponse(response);
            
            console.log(`\n========================================`);
            console.log(`✅ GENERATED ${type.toUpperCase()}`);
            console.log(`   Cleaned Length: ${cleanedResponse.length}`);
            console.log(`   Preview: ${cleanedResponse.substring(0, 300)}...`);
            console.log(`========================================\n`);
            
            if (!cleanedResponse || cleanedResponse.length < 50) {
              console.error(`❌ Cleaned ${type} too short!`);
              throw new Error(`Generated ${type} is too short or empty`);
            }
            
            // Set content with explicit logging
            switch (type) {
              case "notes": 
                console.log("💾 Setting NOTES content...");
                setNotesContent(cleanedResponse);
                console.log("✅ Notes content SET successfully");
                break;
              case "mindmap": 
                console.log("💾 Setting MINDMAP content...");
                setMindmapContent(cleanedResponse);
                console.log("✅ Mindmap content SET successfully");
                break;
              case "quiz": 
                console.log("💾 Setting QUIZ content...");
                {
                  const sanitizedQuiz = sanitizeHtmlForDisplay(cleanedResponse);
                  setQuizContent(sanitizedQuiz);
                }
                console.log("✅ Quiz content SET successfully");
                break;
              case "flashcard": 
                console.log("💾 Setting FLASHCARD content...");
                {
                  const sanitizedFlash = sanitizeHtmlForDisplay(cleanedResponse);
                  setFlashcardContent(sanitizedFlash);
                }
                console.log("✅ Flashcard content SET successfully");
                break;
              default:
                break;
            }
            
            success = true;
            break;
          } catch (error) {
            console.error(`❌ Endpoint ${i + 1} failed for ${type}:`, error);
            lastError = error;
            if (i < API_ENDPOINTS.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        if (!success) {
          const errorMsg = lastError?.message || 'Unknown error';
          if (errorMsg.includes('404') || errorMsg.includes('not found')) {
            throw new Error(
              `API Key Error: Your Google Gemini API key appears to be invalid or expired.\n\n` +
              `🔧 How to fix:\n` +
              `1. Go to: https://makersuite.google.com/app/apikey\n` +
              `2. Create a new API key\n` +
              `3. Replace the key in App.js (line 28)\n\n` +
              `Technical details: ${errorMsg}`
            );
          }
          throw new Error(`Failed to generate ${type}. Error: ${errorMsg}`);
        }
        
        // Small delay between content types
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log("🎉 ALL CONTENT GENERATED SUCCESSFULLY!");
      setGenStatus("✅ All materials generated successfully!");
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
    if (isGenerating) {
      alert("⏳ Please wait! Content is still generating. Don't switch tabs yet!");
      return;
    }
    window.speechSynthesis.cancel();
    resetSpeechControls();
    setActiveTab(tab);
  };

  return (
    <div className="App" data-theme={theme}>
      <div className="main-image-header">
        <img 
          src={process.env.PUBLIC_URL + "/Main-Image.gif"} 
          alt="Cogni-Flow Main Visual" 
          className="main-header-image" 
        />
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
          <button className={activeTab === "notes" ? "tab-btn active" : "tab-btn"} onClick={() => handleTabChange("notes")}>📚 Smart Notes</button>
          <button className={activeTab === "mindmap" ? "tab-btn active" : "tab-btn"} onClick={() => handleTabChange("mindmap")}>🧠 Mind Map</button>
          <button className={activeTab === "quiz" ? "tab-btn active" : "tab-btn"} onClick={() => handleTabChange("quiz")}>❓ Quiz</button>
          <button className={activeTab === "flashcard" ? "tab-btn active" : "tab-btn"} onClick={() => handleTabChange("flashcard")}>🎴 Flashcards</button>
        </nav>

        {activeTab === "input" && (
          <section className="tab-panel active">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste your text here and watch the magic happen! Upload a file or enter a link to get started..."
            />
            <div className="upload-section">
              <h3>Upload Document</h3>
              <p>Upload a document to generate notes, mind maps, quizzes, and flashcards.</p>
              <div className="upload-controls">
                <label htmlFor="file-upload" className="custom-file-upload">
                  Choose File
                </label>
                <input
                  id="file-upload"
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx"
                />
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
            {isGenerating ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '24px', fontSize: '20px', fontWeight: 'bold' }}>
                  {genStatus || '⏳ Generating your notes...'}
                </p>
                <p style={{ fontSize: '16px', opacity: 0.8, marginTop: '12px' }}>
                  Please wait 30-90 seconds. Stay on this page!
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
                <div 
                  className="content-display"
                  style={{ 
                    textAlign: settings.textAlign,
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
            {isGenerating ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '24px', fontSize: '20px', fontWeight: 'bold' }}>
                  {genStatus || '⏳ Generating your mind map...'}
                </p>
              </div>
            ) : mindmapContent ? (
              <div 
                className="content-display"
                style={{ padding: '20px', minHeight: '300px', color: '#000000' }}
                dangerouslySetInnerHTML={{ __html: mindmapContent }} 
              />
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
            {isGenerating ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '24px', fontSize: '20px', fontWeight: 'bold' }}>
                  {genStatus || '⏳ Generating your quiz...'}
                </p>
              </div>
            ) : quizContent ? (
              <div 
                className="content-display"
                style={{ padding: '20px', minHeight: '300px', color: '#000000' }}
                dangerouslySetInnerHTML={{ __html: quizContent }} 
              />
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
            {isGenerating ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '24px', fontSize: '20px', fontWeight: 'bold' }}>
                  {genStatus || '⏳ Generating your flashcards...'}
                </p>
              </div>
            ) : flashcardContent ? (
              <div
                className="flashcard-host content-display"
                style={{ padding: '20px', minHeight: '300px' }}
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
              <p className="form-help">Choose how paragraphs align across the page.</p>
              <select 
                id="taSelect"
                value={settings.textAlign} 
                onChange={(e) => setSettings({ ...settings, textAlign: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="justify">Justify</option>
                <option value="center">Center</option>
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
            <p className="form-help">
              Choose the colors for the Smart Notes content area.
            </p>
            <div className="color-picker-row">
              <div className="color-picker-control">
                <label htmlFor="bgColor">Background</label>
                <input
                  id="bgColor"
                  type="color"
                  value={smartNotesColors.background}
                  onChange={(e) =>
                    setSmartNotesColors({
                      ...smartNotesColors,
                      background: e.target.value,
                    })
                  }
                  title="Select the background color for the notes."
                />
                <input
                  type="text"
                  value={smartNotesColors.background}
                  onChange={(e) =>
                    setSmartNotesColors({
                      ...smartNotesColors,
                      background: e.target.value,
                    })
                  }
                  className="hex-input"
                  maxLength="7"
                />
              </div>
              <div className="color-picker-control">
                <label htmlFor="textColor">Text</label>
                <input
                  id="textColor"
                  type="color"
                  value={smartNotesColors.text}
                  onChange={(e) =>
                    setSmartNotesColors({
                      ...smartNotesColors,
                      text: e.target.value,
                    })
                  }
                  title="Select the text color for the notes."
                />
                <input
                  type="text"
                  value={smartNotesColors.text}
                  onChange={(e) =>
                    setSmartNotesColors({
                      ...smartNotesColors,
                      text: e.target.value,
                    })
                  }
                  className="hex-input"
                  maxLength="7"
                />
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