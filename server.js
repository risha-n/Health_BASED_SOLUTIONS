const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = path.join(__dirname, "public");
const PRIMARY_MODEL = process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-terra";
const VALIDATOR_MODEL = process.env.OPENAI_VALIDATOR_MODEL || "gpt-5.6-luna";
const HELP_MODEL = process.env.OPENAI_HELP_MODEL || VALIDATOR_MODEL;
const LOCAL_HELP_PROVIDER = process.env.LOCAL_HELP_PROVIDER || "ollama";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || "local-model";
const doctorSubmissions = [];

const CLINICAL_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["symptoms", "timeline", "medications", "redFlags", "hpi", "doctorQuestions"],
  properties: {
    symptoms: { type: "array", items: { type: "string" } },
    timeline: { type: "array", items: { type: "string" } },
    medications: { type: "array", items: { type: "string" } },
    redFlags: { type: "array", items: { type: "string" } },
    hpi: { type: "string" },
    doctorQuestions: { type: "array", items: { type: "string" } }
  }
};

const SYSTEM_PROMPT = `You are a clinical documentation assistant for a hackathon demo.
Convert patient journal text into concise, doctor-ready structured notes.

Rules:
- Do not diagnose.
- Do not invent facts.
- Preserve uncertainty using phrases like "patient reports" and "not mentioned".
- Extract only clinically relevant information.
- Output valid JSON only, matching this schema:
{
  "symptoms": ["string"],
  "timeline": ["string"],
  "medications": ["string"],
  "redFlags": ["string"],
  "hpi": "one concise paragraph in HPI style",
  "doctorQuestions": ["string"]
}`;

const VALIDATOR_PROMPT = `You are a fast clinical note validator.
Review the source patient text and the draft JSON summary.

Return valid JSON only using the same schema.
Rules:
- Keep only facts supported by the source text.
- Remove diagnoses, unsupported claims, and invented details.
- If a field is missing or unclear, use "Not mentioned" or "Not clearly stated".
- Keep the HPI concise and useful for a doctor's visit.`;

const HELP_PROMPT = `You are the VisitReady product guide inside a hackathon demo.
Answer questions about how to use the VisitReady app.

VisitReady lets patients:
- Type or dictate symptoms in their own words.
- Create a structured doctor-ready visit note.
- Attach up to three injury images using the "Add images" button under the "Photo support" section.
- Save generated notes in the History tab on the same browser.
- Send a summary to the local doctor inbox at /doctor.
- Run for free in Live local mode, or call OpenAI only when the URL has ?api=1 and OPENAI_API_KEY is configured.

Rules:
- Be concise, warm, and practical.
- Only answer product usage, troubleshooting, and demo-flow questions.
- Use the exact VisitReady UI names above. Do not invent mobile screens, menus, camera settings, account settings, or features not listed here.
- Do not provide medical advice, diagnosis, triage, or treatment recommendations.
- If the user asks medical questions, tell them to contact a clinician and use VisitReady to document what happened.
- If browser microphone problems come up, mention Chrome, microphone permissions, and typing as a fallback.`;

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 6_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const rawPath = decodeURIComponent(req.url.split("?")[0]);
  const urlPath = rawPath === "/" || rawPath === "/doctor" ? "/index.html" : rawPath;
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json"
    }[ext] || "text/plain";

    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

async function handleSubmissions(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { submissions: doctorSubmissions });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const submission = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      patientName: body.patientName || "Demo Patient",
      summary: body.summary || null,
      sourceText: body.sourceText || "",
      image: body.image || null,
      images: Array.isArray(body.images) ? body.images.slice(0, 3) : (body.image ? [body.image] : [])
    };
    doctorSubmissions.unshift(submission);
    sendJson(res, 201, { submission });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function extractOpenAIText(payload) {
  if (payload.output_text) return payload.output_text.trim();

  return (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(content => content.type === "output_text" || content.type === "text")
    .map(content => content.text || "")
    .join("\n")
    .trim();
}

function buildUserPrompt(task, entries) {
  return task === "visit"
    ? `Generate a visit-prep summary from these dated patient journal entries:\n\n${entries.map((entry, index) => `${index + 1}. ${entry.date}: ${entry.text}`).join("\n\n")}`
    : `Convert this raw patient journal entry into the JSON structure:\n\n${entries[0].text}`;
}

function buildSourceText(entries) {
  return entries.map((entry, index) => `${index + 1}. ${entry.date || "Entry"}: ${entry.text}`).join("\n\n");
}

async function callOpenAIModel(model, instructions, input, maxOutputTokens = 1400) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "clinical_summary",
          strict: true,
          schema: CLINICAL_SUMMARY_SCHEMA
        },
        verbosity: "low"
      }
    })
  });

  if (!response.ok) {
    return { error: `OpenAI API returned ${response.status}`, detail: await response.text() };
  }

  const payload = await response.json();
  return extractOpenAIText(payload);
}

async function callOpenAIText(model, instructions, input, maxOutputTokens = 350) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: "low" },
      text: { verbosity: "low" }
    })
  });

  if (!response.ok) {
    return { error: `OpenAI API returned ${response.status}`, detail: await response.text() };
  }

  const payload = await response.json();
  return extractOpenAIText(payload);
}

async function callOllamaText(instructions, input) {
  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ]
    })
  });

  if (!response.ok) {
    return { error: `Ollama returned ${response.status}`, detail: await response.text() };
  }

  const payload = await response.json();
  return payload.message?.content?.trim() || "";
}

async function callLmStudioText(instructions, input) {
  const response = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: LM_STUDIO_MODEL,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      temperature: 0.2,
      max_tokens: 350
    })
  });

  if (!response.ok) {
    return { error: `LM Studio returned ${response.status}`, detail: await response.text() };
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

async function callLocalHelpText(instructions, input) {
  return LOCAL_HELP_PROVIDER === "lmstudio"
    ? callLmStudioText(instructions, input)
    : callOllamaText(instructions, input);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

async function callAI(task, entries) {
  if (!process.env.OPENAI_API_KEY) {
    return { error: "OPENAI_API_KEY is not set" };
  }

  const primaryRaw = await callOpenAIModel(
    PRIMARY_MODEL,
    SYSTEM_PROMPT,
    buildUserPrompt(task, entries)
  );

  if (primaryRaw.error) return primaryRaw;

  const validatorRaw = await callOpenAIModel(
    VALIDATOR_MODEL,
    VALIDATOR_PROMPT,
    `Source patient text:\n${buildSourceText(entries)}\n\nDraft JSON summary from ${PRIMARY_MODEL}:\n${primaryRaw}`,
    1200
  );

  try {
    return {
      result: parseJson(validatorRaw),
      raw: validatorRaw,
      draft: primaryRaw,
      models: {
        primary: PRIMARY_MODEL,
        validator: VALIDATOR_MODEL
      }
    };
  } catch (error) {
    return {
      result: null,
      raw: validatorRaw,
      draft: primaryRaw,
      error: `Validator returned invalid JSON: ${error.message}`,
      models: {
        primary: PRIMARY_MODEL,
        validator: VALIDATOR_MODEL
      }
    };
  }
}

async function handleHelp(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const question = String(body.question || "").trim();
    const context = body.context === "doctor" ? "doctor inbox" : "patient app";

    if (!question) {
      sendJson(res, 400, { error: "Question is required" });
      return;
    }

    const prompt = `Current screen: ${context}\nUser question: ${question}`;
    const answer = process.env.OPENAI_API_KEY
      ? await callOpenAIText(HELP_MODEL, HELP_PROMPT, prompt)
      : await callLocalHelpText(HELP_PROMPT, prompt);

    if (answer.error) {
      sendJson(res, 502, answer);
      return;
    }

    sendJson(res, 200, {
      answer,
      model: process.env.OPENAI_API_KEY ? HELP_MODEL : (LOCAL_HELP_PROVIDER === "lmstudio" ? LM_STUDIO_MODEL : OLLAMA_MODEL),
      provider: process.env.OPENAI_API_KEY ? "OpenAI" : LOCAL_HELP_PROVIDER
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const task = req.url.includes("/visit") ? "visit" : "entry";
    const entries = Array.isArray(body.entries) ? body.entries : [{ text: body.text || "" }];
    sendJson(res, 200, await callAI(task, entries));
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/submissions")) {
    handleSubmissions(req, res);
    return;
  }

  if (req.url.startsWith("/api/help")) {
    handleHelp(req, res);
    return;
  }

  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Clinical demo running at http://${HOST}:${PORT}`);
  console.log(
    process.env.OPENAI_API_KEY
      ? `OpenAI models: ${PRIMARY_MODEL} + ${VALIDATOR_MODEL}`
      : "Demo parser active: set OPENAI_API_KEY to call OpenAI."
  );
});
