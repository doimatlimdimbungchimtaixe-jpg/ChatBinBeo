# ChatBinBeo

Created by Bin

English-only chat web with a **real LLM running locally in the browser** — no external AI API.

- No OpenAI / Gemini / Claude / OpenRouter / HuggingFace Inference API / Ollama / LM Studio.
- No `if (input.includes(...))`, no keyword matching, no replies list, no fake streaming.
- Every answer goes through: messages → chat template → tokenizer → token IDs → ONNX forward pass → logits → sampling → next token… autoregressively.

## Features

- Chat with streaming responses, Stop, Regenerate, Copy
- Sidebar with New Chat, conversation list, rename, delete, Clear
- Guest mode: chat instantly, temporary history, 30 messages / 24h limit
- Google login: per-account saved history, guest-chat migration, sign out
- Dark / light / system theme, responsive + mobile sidebar
- Settings: theme, temperature, max tokens, real model info, dev metrics
- Vietnamese input detector (UI validation — warns instead of sending)

## Tech stack

- Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS
- Auth.js v5 (`next-auth`) with Google provider
- `@huggingface/transformers@3.7.0` (Transformers.js) + ONNX Runtime (WebGPU → WASM fallback) in a Web Worker
- Storage: localStorage, namespaced per account (`chatbinbeo.conversations.<owner>.v1`)

## AI model

- **Model:** `onnx-community/Qwen2.5-0.5B-Instruct` (Apache-2.0), ~494M params, instruction-tuned chat
- **Weights:** quantized `q4` ONNX, downloaded once from HuggingFace Hub then cached by the browser (`env.useBrowserCache`). Nothing model-sized is committed to this repo (`public/models/` holds only `.gitkeep`).
- **First load:** UI works immediately, model initializes in the background with real progress (`Loading runtime... → Downloading model... % → Ready`) plus a 1-token background warm-up.
- **Tokenizer:** Qwen2 BPE, vocab 151936, IDs read live (EOS 151645 is passed explicitly to every generation).
- **Pipeline:** normalize history (8 latest turns) → `apply_chat_template` (system/user/assistant, ChatML) → tokenize → sample (temperature 0.5, top_p 0.9, repetition penalty 1.1, max 160, cap 512) → `TextStreamer` chunks → UI. Runaway guard aborts degenerate loops with an error (never a fake answer).
- **System prompt:** short English-only prompt (`ai/generationConfig.ts` — the single source of truth, no scattered hard-code).

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. First visit downloads runtime + weights (one time, cached after).

Build:

```bash
npm run build
```

Start production build locally:

```bash
npm start
```

Useful test scripts (Node, real ONNX inference, weights cached):

```bash
node scripts/test-repetition.mjs  # 14 runs: loops/leaks/stream-integrity
node scripts/test-concise.mjs     # 27 runs: concise on-topic English answers
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | For login (prod) | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For login (prod) | Google OAuth client secret |
| `AUTH_SECRET` | Yes in production | Session encryption (`openssl rand -base64 32`) |

Copy `.env.example` to `.env.local` for local login testing. Without them the app still builds and runs in guest mode; the sign-in button reports "not configured". Never commit real secrets.

## Google Login setup

1. Go to Google Cloud → APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized redirect URI: `https://<your-app>.vercel.app/api/auth/callback/google` (locally: `http://localhost:3000/api/auth/callback/google`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` in `.env.local` (local) or Vercel Project Settings → Environment Variables (prod).
4. Restart dev / redeploy. Sidebar shows Sign in with Google → avatar + name + Sign out after login.

## GitHub

```bash
git init
git add .
git commit -m "Prepare ChatBinBeo for deployment"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(Replace `<your-username>/<your-repo>` — no remote is preconfigured in this repo.)

## Vercel deployment

1. Push repository to GitHub
2. Open Vercel
3. Import Git Repository
4. Select ChatBinBeo
5. Add Environment Variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`)
6. Deploy

No AI server needed: inference is 100% client-side (browser Web Worker). No Ollama, no external AI backend. First visit per user downloads weights from HuggingFace Hub + runtime CDN, then caches.

## Known limitations

- 0.5B model: confabulates unknown entities (e.g. skibidi toilet), multi-turn name recall is flaky (~2/3), occasionally claims wrong identity, English-only adherence not absolute (UI detector blocks Vietnamese input as backup).
- Casual replies stay short; stories capped by max tokens (raisable in Settings).
- Guest limit (30/24h) is enforced app-side; it cannot stop someone driving the public-weights runtime directly.
- History is device-local per account; true cross-device sync needs a server DB (see `lib/history/storage.ts` seam).
- First load downloads ~hundreds of MB; weak devices should use WASM fallback (automatic).
