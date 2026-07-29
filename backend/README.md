# ZeusX Backend

Server Express per le API di ZeusX.

## Avvio

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

## Variabili d'ambiente

Copia `.env.example` in `.env` e compila le chiavi.

## Endpoint

- `GET /api/health` — Health check
- `POST /api/chat` — Chat generica via AI Router centralizzato (`lib/ai-router.js`, OpenRouter, tier "fast")
- `POST /api/vision/analyze` — Analisi immagini multi-provider (`groq`, `gemini`, `openai`)
- `POST /api/generate-app` — Generazione blueprint app via AI Router centralizzato (OpenRouter, tier "advanced")

## Deploy

Puoi deployare questo backend su Render, Railway, Fly.io o qualsiasi VPS.

Assicurati di impostare `ALLOWED_ORIGINS` con il dominio del frontend per abilitare CORS in sicurezza.
