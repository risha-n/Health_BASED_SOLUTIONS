import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const sampleEntries = [
  { date: "Monday", text: "My stomach started hurting after dinner, kind of burning in the upper middle. I took two Tums and it helped a little. No throwing up, just felt bloated." },
  { date: "Tuesday", text: "Woke up okay but the burning came back around 10 after coffee. It lasted maybe an hour. I skipped lunch because I felt nauseous. I take ibuprofen sometimes for knee pain." },
  { date: "Wednesday", text: "Pain was worse at night when I laid down. Maybe a 6 out of 10. No fever. I noticed sour taste in my mouth and burping." },
  { date: "Thursday", text: "I ate spicy takeout and had the same upper belly burning. Tums helped but it keeps coming back. No blood in stool, no black stool that I saw." },
  { date: "Friday", text: "I felt anxious because it has been happening all week. Pain is not crushing chest pain, more like burning under my breastbone after food. I want to ask if coffee or ibuprofen could be causing it." }
];

const processSteps = [
  { id: "capture", label: "Speak or type", detail: "Capture the patient's real words" },
  { id: "extract", label: "Extract facts", detail: "Symptoms, meds, timeline, negatives" },
  { id: "structure", label: "Build note", detail: "Doctor-ready HPI format" },
  { id: "ready", label: "Ready", detail: "Summary prepared for the visit" }
];

const languageOptions = [
  { id: "English", label: "English", speech: "en-US", sample: sampleEntries[0].text },
  { id: "Spanish", label: "Español", speech: "es-US", sample: "Me duele el estómago desde anoche después de cenar. Siento ardor y náuseas, pero no tengo fiebre." },
  { id: "Hindi", label: "हिन्दी", speech: "hi-IN", sample: "कल रात खाने के बाद से मेरे पेट में जलन और दर्द है। थोड़ा मतली जैसा लग रहा है, लेकिन बुखार नहीं है।" },
  { id: "Mandarin Chinese", label: "中文", speech: "zh-CN", sample: "昨晚吃完饭后我的胃开始疼，有灼烧感，也有点恶心，但没有发烧。" },
  { id: "Arabic", label: "العربية", speech: "ar-SA", sample: "بدأت معدتي تؤلمني بعد العشاء أمس، وأشعر بحرقة وغثيان بسيط، لكن لا توجد حمى." }
];

const useRemoteApi = new URLSearchParams(window.location.search).get("api") === "1";
const useLlmHelp = useRemoteApi || new URLSearchParams(window.location.search).get("localLlm") === "1";
const isDoctorView = window.location.pathname === "/doctor";
const HISTORY_KEY = "visitready.patientHistory";
const HELP_CHATS_KEY = "visitready.helpChats";
const helpTopics = [
  {
    id: "start",
    title: "How do I start?",
    answer: "Type what happened in the big text box, or use Start voice input if your browser supports speech-to-text. Then click Make doctor note."
  },
  {
    id: "images",
    title: "How do I add injury images?",
    answer: "Use Add images under Photo support. You can attach up to three images for rashes, swelling, bruises, cuts, or anything hard to describe."
  },
  {
    id: "history",
    title: "Where is my history?",
    answer: "Open the History tab on the right. VisitReady saves generated notes in this browser so you can come back later on the same device."
  },
  {
    id: "send",
    title: "How do I send to a doctor?",
    answer: "Make a doctor note first, attach any images you want included, then click Send to Doctor. The doctor can view it in the inbox."
  },
  {
    id: "doctor",
    title: "Where is the doctor inbox?",
    answer: "Click Open inbox, or go to /doctor. The inbox shows the structured note, raw patient words, and attached images."
  },
  {
    id: "mic",
    title: "Why is my mic not working?",
    answer: "Voice works best in Chrome. If the voice button does not start, this browser may not expose speech-to-text or microphone APIs. Open the same link in Chrome, allow microphone permission, or type the story instead."
  }
];

function getLocalHelpAnswer(question, context = "patient") {
  const lower = question.toLowerCase();
  const topicById = id => helpTopics.find(topic => topic.id === id)?.answer;

  if (/\b(image|photo|picture|rash|injury|bruise|swelling|cut|wound)\b/.test(lower)) return topicById("images");
  if (/\b(history|saved|later|come back|old note|past)\b/.test(lower)) return topicById("history");
  if (/\b(send|doctor|handoff|inbox|receive|server)\b/.test(lower)) {
    return context === "doctor" ? topicById("doctor") : `${topicById("send")} ${topicById("doctor")}`;
  }
  if (/\b(mic|microphone|voice|talk|speak|dictate|record)\b/.test(lower)) return topicById("mic");
  if (/\b(start|begin|use|demo|workflow|first)\b/.test(lower)) return topicById("start");
  if (/\b(diagnos|treat|medicine|medication|emergency|urgent|should i)\b/.test(lower)) {
    return "I can help you document what happened for a clinician, but I cannot give medical advice or diagnoses. Type the symptoms, add images if useful, make a doctor note, and contact a clinician for medical decisions.";
  }

  return "I can help with starting a note, adding injury images, finding History, sending to the doctor inbox, and microphone issues. Try asking: How do I send this to my doctor?";
}

async function askHelpBot(question, context) {
  if (!useLlmHelp) {
    await new Promise(resolve => setTimeout(resolve, 350));
    return { answer: getLocalHelpAnswer(question, context), source: "Local guide" };
  }

  try {
    const response = await fetch("/api/help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context })
    });
    const data = await response.json();
    if (data.answer) return { answer: data.answer, source: data.provider ? `${data.provider}: ${data.model}` : data.model || "LLM" };
  } catch {
    // Fall through to local guide fallback.
  }

  return { answer: getLocalHelpAnswer(question, context), source: "Local guide fallback" };
}

async function translatePatientText(text, language) {
  const trimmed = text.trim();
  if (!trimmed || language === "English" || !useLlmHelp) {
    return { translatedText: trimmed, source: language === "English" ? "Original English" : "Translation unavailable" };
  }

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, language })
    });
    const data = await response.json();
    if (data.translatedText) {
      return { translatedText: data.translatedText, source: data.provider ? `${data.provider}: ${data.model}` : "Interpreter" };
    }
  } catch {
    // Fall through to original text.
  }

  return { translatedText: trimmed, source: "Translation fallback" };
}

function getVoiceCapability() {
  const hasSpeechApi = typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasMicApi = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  return { checked: true, hasSpeechApi, hasMicApi };
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
}

function sentenceList(text) {
  return text
    .split(/[.!?]\s+/)
    .map(item => item.trim().replace(/[.!?]$/, ""))
    .filter(Boolean);
}

function localParse(text) {
  const lower = text.toLowerCase();
  const symptoms = [];
  const meds = [];
  const redFlags = [];
  const timeline = [];
  const triggers = [];
  const relief = [];
  const severity = lower.match(/\b([0-9]|10)\s*(out of 10|\/10)\b/);

  const symptomMap = [
    ["pain", /\b(pain|painful|hurt|hurting|ache|aching)\b/, /\b(no|not|denies|without)\s+\w*\s*(pain|painful|hurt|ache)\b/],
    ["burning sensation", /\b(burning|burns|burn)\b/, /\b(no|not|denies|without)\s+\w*\s*(burning|burns|burn)\b/],
    ["nausea", /\b(nauseous|nausea|queasy)\b/, /\b(no|not|denies|without)\s+\w*\s*(nauseous|nausea|queasy)\b/],
    ["bloating", /\b(bloated|bloating|full)\b/, /\b(no|not|denies|without)\s+\w*\s*(bloated|bloating)\b/],
    ["burping", /\b(burping|burp|belching)\b/, /\b(no|not|denies|without)\s+\w*\s*(burping|burp|belching)\b/],
    ["sour taste", /\b(sour taste|acid taste|bitter taste)\b/, /\b(no|not|denies|without)\s+\w*\s*(sour taste|acid taste|bitter taste)\b/],
    ["shortness of breath", /\b(short of breath|trouble breathing|breathless)\b/, /\b(no|not|denies|without)\s+\w*\s*(short of breath|trouble breathing|breathless)\b/],
    ["dizziness", /\b(dizzy|dizziness|lightheaded)\b/, /\b(no|not|denies|without)\s+\w*\s*(dizzy|dizziness|lightheaded)\b/],
    ["headache", /\b(headache|migraine)\b/, /\b(no|not|denies|without)\s+\w*\s*(headache|migraine)\b/],
    ["fatigue", /\b(fatigue|tired|exhausted)\b/, /\b(no|not|denies|without)\s+\w*\s*(fatigue|tired|exhausted)\b/],
    ["fever", /\b(fever|temperature|chills)\b/, /\b(no|not|denies|without)\s+\w*\s*(fever|temperature|chills)\b/],
    ["chest pain", /\b(chest pain|pressure in my chest|chest pressure)\b/, /\b(no|not|denies|without)\s+\w*\s*(chest pain|chest pressure|pressure in my chest)\b/],
    ["rash", /\b(rash|hives|spots|bumps)\b/, /\b(no|not|denies|without)\s+\w*\s*(rash|hives|spots|bumps)\b/],
    ["itching", /\b(itchy|itching|itches)\b/, /\b(no|not|denies|without)\s+\w*\s*(itchy|itching|itches)\b/],
    ["redness", /\b(red|redness|inflamed)\b/, /\b(no|not|denies|without)\s+\w*\s*(red|redness|inflamed)\b/],
    ["swelling", /\b(swollen|swelling|puffy)\b/, /\b(no|not|denies|without)\s+\w*\s*(swollen|swelling|puffy)\b/],
    ["bruise", /\b(bruise|bruised|bruising|purple mark)\b/, /\b(no|not|denies|without)\s+\w*\s*(bruise|bruised|bruising)\b/],
    ["cut or wound", /\b(cut|wound|scrape|scratch|bleeding)\b/, /\b(no|not|denies|without)\s+\w*\s*(cut|wound|scrape|scratch|bleeding)\b/]
  ];

  symptomMap.forEach(([label, positivePattern, negativePattern]) => {
    if (positivePattern.test(lower) && !negativePattern.test(lower)) symptoms.push(label);
  });

  if (/\b(no|not|without|denies|do not have|don't have|dont have|does not have|doesn't have)\b.{0,24}\b(fever|temperature|chills)\b/.test(lower)) {
    const feverIndex = symptoms.indexOf("fever");
    if (feverIndex >= 0) symptoms.splice(feverIndex, 1);
  }

  ["tums", "ibuprofen", "advil", "tylenol", "acetaminophen", "omeprazole", "pepcid", "metformin", "lisinopril", "coffee"].forEach(word => {
    if (lower.includes(word)) meds.push(word.replace(/^\w/, char => char.toUpperCase()));
  });

  [
    ["after meals", /\b(after eating|after dinner|after lunch|after meals|after food)\b/],
    ["coffee", /\b(coffee|caffeine)\b/],
    ["spicy food", /\b(spicy|takeout)\b/],
    ["new soap or skin product", /\b(new soap|lotion|detergent|skin product|cream)\b/],
    ["lying down", /\b(lying down|lay down|laid down|at night|bed)\b/],
    ["exercise or stairs", /\b(exercise|stairs|walking)\b/]
  ].forEach(([label, pattern]) => {
    if (pattern.test(lower)) triggers.push(label);
  });

  [
    ["Tums helped somewhat", /\b(tums).*(help|better|relief)|\b(help|better|relief).*(tums)\b/],
    ["rest helped", /\b(rest|sat down|lay down).*(help|better|relief)\b/],
    ["drinking water helped", /\b(water).*(help|better|relief)\b/]
  ].forEach(([label, pattern]) => {
    if (pattern.test(lower)) relief.push(label);
  });

  // Condense timing into short markers instead of echoing raw sentences.
  const capitalize = word => word.replace(/^\w/, char => char.toUpperCase());
  const daysFound = uniq(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      .filter(day => new RegExp(`\\b${day}\\b`, "i").test(lower))
      .map(capitalize)
  );
  const partsOfDay = uniq(["morning", "afternoon", "evening", "night"].filter(part => new RegExp(`\\b${part}\\b`, "i").test(lower)));
  const clockTimes = uniq((text.match(/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/gi) || []).map(match => match.replace(/\s+/g, " ").trim()));
  const durationMatch = lower.match(/\b(\d+)\s*(day|days|week|weeks|hour|hours|month|months)\b/);

  let onset = null;
  if (/\b(right now|just now|today|this morning|since this morning)\b/.test(lower)) onset = "started today";
  else if (/\byesterday\b/.test(lower)) onset = "started yesterday";
  else if (durationMatch) onset = `ongoing for ${durationMatch[1]} ${durationMatch[2]}`;
  else if (daysFound.length) onset = `began around ${daysFound[0]}`;

  // Canonical pertinent negatives (short, not the raw sentence).
  const negativeMap = [
    ["No fever", /\b(no fever|denies fever|no temperature|do not have a fever|don't have a fever|dont have a fever|does not have a fever|doesn't have a fever)\b/i],
    ["No blood in stool", /\b(no blood in stool|no black stool)\b/i],
    ["No vomiting", /\b(no throwing up|no vomiting|not throwing up)\b/i],
    ["No severe chest pain", /\b(not crushing chest pain|no chest pain|denies chest pain)\b/i],
    ["No shortness of breath", /\b(no trouble breathing|not short of breath|no shortness of breath)\b/i],
    ["No bleeding", /\b(no bleeding)\b/i]
  ];
  negativeMap.forEach(([label, pattern]) => { if (pattern.test(lower)) redFlags.push(label); });

  if (onset) timeline.push(`Onset: ${onset}`);
  if (daysFound.length) timeline.push(`Reported on ${daysFound.join(", ")}`);
  if (partsOfDay.length) timeline.push(`Occurs in the ${partsOfDay.join(", ")}`);
  if (clockTimes.length) timeline.push(`Noted around ${clockTimes.join(", ")}`);
  if (severity) timeline.push(`Rated severity ${severity[0]}`);
  if (triggers.length) timeline.push(`Triggers/patterns: ${uniq(triggers).join(", ")}`);
  if (relief.length) timeline.push(`Relief: ${uniq(relief).join(", ")}`);

  const symptomText = uniq(symptoms).join(", ") || "symptoms not clearly specified";
  const medText = uniq(meds).length ? ` Medications/remedies mentioned: ${uniq(meds).join(", ")}.` : " No medications or remedies clearly mentioned.";
  const timelineText = timeline.length ? ` ${timeline.slice(0, 3).join(". ")}.` : " Timing is not clearly stated.";
  const negativeText = redFlags.length ? ` Pertinent negatives: ${uniq(redFlags).join(", ")}.` : "";

  return {
    symptoms: uniq(symptoms).length ? uniq(symptoms) : ["Not clearly stated"],
    timeline: timeline.length ? timeline : ["Timing not clearly stated"],
    medications: meds.length ? uniq(meds) : ["Not mentioned"],
    redFlags: uniq(redFlags).length ? uniq(redFlags) : ["No red-flag details mentioned"],
    hpi: `Patient reports ${symptomText}.${timelineText}${medText}${negativeText}`.replace(/\.{2,}/g, "."),
    doctorQuestions: [
      "When did symptoms first start, and are they getting better or worse?",
      "What triggers or relieves the symptoms?",
      "Any fever, vomiting, weight loss, blood in stool, or severe chest pain?"
    ]
  };
}

function localVisit(entries) {
  const combined = entries.map(entry => `${entry.date}: ${entry.text}`).join(" ");
  const parsed = localParse(combined);
  return {
    ...parsed,
    hpi: "Over the past simulated week, patient reports recurrent upper abdominal or substernal burning after meals and coffee, worse when lying down, with bloating, burping, nausea, and partial relief with Tums. Patient notes intermittent ibuprofen use and denies fever, vomiting, black stool, blood in stool, and crushing chest pain in the provided entries."
  };
}

async function askServer(endpoint, payload) {
  if (!useRemoteApi) {
    await new Promise(resolve => setTimeout(resolve, 650));
    return { result: null, localOnly: true };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function postSubmission(payload) {
  const response = await fetch("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function fetchSubmissions() {
  const response = await fetch("/api/submissions");
  return response.json();
}

function SummarySection({ badge, tone, title, children }) {
  return (
    <section className={`section section-${tone}`}>
      <h3><span className={`pill ${tone}`}>{badge}</span>{title}</h3>
      {children}
    </section>
  );
}

function SummaryView({ summary }) {
  if (!summary) {
    return <div className="empty">Your doctor-ready note will appear here after you speak, type, or choose an example.</div>;
  }

  return (
    <div className="summary-view animated-panel">
      <SummarySection badge="HPI" tone="green" title="Summary"><p>{summary.hpi || "Not available"}</p></SummarySection>
      <SummarySection badge="Extracted" tone="blue" title="Symptoms"><ul>{(summary.symptoms || []).map(item => <li key={item}>{item}</li>)}</ul></SummarySection>
      <SummarySection badge="Timeline" tone="amber" title="Course"><ul>{(summary.timeline || []).map(item => <li key={item}>{item}</li>)}</ul></SummarySection>
      <SummarySection badge="Meds" tone="green" title="Mentioned"><ul>{(summary.medications || []).map(item => <li key={item}>{item}</li>)}</ul></SummarySection>
      <SummarySection badge="Prep" tone="blue" title="Likely Doctor Questions"><ul>{(summary.doctorQuestions || []).map(item => <li key={item}>{item}</li>)}</ul></SummarySection>
    </div>
  );
}

let helpMessageSeq = 0;
function nextMessageId() {
  helpMessageSeq += 1;
  return `msg-${Date.now().toString(36)}-${helpMessageSeq}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadHelpChats() {
  try {
    const chats = JSON.parse(localStorage.getItem(HELP_CHATS_KEY) || "[]");
    return Array.isArray(chats) ? chats : [];
  } catch {
    return [];
  }
}

function saveHelpChats(chats) {
  try {
    localStorage.setItem(HELP_CHATS_KEY, JSON.stringify(chats.slice(0, 30)));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function relativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function HelpBot({ context = "patient" }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState(() => loadHelpChats());
  const [showHistory, setShowHistory] = useState(false);
  const [typingDots, setTypingDots] = useState(false);
  const [asking, setAsking] = useState(false);
  const aliveRef = useRef(true);
  const threadRef = useRef(null);
  const messagesRef = useRef(messages);
  const currentIdRef = useRef(null);
  const started = messages.length > 0;
  const visibleTopics = context === "doctor"
    ? helpTopics.filter(topic => ["doctor", "send", "images"].includes(topic.id))
    : helpTopics;

  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Keep the thread scrolled to the newest message as it grows / types out.
  useEffect(() => {
    const node = threadRef.current;
    if (node && !showHistory) node.scrollTop = node.scrollHeight;
  }, [messages, typingDots, open, showHistory]);

  function persistChat(msgs) {
    if (!msgs.length) return;
    let id = currentIdRef.current;
    if (!id) {
      id = nextMessageId();
      currentIdRef.current = id;
    }
    const firstUser = msgs.find(msg => msg.role === "user");
    const title = (firstUser?.text || "New chat").slice(0, 48);
    setChats(prev => {
      const next = [{ id, title, messages: msgs, updatedAt: Date.now() }, ...prev.filter(chat => chat.id !== id)];
      saveHelpChats(next);
      return next;
    });
  }

  function startNewChat() {
    currentIdRef.current = null;
    setMessages([]);
    setQuestion("");
    setShowHistory(false);
  }

  function openChat(id) {
    const chat = chats.find(item => item.id === id);
    if (!chat) return;
    currentIdRef.current = id;
    setMessages(chat.messages);
    setShowHistory(false);
  }

  function deleteChat(id, event) {
    event.stopPropagation();
    setChats(prev => {
      const next = prev.filter(chat => chat.id !== id);
      saveHelpChats(next);
      return next;
    });
    if (currentIdRef.current === id) startNewChat();
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;

    setQuestion("");
    setShowHistory(false);
    setAsking(true);

    const userMsg = { id: nextMessageId(), role: "user", text: trimmed };
    let working = [...messagesRef.current, userMsg];
    setMessages(working);
    persistChat(working);

    const result = await askHelpBot(trimmed, context);
    if (!aliveRef.current) return;

    // Pause like a person composing a reply, then show the typing indicator.
    setTypingDots(true);
    await delay(900);
    if (!aliveRef.current) return;
    setTypingDots(false);

    // Reveal the answer character by character, like a live chat.
    const botId = nextMessageId();
    working = [...working, { id: botId, role: "bot", text: "" }];
    setMessages(working);
    const full = result.answer;
    const step = full.length > 220 ? 3 : 1;
    for (let i = step; i < full.length + step; i += step) {
      await delay(14);
      if (!aliveRef.current) return;
      const shown = full.slice(0, i);
      setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, text: shown } : msg));
    }

    const finalMsgs = working.map(msg => msg.id === botId ? { ...msg, text: full } : msg);
    persistChat(finalMsgs);
    setAsking(false);
  }

  function handleQuestionSubmit(event) {
    event.preventDefault();
    sendMessage(question);
  }

  return (
    <aside className={`helpbot ${open ? "open" : ""}`} aria-label="VisitReady help assistant">
      <button
        className="helpbot-toggle"
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-label={open ? "Close AI Guide" : "Open AI Guide"}
      >
        {open ? "✕" : "💬"}
      </button>
      {open && (
        <div className="helpbot-panel animated-panel">
          <div className="helpbot-head">
            <button
              className={`helpbot-icon-btn ${showHistory ? "active" : ""}`}
              type="button"
              onClick={() => setShowHistory(value => !value)}
              aria-label="Chat history"
              title="Chat history"
            >
              🕘
            </button>
            <h2>AI Guide</h2>
            <div className="helpbot-head-actions">
              <button className="helpbot-icon-btn" type="button" onClick={startNewChat} aria-label="New chat" title="New chat">＋</button>
              <button className="helpbot-icon-btn" type="button" onClick={() => setOpen(false)} aria-label="Close" title="Close">✕</button>
            </div>
          </div>

          {showHistory ? (
            <div className="helpbot-body helpbot-history">
              <p className="section-label">Chat history</p>
              {chats.length === 0 && <p className="helpbot-history-empty">No saved chats yet.</p>}
              {chats.map(chat => (
                <button className="helpbot-history-item" type="button" key={chat.id} onClick={() => openChat(chat.id)}>
                  <span className="helpbot-history-title">{chat.title}</span>
                  <span className="helpbot-history-meta">{relativeTime(chat.updatedAt)}</span>
                  <span className="helpbot-history-delete" role="button" aria-label="Delete chat" onClick={event => deleteChat(chat.id, event)}>✕</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="helpbot-body" ref={threadRef}>
              {!started && (
                <div className="helpbot-intro">
                  <div className="helpbot-faq">
                    <p className="section-label">Common questions</p>
                    <div className="helpbot-topics">
                      {visibleTopics.map(topic => (
                        <button type="button" key={topic.id} onClick={() => sendMessage(topic.title)}>
                          {topic.title}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="helpbot-bubble bot">Hi there 👋</div>
                  <div className="helpbot-bubble bot">What can I help you with?</div>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`helpbot-bubble ${msg.role}`}>
                  {msg.text}
                </div>
              ))}

              {typingDots && (
                <div className="helpbot-bubble bot typing" aria-label="AI Guide is typing">
                  <span></span><span></span><span></span>
                </div>
              )}
            </div>
          )}

          <form className="helpbot-form" onSubmit={handleQuestionSubmit}>
            <div>
              <input
                id={`help-question-${context}`}
                aria-label="Ask anything about using VisitReady"
                value={question}
                onChange={event => setQuestion(event.target.value)}
                placeholder="Ask anything about using VisitReady…"
              />
              <button type="submit" disabled={asking} aria-label="Send">{asking ? "…" : "↑"}</button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}

function DoctorDashboard() {
  const [submissions, setSubmissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const selected = submissions.find(item => item.id === selectedId) || submissions[0];

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await fetchSubmissions();
        if (!active) return;
        setSubmissions(data.submissions || []);
        if (!selectedId && data.submissions?.[0]) setSelectedId(data.submissions[0].id);
      } catch {
        if (active) setSubmissions([]);
      }
    }
    load();
    const timer = setInterval(load, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedId]);

  return (
    <main className="shell doctor-shell">
      <HelpBot context="doctor" />
      <section className="workspace" aria-label="Doctor inbox">
        <header className="masthead">
          <div>
            <p className="eyebrow">Doctor handoff</p>
            <h1>VisitReady Inbox</h1>
            <p className="tagline">Patient stories arrive as structured notes with optional visual context.</p>
          </div>
          <a className="nav-link" href="/">Patient view</a>
        </header>

        <div className="doctor-grid">
          <section className="input-panel inbox-list">
            <div className="panel-heading">
              <div>
                <p className="section-label">Incoming</p>
                <h2>Patient summaries</h2>
              </div>
              <span className="count-pill">{submissions.length}</span>
            </div>
            {submissions.length === 0 ? (
              <div className="empty">No patient summaries yet. Send one from the patient view.</div>
            ) : submissions.map(item => (
              <article className={`entry-card ${selected?.id === item.id ? "active" : ""}`} key={item.id}>
                <button type="button" onClick={() => setSelectedId(item.id)}>
                  <span className="meta">{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  {item.patientName} - {(item.summary?.symptoms || ["summary ready"]).slice(0, 3).join(", ")}
                </button>
              </article>
            ))}
          </section>

          <section className="output-panel">
            <div className="output-heading">
              <div>
                <p className="section-label">Clinical packet</p>
                <h2>{selected ? selected.patientName : "Awaiting patient"}</h2>
              </div>
              <div className="signal" aria-hidden="true"><span></span><span></span><span></span></div>
            </div>
            {selected ? (
              <div className="doctor-packet animated-panel">
                <SummaryView summary={selected.summary} />
                {(selected.images?.length || selected.image) && (
                  <section className="section image-section">
                    <h3><span className="pill blue">Images</span>Patient Attachments</h3>
                    <div className="image-grid">
                      {(selected.images?.length ? selected.images : [selected.image]).map(image => (
                        <figure key={image.dataUrl}>
                          <img src={image.dataUrl} alt={image.name || "Patient uploaded attachment"} />
                          <figcaption>{image.name || "Patient image"}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>
                )}
                <SummarySection badge="Raw" tone="amber" title="Patient Words">
                  <p>{selected.sourceText || "Not provided"}</p>
                </SummarySection>
              </div>
            ) : (
              <div className="empty">Open the patient view, generate a note, then send it to the doctor.</div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [entries, setEntries] = useState(sampleEntries);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entryText, setEntryText] = useState(sampleEntries[0].text);
  const [entrySummary, setEntrySummary] = useState(null);
  const [visitSummary, setVisitSummary] = useState(localVisit(sampleEntries));
  const [activeTab, setActiveTab] = useState("entry");
  const [workspaceTab, setWorkspaceTab] = useState("capture");
  const [phase, setPhase] = useState("ready");
  const [voiceHelp, setVoiceHelp] = useState("Checking voice input...");
  const [recording, setRecording] = useState(false);
  const [imageAttachments, setImageAttachments] = useState([]);
  const [history, setHistory] = useState(loadHistory);
  const [sendStatus, setSendStatus] = useState("Not sent yet");
  const [patientLanguage, setPatientLanguage] = useState("English");
  const [translatedText, setTranslatedText] = useState("");
  const [doctorEnglishText, setDoctorEnglishText] = useState(sampleEntries[0].text);
  const [translationStatus, setTranslationStatus] = useState("Interpreter idle");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceCapability, setVoiceCapability] = useState({ checked: false, hasSpeechApi: false, hasMicApi: false });
  const [showGuide, setShowGuide] = useState(false);
  const recognitionRef = useRef(null);
  const voiceButtonRef = useRef(null);

  const currentStepIndex = useMemo(() => {
    if (phase === "capture" || phase === "listening") return 0;
    if (phase === "extract") return 1;
    if (phase === "structure") return 2;
    return 3;
  }, [phase]);
  const packetStep = processSteps[currentStepIndex];

  useEffect(() => {
    const capability = getVoiceCapability();
    setVoiceCapability(capability);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      setRecording(false);
      setVoiceSupported(false);
      setVoiceHelp(capability.hasMicApi
        ? "This browser can use a microphone, but does not support browser speech-to-text. Open Chrome for voice, or type the story here."
        : "This browser does not expose microphone or speech-to-text access to this page. Open the app in Chrome for the voice demo, or type the story here.");
      return;
    }

    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageOptions.find(language => language.id === patientLanguage)?.speech || "en-US";
    recognition.onresult = event => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setEntryText(transcript.trim());
    };
    recognition.onend = () => {
      setRecording(false);
      setPhase("capture");
      setVoiceHelp("Voice input is ready. Click Start voice input, allow microphone access, then speak naturally.");
    };
    recognition.onerror = event => {
      setRecording(false);
      setPhase("capture");
      setVoiceHelp(event.error === "not-allowed"
        ? "Microphone access was blocked. Allow microphone access in the browser, then try again."
        : "Voice input stopped. You can try again or type the note instead.");
    };
    recognitionRef.current = recognition;
    setVoiceHelp("Voice input is ready. Click Start voice input, allow microphone access, then speak naturally.");
  }, [patientLanguage]);

  useEffect(() => {
    structureEntry(sampleEntries[0].text, false);
  }, []);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [workspaceTab]);

  useEffect(() => {
    const button = voiceButtonRef.current;
    if (!button) return undefined;

    const handlePress = event => {
      event.preventDefault();
      toggleVoice();
    };

    button.addEventListener("pointerdown", handlePress);
    return () => button.removeEventListener("pointerdown", handlePress);
  }, [recording, patientLanguage, voiceSupported]);

  function addHistoryItem(type, summary, sourceText, images = []) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      createdAt: new Date().toISOString(),
      summary,
      sourceText,
      images
    };
    setHistory(previous => [item, ...previous].slice(0, 20));
  }

  async function runProcess(work, animate = true) {
    // The silent sample pre-load runs work without touching the step phases,
    // so the timeline stays fully lit instead of flickering back to gray.
    if (!animate) {
      await work();
      return;
    }
    setPhase("extract");
    await new Promise(resolve => setTimeout(resolve, 320));
    setPhase("structure");
    await work();
    setPhase("ready");
  }

  async function structureEntry(text, addEntry = true) {
    const trimmed = text.trim();
    if (!trimmed) return;

    await runProcess(async () => {
      setTranslationStatus(patientLanguage === "English" ? "Original English" : "Interpreting...");
      const interpreted = await translatePatientText(trimmed, patientLanguage);
      const clinicalText = interpreted.translatedText || trimmed;
      const sourceText = patientLanguage === "English"
        ? `Doctor English: ${clinicalText}`
        : `Doctor English: ${clinicalText}\n\nOriginal (${patientLanguage}): ${trimmed}`;
      setTranslatedText(patientLanguage === "English" ? "" : clinicalText);
      setDoctorEnglishText(clinicalText);
      setTranslationStatus(interpreted.source);

      if (addEntry) {
        const liveEntry = { date: patientLanguage === "English" ? "Live demo" : `Live demo (${patientLanguage})`, text: clinicalText };
        setEntries(previous => [liveEntry, ...previous]);
        setSelectedIndex(0);
      }

      const fallback = localParse(clinicalText);
      try {
        const api = await askServer("/api/entry", { text: clinicalText });
        if (api.result) {
          setEntrySummary(api.result);
          if (addEntry) addHistoryItem("Today's note", api.result, sourceText, imageAttachments);
        } else {
          setEntrySummary(fallback);
          if (addEntry) addHistoryItem("Today's note", fallback, sourceText, imageAttachments);
        }
      } catch {
        setEntrySummary(fallback);
        if (addEntry) addHistoryItem("Today's note", fallback, sourceText, imageAttachments);
      }
      setActiveTab("entry");
      // Only jump to Review for a real user action, not the initial
      // background pre-load of the sample note.
      if (addEntry) {
        setWorkspaceTab("review");
      }
    }, addEntry);
  }

  async function generateVisit() {
    await runProcess(async () => {
      const fallback = localVisit(entries);
      try {
        const api = await askServer("/api/visit", { entries });
        if (api.result) {
          setVisitSummary(api.result);
          addHistoryItem("Visit summary", api.result, entries.map(entry => entry.text).join("\n\n"), imageAttachments);
        } else {
          setVisitSummary(fallback);
          addHistoryItem("Visit summary", fallback, entries.map(entry => entry.text).join("\n\n"), imageAttachments);
        }
      } catch {
        setVisitSummary(fallback);
        addHistoryItem("Visit summary", fallback, entries.map(entry => entry.text).join("\n\n"), imageAttachments);
      }
      setActiveTab("visit");
      setWorkspaceTab("review");
    });
  }

  function toggleVoice() {
    const capability = getVoiceCapability();
    setVoiceCapability(capability);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = recognitionRef.current;

    if (!SpeechRecognition) {
      recognitionRef.current = null;
      setVoiceSupported(false);
      setRecording(false);
      setVoiceHelp(capability.hasMicApi
        ? "This browser has microphone access but no speech-to-text API. Use Chrome for the live voice demo, or type here."
        : "This browser does not expose microphone or speech-to-text APIs. Use Chrome for the live voice demo, or type here.");
      return;
    }

    if (!recognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = languageOptions.find(language => language.id === patientLanguage)?.speech || "en-US";
      recognition.onresult = event => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0].transcript;
        }
        setEntryText(transcript.trim());
      };
      recognition.onend = () => {
        setRecording(false);
        setPhase("capture");
        setVoiceHelp("Voice input is ready. Click Start voice input, allow microphone access, then speak naturally.");
      };
      recognition.onerror = event => {
        setRecording(false);
        setPhase("capture");
        setVoiceHelp(event.error === "not-allowed"
          ? "Microphone access was blocked. Allow microphone access in the browser, then try again."
          : "Voice input stopped. You can try again or type the note instead.");
      };
      recognitionRef.current = recognition;
      setVoiceSupported(true);
    }

    if (recording) {
      recognition.stop();
      return;
    }
    try {
      setRecording(true);
      setPhase("listening");
      setVoiceHelp("Voice button pressed. Listening now, or waiting for microphone permission.");
      recognition.start();
    } catch {
      setRecording(false);
      setPhase("capture");
      setVoiceHelp("Voice input could not start in this browser. Type the note here, or open the app in Chrome for the mic demo.");
    }
  }

  function loadSample() {
    const next = (selectedIndex + 1) % entries.length;
    setSelectedIndex(next);
    setEntryText(entries[next].text);
    setPatientLanguage("English");
    setTranslatedText("");
    setDoctorEnglishText(entries[next].text);
    setTranslationStatus("Original English");
    setPhase("capture");
  }

  function loadLanguageSample() {
    const selected = languageOptions.find(language => language.id === patientLanguage) || languageOptions[0];
    setEntryText(selected.sample);
    setTranslatedText("");
    setDoctorEnglishText("");
    setTranslationStatus(patientLanguage === "English" ? "Original English" : "Sample ready for interpreter");
    setPhase("capture");
  }

  function handleImageUpload(event) {
    const files = Array.from(event.target.files || []).slice(0, 3);
    if (!files.length) return;
    if (files.some(file => !file.type.startsWith("image/"))) {
      setSendStatus("Please choose an image file.");
      return;
    }
    Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.readAsDataURL(file);
    }))).then(images => {
      setImageAttachments(previous => [...previous, ...images].slice(0, 3));
      setSendStatus(`${images.length} image${images.length === 1 ? "" : "s"} attached for doctor review.`);
      event.target.value = "";
    });
  }

  async function sendToDoctor() {
    const summary = activeTab === "visit" ? visitSummary : entrySummary;
    if (!summary) {
      setSendStatus("Make a doctor note first, then send it.");
      return;
    }

    setSendStatus("Sending to doctor...");
    const handoffSourceText = patientLanguage === "English"
      ? `Doctor English: ${doctorEnglishText || entryText}`
      : `Doctor English: ${doctorEnglishText || translatedText || "English interpretation not generated yet."}\n\nOriginal (${patientLanguage}): ${entryText}`;
    try {
      await postSubmission({
        patientName: "Demo Patient",
        summary,
        sourceText: handoffSourceText,
        image: imageAttachments[0] || null,
        images: imageAttachments
      });
      addHistoryItem("Sent to doctor", summary, handoffSourceText, imageAttachments);
      setSendStatus("Sent to doctor inbox.");
      setWorkspaceTab("handoff");
    } catch {
      setSendStatus("Could not send. Make sure the local server is running.");
    }
  }

  return (
    <main className="shell">
      <HelpBot />
      <section className="workspace" aria-label="VisitReady demo workspace">
        <header className="masthead">
          <div className="masthead-copy">
            <div className="brand-lockup" aria-label="VisitReady medical logo">
              <div className="doctor-logo" aria-hidden="true">
                <span className="doctor-logo-cross"></span>
                <span className="doctor-logo-line one"></span>
                <span className="doctor-logo-line two"></span>
              </div>
              <span>Clinical AI Intake</span>
            </div>
            <p className="eyebrow">Voice-first clinic prep</p>
            <h1>VisitReady</h1>
            <p className="tagline">Say what happened in your own words. Get a clean note for your doctor.</p>
            <div className="mission-chips" aria-label="Core capabilities">
              <span>English doctor output</span>
              <span>Images supported</span>
              <span>Local LLM ready</span>
            </div>
          </div>
          <div className="mission-visual" aria-hidden="true">
            <div className="visual-grid">
              <span></span><span></span><span></span><span></span>
              <span></span><span></span><span></span><span></span>
              <span></span><span></span><span></span><span></span>
            </div>
            <div className={`scan-panel packet-phase-${packetStep.id}`} key={packetStep.id}>
              <span>CLINICAL PACKET</span>
              <strong>{packetStep.label}</strong>
              <small>{packetStep.detail}</small>
              <div className="packet-progress" aria-hidden="true">
                {processSteps.map((step, index) => (
                  <i className={index <= currentStepIndex ? "active" : ""} key={step.id}></i>
                ))}
              </div>
              <small>{patientLanguage === "English" ? "Input: English" : `Input: ${patientLanguage}`}</small>
            </div>
            <div className="signal-rail"><i></i><i></i><i></i><i></i></div>
          </div>
        </header>

        <div className="steps" aria-label="Four step workflow">
          {processSteps.map((step, index) => (
            <div className={`step ${index <= currentStepIndex ? "active" : ""}`} key={step.id}>
              <span>{index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.detail}</small></div>
            </div>
          ))}
        </div>

        <nav className="workspace-tabs" aria-label="Workspace sections">
          {[
            ["capture", "Describe symptoms"],
            ["review", "Review"],
            ["history", "History"],
            ["handoff", "Handoff"]
          ].map(([id, label]) => (
            <button className={`workspace-tab ${workspaceTab === id ? "active" : ""}`} type="button" key={id} onClick={() => setWorkspaceTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="tab-workspace">
          <section className={`input-panel tab-panel ${workspaceTab === "capture" ? "" : "hidden"}`}>
            <div className="panel-heading">
              <div>
                <p className="section-label">Start here</p>
                <h2>Tell the story once</h2>
                <p>Use the microphone or type in the patient&apos;s strongest language.</p>
              </div>
              <button type="button" className="need-help-button" onClick={() => setShowGuide(true)}>Need help?</button>
            </div>

            <div className="language-panel">
              <div>
                <p className="section-label">Interpreter</p>
                <h3>Cross-language intake</h3>
                <p className="microcopy">Patient input can be any supported language. Doctor output is always English.</p>
              </div>
              <label>
                Patient language
                <select value={patientLanguage} onChange={event => {
                  setPatientLanguage(event.target.value);
                  setTranslatedText("");
                  setTranslationStatus(event.target.value === "English" ? "Original English" : "Interpreter ready");
                }}>
                  {languageOptions.map(language => (
                    <option value={language.id} key={language.id}>{language.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="secondary" onClick={loadLanguageSample}>Use language sample</button>
            </div>

            <div className="voice-control">
              <button
                ref={voiceButtonRef}
                className={`voice-button ${recording ? "recording" : ""}`}
                type="button"
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleVoice();
                  }
                }}
              >
                {recording ? "Stop voice input" : "Start voice input"}
              </button>
              <div className={`voice-diagnostic ${voiceCapability.hasSpeechApi ? "ok" : "blocked"}`}>
                <strong>{recording ? "Listening now" : voiceCapability.hasSpeechApi ? "Voice available" : "Voice unavailable here"}</strong>
                <span>
                  {voiceCapability.hasSpeechApi
                    ? "Tap once, allow microphone access, then speak naturally."
                    : voiceCapability.hasMicApi
                      ? "Mic exists, but browser speech-to-text is missing. Open in Chrome."
                      : "This browser blocks mic/speech APIs. Open in Chrome or type."}
                </span>
              </div>
            </div>

            <label className="sr-only" htmlFor="entryText">Patient journal entry</label>
            <textarea id="entryText" spellCheck="true" value={entryText} onChange={event => { setEntryText(event.target.value); setPhase("capture"); setTranslatedText(""); }} placeholder="Example: Me duele el estómago desde anoche, or: My stomach started hurting after dinner." />
            <div className="actions">
              <button type="button" className="secondary" onClick={loadSample}>Try another example</button>
              <button type="button" onClick={() => structureEntry(entryText)} disabled={phase === "extract" || phase === "structure"}>{phase === "extract" || phase === "structure" ? "Working..." : "Make doctor note"}</button>
            </div>
            <p className="voice-help" aria-live="polite">{voiceHelp} Interpreter: {translationStatus}.</p>
            {translatedText && (
              <section className="translation-preview animated-panel">
                <p className="section-label">Interpreter English</p>
                <p>{translatedText}</p>
              </section>
            )}

            <div className="image-upload">
              <div>
                <p className="section-label">Photo support</p>
                <h3>Add injury images</h3>
              </div>
              <label className="upload-button">
                Add images
                <input type="file" accept="image/*" multiple onChange={handleImageUpload} />
              </label>
            </div>
            {imageAttachments.length > 0 && (
              <div className="image-preview-grid animated-panel">
                {imageAttachments.map(image => (
                  <div className="image-preview" key={image.dataUrl}>
                    <img src={image.dataUrl} alt="Patient attachment preview" />
                    <div>
                      <strong>{image.name}</strong>
                      <button type="button" className="text-button" onClick={() => setImageAttachments(previous => previous.filter(item => item.dataUrl !== image.dataUrl))}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </section>

          <section className={`output-panel tab-panel ${workspaceTab === "review" ? "" : "hidden"}`}>
            <div className="output-heading">
              <div><p className="section-label">Doctor-ready output</p><h2>Clean clinical summary</h2></div>
              <div className={`signal ${phase !== "ready" ? "processing" : ""}`} aria-hidden="true"><span></span><span></span><span></span></div>
            </div>
            <div className="tabs" role="tablist" aria-label="Summary views">
              <button className={`tab ${activeTab === "entry" ? "active" : ""}`} type="button" onClick={() => setActiveTab("entry")}>Today&apos;s note</button>
              <button className={`tab ${activeTab === "visit" ? "active" : ""}`} type="button" onClick={() => setActiveTab("visit")}>Visit summary</button>
              <button className="tab" type="button" onClick={() => setWorkspaceTab("history")}>History</button>
            </div>
            <div className={activeTab === "entry" ? "" : "hidden"}><SummaryView summary={entrySummary} /></div>
            <div className={activeTab === "visit" ? "" : "hidden"}><SummaryView summary={visitSummary} /></div>
            <div className="review-actions">
              <button type="button" className="secondary" onClick={() => setWorkspaceTab("capture")}>Use voice input</button>
              <button type="button" onClick={() => setWorkspaceTab("handoff")}>Continue to handoff</button>
            </div>
          </section>

          <section className={`output-panel tab-panel ${workspaceTab === "history" ? "" : "hidden"}`}>
            <div className="output-heading">
              <div><p className="section-label">Saved notes</p><h2>Patient history</h2></div>
            </div>
            <div className="history-list animated-panel">
              {history.length === 0 ? (
                <div className="empty">No saved visit history yet. Make a note or send one to the doctor, then it will appear here.</div>
              ) : history.map(item => (
                <article className="history-card" key={item.id}>
                  <div className="history-card-head">
                    <div>
                      <span className="meta">{new Date(item.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      <h3>{item.type}</h3>
                    </div>
                    <span className="count-pill">{(item.images || []).length}</span>
                  </div>
                  <p>{item.summary?.hpi || "Summary unavailable"}</p>
                  {(item.images || []).length > 0 && (
                    <div className="image-grid compact">
                      {(item.images || []).map(image => (
                        <figure key={image.dataUrl}>
                          <img src={image.dataUrl} alt={image.name || "Saved patient attachment"} />
                          <figcaption>{image.name || "Patient image"}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className={`output-panel tab-panel ${workspaceTab === "handoff" ? "" : "hidden"}`}>
            <div className="output-heading">
              <div><p className="section-label">Doctor handoff</p><h2>Send the packet</h2></div>
            </div>
            <div className="handoff-bar handoff-focused">
              <div>
                <strong>Status</strong>
                <p>{sendStatus}</p>
              </div>
              <button type="button" onClick={sendToDoctor}>Send to Doctor</button>
              <a className="secondary-link" href="/doctor">Open inbox</a>
            </div>
            <SummaryView summary={activeTab === "visit" ? visitSummary : entrySummary} />
            {imageAttachments.length > 0 && (
              <section className="section image-section">
                <h3><span className="pill blue">Images</span>Attached Images</h3>
                <div className="image-grid">
                  {imageAttachments.map(image => (
                    <figure key={image.dataUrl}>
                      <img src={image.dataUrl} alt={image.name || "Patient attachment"} />
                      <figcaption>{image.name || "Patient image"}</figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}
            {translatedText && (
              <SummarySection badge="Lang" tone="blue" title="Interpreter Context">
                <p>Original language: {patientLanguage}. English interpretation: {translatedText}</p>
              </SummarySection>
            )}
          </section>
        </div>
      </section>

      {showGuide && (
        <div className="guide-overlay" role="dialog" aria-modal="true" aria-label="How VisitReady works" onClick={() => setShowGuide(false)}>
          <div className="guide-modal animated-panel" onClick={event => event.stopPropagation()}>
            <div className="guide-head">
              <div>
                <p className="section-label">Quick guide</p>
                <h2>How VisitReady works</h2>
              </div>
              <button type="button" className="guide-close" onClick={() => setShowGuide(false)} aria-label="Close guide">✕</button>
            </div>

            <ol className="guide-steps">
              <li><strong>Describe your symptoms.</strong> Type in the box or tap <em>Start voice input</em> and speak — in any supported language.</li>
              <li><strong>Make the doctor note.</strong> Click <em>Make doctor note</em> and VisitReady turns your words into a clean, structured summary.</li>
              <li><strong>Review it.</strong> Open the <em>Review</em> tab to check the summary and add injury photos if useful.</li>
              <li><strong>Send to your doctor.</strong> Use the <em>Handoff</em> tab to send the packet to the doctor inbox.</li>
            </ol>

            <div className="guide-examples">
              <p className="section-label">Example: a week of symptoms</p>
              <p className="microcopy">Not sure what to write? Tap any day to load it into the box and see how it works.</p>
              <div className="entries">
                {entries.map((entry, index) => (
                  <article className="entry-card" key={`guide-${entry.date}-${index}`}>
                    <button type="button" onClick={() => { setSelectedIndex(index); setEntryText(entry.text); setPhase("capture"); setWorkspaceTab("capture"); setShowGuide(false); }}>
                      <span className="meta">{entry.date}</span>{entry.text}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(isDoctorView ? <DoctorDashboard /> : <App />);
