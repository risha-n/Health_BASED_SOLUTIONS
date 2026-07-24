# VisitReady

A 48-hour hackathon prototype that turns raw patient journaling into a structured, doctor-ready clinical summary.

The interface is a React-driven one-screen demo with animated process states for capture, extraction, note building, and visit prep.
It also includes a Product Guide help bot with quick-start buttons, free local answers, and optional OpenAI-powered answers for flexible product-use questions.

## Run

```sh
npm run dev
```

Open http://127.0.0.1:5173.

The default browser URL runs in no-cost live local mode. It accepts fresh typed or spoken input and generates the clinical summary locally, so your pitch does not depend on paid API quota.

To use the OpenAI API, start the server with:

```sh
OPENAI_API_KEY=your_api_key_here npm run dev
```

Then open http://127.0.0.1:5173/?api=1.

## Free Local LLM Help Bot

If you do not have a paid OpenAI key, the Product Guide can use a local model instead.

Option A, Ollama:

```sh
ollama run llama3.2
PORT=5174 LOCAL_HELP_PROVIDER=ollama OLLAMA_MODEL=llama3.2 npm run dev
```

Open http://127.0.0.1:5174/?localLlm=1.

Option B, LM Studio:

1. Open LM Studio.
2. Download and load a small chat model.
3. Start the local server from the Developer tab.
4. Run:

```sh
PORT=5174 LOCAL_HELP_PROVIDER=lmstudio LM_STUDIO_MODEL=local-model npm run dev
```

Open http://127.0.0.1:5174/?localLlm=1.

If no local model server is running, the chatbot falls back to the built-in FAQ/local guide so the demo still works.

By default, API mode uses a two-model setup:

- `gpt-5.6-terra` for the first clinical summary draft.
- `gpt-5.6-luna` for fast validation and cleanup.
- `gpt-5.6-luna` for the Product Guide help bot, unless `OPENAI_HELP_MODEL` is set.

Override either model with:

```sh
OPENAI_PRIMARY_MODEL=gpt-5.6-terra OPENAI_VALIDATOR_MODEL=gpt-5.6-luna OPENAI_HELP_MODEL=gpt-5.6-luna OPENAI_API_KEY=your_api_key_here npm run dev
```

## Demo Flow

1. Open the app with the simulated week already loaded.
2. Click `Help` to show the product guide bot. In normal mode it uses local answers; in `?api=1` mode it can call the LLM for flexible usage questions.
3. Click a sample entry or dictate a new one with the mic button.
4. Attach up to three injury images if the patient has something hard to describe visually.
5. Click `Make doctor note` to show symptoms, timeline, medications, and HPI.
6. Open the `History` tab to show that the patient can come back to saved visit summaries later.
7. Click `Send to Doctor`.
8. Open http://127.0.0.1:5173/doctor to show the doctor inbox receiving the summary and images.
9. Click `Prepare visit` to turn the whole week into a doctor-ready summary and likely questions.

For a no-cost hackathon demo, use the normal URL without `?api=1`. This avoids quota errors while still showing a live transformation from messy patient text into a structured note.

Patient history is stored in browser local storage for the demo. It persists across refreshes on the same browser, but it is not a production medical record system.

## Pitch

Patients forget 40-80% of what they meant to tell their doctor. Existing symptom trackers make people tap through forms they do not stick with. VisitReady lets patients talk naturally, then turns that messy story into the clinical summary their doctor actually wants to read.
