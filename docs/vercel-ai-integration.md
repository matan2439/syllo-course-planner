# Vercel AI SDK — Course Planner Integration

## Overview

The AI assistant is built on the **Vercel AI SDK** (`ai` package) with an
**Anthropic Claude** or **OpenAI GPT** backend (whichever API key is configured).

The backend is a single Edge Function at `api/ai/course-planner.ts`.
The frontend (`app/web/semester_board_viewer.html`) calls it with a condensed
plan context and streams the response text back to the UI.

---

## How to run locally

### 1. Install Node dependencies

```bash
npm install
```

### 2. Set your API key

Copy the example env file and add your key:

```bash
cp .env.example .env
# Then edit .env and fill in ANTHROPIC_API_KEY or OPENAI_API_KEY
```

### 3. Start the dev server

```bash
npm run dev
# or: vercel dev
```

This starts on `http://localhost:3000`.

Open the viewer at:
```
http://localhost:3000/app/web/semester_board_viewer.html
```

The AI assistant panel in the sidebar and the "שיחה עם AI" tab in course
details will now be live.

---

## Required environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (preferred). Get one at console.anthropic.com |
| `OPENAI_API_KEY` | OpenAI API key (fallback). Get one at platform.openai.com |

**Set at least one.** Anthropic is tried first; OpenAI is used if only its key is set.

If neither key is set, the endpoint returns HTTP 503 with `{ code: "NO_API_KEY" }`
and the UI shows a clear error message.

---

## How to deploy on Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the project root and follow the prompts.
3. In the Vercel dashboard → Project Settings → Environment Variables,
   add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`).
4. Redeploy.

The static HTML viewer is served at `/app/web/semester_board_viewer.html`
and the API at `/api/ai/course-planner`.

---

## How the AI endpoint works

### Endpoint

```
POST /api/ai/course-planner
Content-Type: application/json
```

### Request body

```json
{
  "message": "האם התוכנית שלי מאוזנת?",
  "program_id": "mechanical_engineering_2027",
  "plan_context": {
    "program_name": "הנדסה מכנית",
    "semesters": [
      {
        "id": "year_3_semester_a",
        "label": "שנה ג׳ — סמסטר א׳",
        "total_hours": 14,
        "courses": [
          {
            "course_id": "0542-4420",
            "name_he": "תורת המכונות",
            "hours": 4,
            "difficulty_level": "medium",
            "course_type": "elective"
          }
        ]
      }
    ],
    "mandatory_unplaced": [],
    "prerequisite_issues": [],
    "grade_signals": {
      "0542-4420": { "average_grade": 60.6, "num_students_total": 2472 }
    }
  },
  "course_context": "(optional) free-text context for course-detail questions"
}
```

### Response

A streaming `text/plain` response. Each chunk is a fragment of the assistant's
reply in Hebrew. The frontend reads it via `ReadableStream` and appends chunks
to the UI as they arrive.

### Error responses (JSON)

| Status | `code` | Meaning |
|---|---|---|
| 400 | — | Invalid or missing fields |
| 405 | — | Wrong HTTP method |
| 503 | `NO_API_KEY` | No AI provider key configured |

---

## Model provider

| Key present | Model used |
|---|---|
| `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-20241022` |
| `OPENAI_API_KEY` only | `gpt-4o-mini` |

---

## Current limitations

- The AI only knows what the local board JSON contains. It cannot look up
  TAU's official course catalog in real time.
- Syllabus content is not sent to the AI (only metadata).
- Grade statistics come from Arazim TAU Refactor data and may not reflect
  the most recent academic year.
- Responses are advisory only — not official academic advice.
- The board data JSON files (`data/parsed_json/`) are not included in the
  Vercel deployment by default (listed in `.gitignore`). For a full cloud
  deployment, regenerate the board data as part of the build step, or serve
  it from an external store.

---

## Running tests

```bash
# Python tests (existing)
python -m pytest

# TypeScript/API tests
npm test
```
