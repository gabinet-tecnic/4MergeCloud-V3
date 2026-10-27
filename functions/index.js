// Firebase Function per al botó "🧠 IA" de 4MergeCloud.
// - Rep una petició POST amb { pw, messages, system?, context? }.
// - Comprova que pw concordi amb el hash guardat al secret AI_PASSWORD_HASH.
// - Crida l'API d'Anthropic (Claude Sonnet 4.5) i torna la resposta.
//
// Secrets necessaris (configurats a Firebase Secret Manager):
//   ANTHROPIC_API_KEY   — la clau sk-ant-...
//   AI_PASSWORD_HASH    — SHA-256 (hex) de la contrasenya mestra
//
// Rate-limit senzill en memòria (per instància): N peticions/minut/IP.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const crypto = require('node:crypto');
const Anthropic = require('@anthropic-ai/sdk');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const AI_PASSWORD_HASH  = defineSecret('AI_PASSWORD_HASH');

// Model i límits
const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 40;          // històric màxim per petició
const MAX_CONTEXT_CHARS = 20000;  // tot el context textual que admet

// Rate limit: 20 req/min per IP, per instància
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = 20;
const rlMap = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now(), arr = rlMap.get(ip) || [];
  const recent = arr.filter(t => now - t < RL_WINDOW_MS);
  if (recent.length >= RL_MAX) { rlMap.set(ip, recent); return true; }
  recent.push(now); rlMap.set(ip, recent);
  return false;
}
// Neteja periòdica
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of rlMap) {
    const recent = arr.filter(t => now - t < RL_WINDOW_MS);
    if (!recent.length) rlMap.delete(ip); else rlMap.set(ip, recent);
  }
}, 5 * 60 * 1000).unref();

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const SYSTEM_PROMPT_DEFAULT = `Ets un assistent especialitzat en arquitectura, aixecaments de l'edifici i rehabilitacions, integrat dins l'aplicació 4MergeCloud. L'usuari treballa amb núvols de punts (LAS/PLY/XYZ) i malles (GLB/OBJ) d'escaneigs d'edificis.

Treballes amb precisió tècnica però parles de forma clara. Pots:
- Generar plànols en SVG a partir de descripcions.
- Deduir plantes a partir del context del núvol de punts.
- Proposar redistribucions i respondre dubtes de normativa general.
- Interpretar captures del visor Three.js que l'usuari t'envia.

Si et falta informació, demana-la en comptes de inventar-la. Si proposes una planimetria vectorial, torna sempre SVG net amb cotes en metres.`;

exports.ask = onRequest(
  { secrets: [ANTHROPIC_API_KEY, AI_PASSWORD_HASH], cors: true, region: 'europe-west1', memory: '512MiB', timeoutSeconds: 90 },
  async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

      const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
      if (rateLimited(ip)) { res.status(429).json({ error: 'Massa peticions, espera un minut.' }); return; }

      const { pw, messages, system, context } = req.body || {};
      if (typeof pw !== 'string' || !pw) { res.status(400).json({ error: 'Falta contrasenya' }); return; }

      const expected = AI_PASSWORD_HASH.value().trim(); // tolerar \n al final del secret
      const got = sha256Hex(pw);
      if (!timingSafeEqualHex(expected, got)) {
        res.status(401).json({ error: 'Contrasenya incorrecta' });
        return;
      }

      if (!Array.isArray(messages) || !messages.length) {
        res.status(400).json({ error: 'Falten missatges' }); return;
      }
      if (messages.length > MAX_MESSAGES) {
        res.status(400).json({ error: 'Massa missatges (màx ' + MAX_MESSAGES + ')' }); return;
      }

      // Validació i neteja de missatges
      const cleanMessages = messages.slice(-MAX_MESSAGES).map(m => {
        if (!m || typeof m !== 'object') throw new Error('Missatge no vàlid');
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        // Content pot ser string o array amb text/image blocks (per captures)
        let content = m.content;
        if (typeof content === 'string') {
          if (content.length > MAX_CONTEXT_CHARS) content = content.slice(0, MAX_CONTEXT_CHARS);
        } else if (Array.isArray(content)) {
          content = content.slice(0, 10).map(block => {
            if (block.type === 'text') {
              return { type: 'text', text: String(block.text || '').slice(0, MAX_CONTEXT_CHARS) };
            }
            if (block.type === 'image' && block.source?.type === 'base64') {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: block.source.media_type || 'image/png',
                  data: String(block.source.data || '').slice(0, 4_000_000), // ~3 MB en base64
                },
              };
            }
            return { type: 'text', text: '' };
          });
        } else {
          throw new Error('Format de contingut desconegut');
        }
        return { role, content };
      });

      const systemPrompt = (typeof system === 'string' && system.trim())
        ? system.slice(0, MAX_CONTEXT_CHARS)
        : SYSTEM_PROMPT_DEFAULT;

      let contextBlock = '';
      if (typeof context === 'string' && context.trim()) {
        contextBlock = '\n\n# Context del model actual\n' + context.slice(0, MAX_CONTEXT_CHARS);
      }

      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt + contextBlock,
        messages: cleanMessages,
      });

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      res.status(200).json({
        text,
        usage: response.usage,
        model: response.model,
      });
    } catch (err) {
      console.error('[ask] error', err);
      const msg = err?.error?.message || err?.message || String(err);
      res.status(500).json({ error: 'Error del servidor: ' + msg });
    }
  }
);
