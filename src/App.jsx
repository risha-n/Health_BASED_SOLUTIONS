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

const useRemoteApi = new URLSearchParams(window.location.search).get("api") === "1";
const useLlmHelp = useRemoteApi || new URLSearchParams(window.location.search).get("localLlm") === "1";
const isDoctorView = window.location.pathname === "/doctor";
const HISTORY_KEY = "visitready.patientHistory";
const HELP_CHATS_KEY = "visitready.helpChats";
const helpTopics = [
  {
    id: "start",
    title: "How do I start?",
    answer: "Type what happened in the big text box, or use the Mic button if your browser supports voice. Then click Make doctor note."
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
    answer: "Voice works best in Chrome. If the mic does not start, allow microphone permission in the browser or type the story instead."
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

  sentenceList(text).forEach(sentence => {
    if (/\b(monday|tuesday|wednesday|thursday|friday|yesterday|today|night|morning|after|around|week|days)\b/i.test(sentence)) {
      timeline.push(sentence);
    }
    if (/\b(no fever|no blood|no bleeding|no black stool|no throwing up|not crushing chest pain|no trouble breathing|not short of breath|denies fever|denies chest pain)\b/i.test(sentence)) {
      redFlags.push(sentence);
    }
  });

  if (severity) timeline.push(`Patient rated severity as ${severity[0]}`);
  if (triggers.length) timeline.push(`Reported triggers/patterns: ${uniq(triggers).join(", ")}`);
  if (relief.length) timeline.push(`Reported relief: ${uniq(relief).join(", ")}`);

  const symptomText = uniq(symptoms).join(", ") || "symptoms not clearly specified";
  const medText = uniq(meds).length ? ` Mentions ${uniq(meds).join(", ")}.` : " No medications or remedies clearly mentioned.";
  const timelineText = timeline.length ? ` Pattern: ${timeline.slice(0, 2).join("; ")}.` : " Timing is not clearly stated.";
  const negativeText = redFlags.length ? ` Pertinent negatives include: ${redFlags.join("; ")}.` : "";

  return {
    symptoms: uniq(symptoms).length ? uniq(symptoms) : ["Not clearly stated"],
    timeline: timeline.length ? timeline : ["Timing not clearly stated"],
    medications: meds.length ? uniq(meds) : ["Not mentioned"],
    redFlags: redFlags.length ? redFlags : ["No red-flag details mentioned"],
    hpi: `Patient reports ${symptomText}.${timelineText}${medText}${negativeText} Source statement: ${text.trim()}`,
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
  const [phase, setPhase] = useState("ready");
  const [voiceHelp, setVoiceHelp] = useState("Checking voice input...");
  const [recording, setRecording] = useState(false);
  const [imageAttachments, setImageAttachments] = useState([]);
  const [history, setHistory] = useState(loadHistory);
  const [sendStatus, setSendStatus] = useState("Not sent yet");
  const recognitionRef = useRef(null);

  const currentStepIndex = useMemo(() => {
    if (phase === "capture" || phase === "listening") return 0;
    if (phase === "extract") return 1;
    if (phase === "structure") return 2;
    return 3;
  }, [phase]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceHelp("Voice input is not available in this browser. For the live mic demo, open this app in Chrome and allow microphone access.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
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
      setVoiceHelp("Voice input is ready. Click Mic, allow microphone access, then speak naturally.");
    };
    recognition.onerror = event => {
      setRecording(false);
      setPhase("capture");
      setVoiceHelp(event.error === "not-allowed"
        ? "Microphone access was blocked. Allow microphone access in the browser, then try again."
        : "Voice input stopped. You can try again or type the note instead.");
    };
    recognitionRef.current = recognition;
    setVoiceHelp("Voice input is ready. Click Mic, allow microphone access, then speak naturally.");
  }, []);

  useEffect(() => {
    structureEntry(sampleEntries[0].text, false);
  }, []);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

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

  async function runProcess(work) {
    setPhase("extract");
    await new Promise(resolve => setTimeout(resolve, 320));
    setPhase("structure");
    await work();
    setPhase("ready");
  }

  async function structureEntry(text, addEntry = true) {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (addEntry) {
      const liveEntry = { date: "Live demo", text: trimmed };
      setEntries(previous => [liveEntry, ...previous]);
      setSelectedIndex(0);
    }

    await runProcess(async () => {
      const fallback = localParse(trimmed);
      try {
        const api = await askServer("/api/entry", { text: trimmed });
        if (api.result) {
          setEntrySummary(api.result);
          if (addEntry) addHistoryItem("Today's note", api.result, trimmed, imageAttachments);
        } else {
          setEntrySummary(fallback);
          if (addEntry) addHistoryItem("Today's note", fallback, trimmed, imageAttachments);
        }
      } catch {
        setEntrySummary(fallback);
        if (addEntry) addHistoryItem("Today's note", fallback, trimmed, imageAttachments);
      }
      setActiveTab("entry");
    });
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
    });
  }

  function toggleVoice() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setVoiceHelp("Voice input could not start in this browser. Type the note here, or open the app in Chrome for the mic demo.");
      return;
    }
    if (recording) {
      recognition.stop();
      return;
    }
    try {
      setRecording(true);
      setPhase("listening");
      setVoiceHelp("Listening now. Speak your patient story, then click Stop.");
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
    try {
      await postSubmission({
        patientName: "Demo Patient",
        summary,
        sourceText: entryText,
        image: imageAttachments[0] || null,
        images: imageAttachments
      });
      addHistoryItem("Sent to doctor", summary, entryText, imageAttachments);
      setSendStatus("Sent to doctor inbox.");
    } catch {
      setSendStatus("Could not send. Make sure the local server is running.");
    }
  }

  return (
    <main className="shell">
      <HelpBot />
      <section className="workspace" aria-label="VisitReady demo workspace">
        <header className="masthead">
          <div>
            <p className="eyebrow">Voice-first clinic prep</p>
            <h1>VisitReady</h1>
            <p className="tagline">Say what happened in your own words. Get a clean note for your doctor.</p>
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

        <div className="grid">
          <section className="input-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">Start here</p>
                <h2>Tell the story once</h2>
                <p>Use the microphone or type like you are talking to a friend.</p>
              </div>
              <button className={`icon-button ${recording ? "recording" : ""}`} type="button" onClick={toggleVoice} title={recording ? "Stop voice input" : "Start voice input"} aria-label={recording ? "Stop voice input" : "Start voice input"}>
                <span aria-hidden="true">{recording ? "Stop" : "Mic"}</span>
              </button>
            </div>

            <label className="sr-only" htmlFor="entryText">Patient journal entry</label>
            <textarea id="entryText" spellCheck="true" value={entryText} onChange={event => { setEntryText(event.target.value); setPhase("capture"); }} placeholder="Example: My stomach started hurting after dinner. It felt like burning. I took Tums and it helped a little." />
            <div className="actions">
              <button type="button" className="secondary" onClick={loadSample}>Try another example</button>
              <button type="button" onClick={() => structureEntry(entryText)} disabled={phase === "extract" || phase === "structure"}>{phase === "extract" || phase === "structure" ? "Working..." : "Make doctor note"}</button>
            </div>
            <p className="voice-help" aria-live="polite">{voiceHelp}</p>

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

            <div className="pipeline" aria-label="Current processing state">
              {processSteps.slice(1).map((step, index) => (
                <div className={`pipeline-node ${index + 1 <= currentStepIndex ? "on" : ""}`} key={step.id}>
                  <span></span><p>{step.label}</p>
                </div>
              ))}
            </div>

            <div className="entries-header">
              <div><p className="section-label">Saved examples</p><h3>This week</h3></div>
              <button type="button" className="secondary" onClick={generateVisit} disabled={phase === "extract" || phase === "structure"}>Prepare visit</button>
            </div>
            <div className="entries">
              {entries.map((entry, index) => (
                <article className={`entry-card ${index === selectedIndex ? "active" : ""}`} key={`${entry.date}-${index}`}>
                  <button type="button" onClick={() => { setSelectedIndex(index); setEntryText(entry.text); setPhase("capture"); }}>
                    <span className="meta">{entry.date}</span>{entry.text}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="output-panel">
            <div className="output-heading">
              <div><p className="section-label">Doctor-ready output</p><h2>Clean clinical summary</h2></div>
              <div className={`signal ${phase !== "ready" ? "processing" : ""}`} aria-hidden="true"><span></span><span></span><span></span></div>
            </div>
            <div className="tabs" role="tablist" aria-label="Summary views">
              <button className={`tab ${activeTab === "entry" ? "active" : ""}`} type="button" onClick={() => setActiveTab("entry")}>Today&apos;s note</button>
              <button className={`tab ${activeTab === "visit" ? "active" : ""}`} type="button" onClick={() => setActiveTab("visit")}>Visit summary</button>
              <button className={`tab ${activeTab === "history" ? "active" : ""}`} type="button" onClick={() => setActiveTab("history")}>History</button>
            </div>
            <div className="handoff-bar">
              <div>
                <strong>Doctor handoff</strong>
                <p>{sendStatus}</p>
              </div>
              <button type="button" onClick={sendToDoctor}>Send to Doctor</button>
              <a className="secondary-link" href="/doctor">Open inbox</a>
            </div>
            <div className={activeTab === "entry" ? "" : "hidden"}><SummaryView summary={entrySummary} /></div>
            <div className={activeTab === "visit" ? "" : "hidden"}><SummaryView summary={visitSummary} /></div>
            <div className={activeTab === "history" ? "" : "hidden"}>
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
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(isDoctorView ? <DoctorDashboard /> : <App />);
