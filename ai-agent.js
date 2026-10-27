// Botó "🧠 IA" — xat amb Claude Sonnet 4.5 via Firebase Function.
// La contrasenya es guarda només a sessionStorage (s'esborra en tancar pestanya).
// L'historial del xat també a sessionStorage, per no persistir converses.
//
// Pot adjuntar una captura del visor Three.js com a imatge per preguntar
// sobre el que es veu.

(function () {
  const FUNCTION_URL = 'https://ask-cjnddmyf7a-ew.a.run.app';
  // La URL definitiva te la dóna 'firebase deploy'. Si canvia, actualitza-la aquí.
  // Format habitual: https://ask-<hash>-ew.a.run.app  (ew = europe-west1)

  const PW_KEY = '4mc_ai_pw';
  const HISTORY_KEY = '4mc_ai_history';

  function getPassword() { try { return sessionStorage.getItem(PW_KEY) || ''; } catch (_) { return ''; } }
  function setPassword(p) { try { if (p) sessionStorage.setItem(PW_KEY, p); else sessionStorage.removeItem(PW_KEY); } catch (_) {} }
  function getHistory() { try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { return []; } }
  function setHistory(h) { try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-30))); } catch (_) {} }
  function clearHistory() { try { sessionStorage.removeItem(HISTORY_KEY); } catch (_) {} }

  async function ask(messages, context) {
    const pw = getPassword();
    if (!pw) throw new Error('Introdueix primer la contrasenya.');
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pw, messages, context }),
    });
    const json = await res.json().catch(() => ({ error: 'Resposta no JSON (' + res.status + ')' }));
    if (!res.ok) { if (res.status === 401) setPassword(''); throw new Error(json.error || ('HTTP ' + res.status)); }
    return json;
  }

  // Captura la vista actual del visor Three.js com a PNG base64 (sense data: prefix).
  function snapshotViewer() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    try {
      // Mida reduïda per no cremar tokens (max 1280px pel costat llarg).
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
      const out = document.createElement('canvas');
      out.width = Math.round(canvas.width * scale);
      out.height = Math.round(canvas.height * scale);
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
      const dataUrl = out.toDataURL('image/jpeg', 0.72);
      return dataUrl.split(',')[1]; // només la part base64
    } catch (e) { console.warn('[ai] snapshot error', e); return null; }
  }

  // Recull info bàsica del model actual per passar-la com a context.
  function collectContext() {
    const parts = [];
    try {
      const clouds = window._debug?.clouds || window.clouds;
      if (Array.isArray(clouds) && clouds.length) {
        let totalPoints = 0, meshes = 0;
        for (const c of clouds) {
          if (c?.geometry?.attributes?.position) totalPoints += c.geometry.attributes.position.count;
          if (c?.isMesh) meshes++;
        }
        parts.push(`Objectes a l'escena: ${clouds.length} (malles: ${meshes}, resta núvols).`);
        if (totalPoints) parts.push(`Punts totals: ~${totalPoints.toLocaleString('ca')}.`);
      }
    } catch (_) {}
    try {
      const unit = window.APP_UNIT || 'metres';
      parts.push(`Unitats del model: ${unit}.`);
    } catch (_) {}
    return parts.join('\n');
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  let panel = null, scrollEl = null, inputEl = null, attachBtn = null;
  let pendingImage = null; // {media_type, data}

  function openPanel() {
    if (panel) { panel.style.display = 'flex'; return; }
    panel = document.createElement('aside');
    panel.id = 'aiAgentPanel';
    panel.style.cssText = 'position:fixed;top:70px;right:16px;width:420px;max-width:94vw;height:min(78vh,720px);background:#0f1119;border:1px solid #2a2d40;border-radius:10px;z-index:9998;box-shadow:0 8px 30px #000a;font:13px system-ui;color:#e8ebef;display:flex;flex-direction:column;';
    panel.innerHTML = `
      <header style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #262d37;">
        <span style="color:#e0a15e;font-weight:600;font-size:14px;">🧠 IA · Claude Sonnet 4.5</span>
        <div style="display:flex;gap:4px;">
          <button data-newchat title="Nou xat" style="background:#262d37;border:1px solid #414a57;color:#eee;border-radius:4px;padding:3px 8px;cursor:pointer;">↻</button>
          <button data-logout title="Oblidar contrasenya" style="background:#262d37;border:1px solid #414a57;color:#eee;border-radius:4px;padding:3px 8px;cursor:pointer;">🔒</button>
          <button data-close title="Tancar" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;">✕</button>
        </div>
      </header>
      <div data-scroll style="flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;"></div>
      <div data-attachinfo style="padding:0 12px;color:#aebdcc;font-size:11px;min-height:14px;"></div>
      <form data-form style="display:flex;gap:6px;padding:10px 12px;border-top:1px solid #262d37;align-items:flex-end;">
        <button type="button" data-attach title="Afegir captura del visor" style="background:#262d37;border:1px solid #414a57;color:#eee;border-radius:6px;padding:8px 10px;cursor:pointer;">📷</button>
        <textarea data-input placeholder="Pregunta a Claude sobre el teu model…" rows="2"
          style="flex:1;resize:none;background:#1a2029;border:1px solid #414a57;color:#eee;border-radius:6px;padding:8px;font:inherit;"></textarea>
        <button type="submit" style="background:#e07820;border:1px solid #e07820;color:#fff;border-radius:6px;padding:8px 14px;cursor:pointer;">Enviar</button>
      </form>`;
    document.body.appendChild(panel);
    scrollEl = panel.querySelector('[data-scroll]');
    inputEl = panel.querySelector('[data-input]');
    attachBtn = panel.querySelector('[data-attach]');
    const attachInfo = panel.querySelector('[data-attachinfo]');

    panel.querySelector('[data-close]').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('[data-newchat]').onclick = () => {
      if (!confirm('Comencar un xat nou? Es perdrà la conversa actual.')) return;
      clearHistory(); renderHistory();
    };
    panel.querySelector('[data-logout]').onclick = () => { setPassword(''); renderBanner(); };
    panel.querySelector('[data-form]').onsubmit = e => { e.preventDefault(); submit(); };
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    attachBtn.onclick = () => {
      const b64 = snapshotViewer();
      if (!b64) { attachInfo.textContent = 'No hi ha visor obert.'; return; }
      pendingImage = { media_type: 'image/jpeg', data: b64 };
      attachInfo.innerHTML = `Captura adjuntada (${Math.round(b64.length * 3/4/1024)} KB).
        <a href="#" data-removeatt style="color:#e07820;">treure</a>`;
      attachInfo.querySelector('[data-removeatt]').onclick = ev => {
        ev.preventDefault(); pendingImage = null; attachInfo.textContent = '';
      };
    };

    renderBanner();
    renderHistory();
    setTimeout(() => inputEl.focus(), 50);
  }

  function renderBanner() {
    if (!scrollEl) return;
    const existing = scrollEl.querySelector('[data-banner]');
    existing?.remove();
    if (getPassword()) return;
    const banner = document.createElement('div');
    banner.dataset.banner = '1';
    banner.style.cssText = 'background:#2a2d40;border:1px solid #414a57;border-radius:8px;padding:10px;';
    banner.innerHTML = `
      <div style="color:#e0a15e;font-weight:600;margin-bottom:6px;">Contrasenya d'accés a la IA</div>
      <div style="color:#aebdcc;font-size:11px;margin-bottom:6px;">Diferent de la contrasenya "Privat". Es guarda només fins que tanquis aquesta pestanya.</div>
      <div style="display:flex;gap:6px;">
        <input type="password" data-pw style="flex:1;background:#1a2029;border:1px solid #414a57;color:#eee;border-radius:6px;padding:6px 8px;font:inherit;" autocomplete="current-password">
        <button data-pwok style="background:#e07820;border:1px solid #e07820;color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;">Entrar</button>
      </div>`;
    scrollEl.prepend(banner);
    const pwInput = banner.querySelector('[data-pw]');
    const ok = () => {
      const p = pwInput.value;
      if (!p) return;
      setPassword(p); banner.remove();
      addSystemMessage('Autenticat. Pregunta el que vulguis.');
    };
    banner.querySelector('[data-pwok]').onclick = ok;
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    setTimeout(() => pwInput.focus(), 50);
  }

  function renderHistory() {
    if (!scrollEl) return;
    scrollEl.innerHTML = '';
    for (const m of getHistory()) {
      addMessageBubble(m.role, textFromContent(m.content));
    }
    renderBanner();
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function textFromContent(c) {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => b.type === 'text' ? b.text : (b.type === 'image' ? '📷 [captura]' : '')).join('\n');
    return '';
  }

  function addMessageBubble(role, text) {
    const bubble = document.createElement('div');
    const mine = role === 'user';
    bubble.style.cssText = `max-width:88%;align-self:${mine?'flex-end':'flex-start'};background:${mine?'#2a3a52':'#1b2028'};border:1px solid ${mine?'#3a5178':'#2a2d40'};color:#e8ebef;padding:8px 12px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;`;
    bubble.textContent = text;
    scrollEl.appendChild(bubble);
    scrollEl.scrollTop = scrollEl.scrollHeight;
    return bubble;
  }

  function addSystemMessage(text) {
    const b = document.createElement('div');
    b.style.cssText = 'align-self:center;color:#88a;font-size:11px;';
    b.textContent = text;
    scrollEl.appendChild(b);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function submit() {
    const text = inputEl.value.trim();
    if (!text && !pendingImage) return;
    if (!getPassword()) { renderBanner(); return; }

    // Construïm el contingut del missatge usuari
    const content = [];
    if (pendingImage) content.push({ type: 'image', source: { type: 'base64', ...pendingImage } });
    if (text) content.push({ type: 'text', text });

    const history = getHistory();
    const newMsg = { role: 'user', content: content.length === 1 && content[0].type === 'text' ? text : content };
    history.push(newMsg);
    setHistory(history);
    renderHistory();
    inputEl.value = '';
    const info = panel.querySelector('[data-attachinfo]');
    if (info) info.textContent = '';
    pendingImage = null;

    const thinking = addMessageBubble('assistant', '…');
    thinking.style.opacity = '0.6';
    try {
      const result = await ask(history, collectContext());
      thinking.remove();
      const reply = result.text || '(resposta buida)';
      history.push({ role: 'assistant', content: reply });
      setHistory(history);
      addMessageBubble('assistant', reply);
    } catch (e) {
      thinking.remove();
      addMessageBubble('assistant', 'Error: ' + e.message);
      if (/contrasenya/i.test(e.message)) renderBanner();
    }
  }

  function bind() {
    const btn = document.getElementById('tbAIAgent');
    if (btn) btn.addEventListener('click', openPanel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
