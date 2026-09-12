# ChatBinBeo

Created by Bin Beo

English-only chat web with a **real LLM running locally in the browser** — no external AI API, no login.

- No OpenAI / Gemini / Claude / OpenRouter / HuggingFace Inference API / Ollama / LM Studio.
- No `if (input.includes(...))`, no keyword matching, no replies list, no fake streaming.
- Every answer goes through: messages → chat template → tokenizer → token IDs → ONNX forward pass → logits → sampling → next token… autoregressively.

## Features

- Chat with streaming responses, Stop, Regenerate, Copy (with mobile fallback)
- Sidebar with New Chat, conversation list, rename, delete, Clear (touch-friendly, drawer on mobile)
- No login: open and chat, history in localStorage
- Vietnamese input detector (UI validation — warns instead of sending)
- Dark / light / system theme, responsive desktop/tablet/mobile (`100dvh`, safe-area, smart scroll + "↓ New response" button)
- Minimal PWA: manifest + icon + theme (Add to Home Screen; no service worker by design — 750MB weights stay in browser cache)
- Settings: theme, temperature, max tokens, real model/tokenizer diagnostics, real load + generation metrics

## Tech stack

- Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS
- `@huggingface/transformers@3.7.0` (Transformers.js) + ONNX Runtime (WebGPU → WASM fallback) in a Web Worker
- Storage: localStorage, single namespace (`chatbinbeo.conversations.v1`, adopts legacy keys once)

## AI model

- **Model:** `onnx-community/Qwen2.5-0.5B-Instruct` (Apache-2.0), ~494M params, instruction-tuned chat
- **Weights:** quantized `q4` ONNX, downloaded once from HuggingFace Hub then cached by the browser (`env.useBrowserCache`). Pinned to revision `cc5cc01a` — the app auto-invalidates older caches and Settings has "Clear model cache & reload" for a clean slate. Nothing model-sized is committed to this repo (`public/models/` holds only `.gitkeep`).
- **First load:** UI renders immediately, model initializes in the background with real progress (`Loading runtime... → Downloading model... % → Ready`) plus a 1-token background warm-up. Quantized `q4` keeps the download small (~750MB single `model_q4.onnx` + tokenizer files); WebGPU preferred, WASM fallback, single worker/singleton instance (no reload loops). Per-file byte totals from the runtime feed real Model size / Downloaded / Speed metrics — no faked progress.
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
node scripts/test-final.mjs       # creator identity + short replies + recall
node scripts/test-benchmark.mjs   # 8 prompts x3 + context: relevance/English/clarity
```

## Environment variables

None required. AI inference runs 100% client-side (browser Web Worker, weights from HuggingFace Hub) and history lives in the browser (localStorage). `.env.example` states this explicitly — no keys, no secrets, nothing to configure.

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
5. Deploy (no environment variables needed)

No AI server needed: inference is 100% client-side (browser Web Worker). No Ollama, no external AI backend. First visit per user downloads weights from HuggingFace Hub + runtime CDN, then caches.

## Known limitations

- 0.5B model: confabulates unknown entities (e.g. skibidi toilet), multi-turn name recall is flaky, occasionally claims a wrong creator identity, English-only adherence not absolute (UI detector blocks Vietnamese input as backup).
- Casual replies stay short; stories capped by max tokens (raisable in Settings).
- History is device-local (localStorage); no sync across devices.
- First load downloads ~750MB; weak devices use the automatic WASM fallback (slower inference).
- Responsive/mobile layout implemented (drawer, `100dvh`, safe-area, smart scroll); physical-device testing across viewports still recommended.
