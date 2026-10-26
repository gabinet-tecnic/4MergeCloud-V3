// Botó "🔒 Privat": accedeix al Drive d'un compte Gmail dedicat
// autenticant-se amb una contrasenya mestra. El refresh_token del Drive
// viu xifrat a Firestore (AES-GCM amb clau derivada de la contrasenya via
// PBKDF2). Qualsevol lector del Firestore veu un blob inservible sense
// la contrasenya correcta.
//
// Setup inicial: privat-setup.html (ús únic, s'esborra després).

(function () {
  const FIREBASE_PROJECT = 'mergecloud-privat';
  const FIREBASE_API_KEY = 'AIzaSyBAL1nJJURuVvoWxZgljYDPavoblhMsPto';
  const FIRESTORE_URL =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/secrets/privat?key=${FIREBASE_API_KEY}`;

  const b64 = {
    enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))),
    dec: s   => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
  };

  // Estat de sessió desbloquejada (només a memòria, mai persistit).
  let session = null; // { refreshToken, clientId, clientSecret, folderId, accessToken, accessExpiresAt }

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false, ['decrypt']);
  }

  async function fetchSecretDoc() {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) throw new Error('No puc llegir Firestore (' + res.status + ')');
    const json = await res.json();
    const f = json.fields || {};
    if (!f.salt?.stringValue || !f.iv?.stringValue || !f.cipher?.stringValue)
      throw new Error('Document de Firestore incomplet. Cal fer el setup abans.');
    return { salt: b64.dec(f.salt.stringValue), iv: b64.dec(f.iv.stringValue), cipher: b64.dec(f.cipher.stringValue) };
  }

  async function unlock(password) {
    const doc = await fetchSecretDoc();
    const key = await deriveKey(password, doc.salt);
    let plainBuf;
    try {
      plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: doc.iv }, key, doc.cipher);
    } catch (_) {
      throw new Error('Contrasenya incorrecta.');
    }
    const data = JSON.parse(new TextDecoder().decode(plainBuf));
    session = { ...data, accessToken: null, accessExpiresAt: 0 };
    await refreshAccess();
    return true;
  }

  function lock() { session = null; }

  async function refreshAccess() {
    if (!session) throw new Error('No desbloquejat');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: session.clientId,
      client_secret: session.clientSecret,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error('No puc renovar l\'access token: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    session.accessToken = j.access_token;
    session.accessExpiresAt = Date.now() + (j.expires_in - 60) * 1000;
  }

  async function access() {
    if (!session) throw new Error('No desbloquejat');
    if (!session.accessToken || Date.now() >= session.accessExpiresAt) await refreshAccess();
    return session.accessToken;
  }

  async function listFiles() {
    const token = await access();
    const q = `'${session.folderId}' in parents and trashed=false`;
    const url = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=' + encodeURIComponent('files(id,name,mimeType,size,modifiedTime,iconLink)')
      + '&orderBy=modifiedTime desc&pageSize=200';
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Drive list: ' + res.status);
    return (await res.json()).files || [];
  }

  async function downloadFile(fileId, name) {
    const token = await access();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error('Drive download: ' + res.status);
    const blob = await res.blob();
    return new File([blob], name || 'drive_file', { type: blob.type || 'application/octet-stream' });
  }

  async function uploadFile(blob, name) {
    const token = await access();
    const metadata = { name, parents: [session.folderId] };
    const boundary = 'b_' + Math.random().toString(36).slice(2);
    const delim = `\r\n--${boundary}\r\n`;
    const close = `\r\n--${boundary}--`;
    const metaPart = 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);
    const prefix = delim + metaPart + delim + `Content-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
    const body = new Blob([prefix, blob, close], { type: `multipart/related; boundary=${boundary}` });
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body,
    });
    if (!res.ok) throw new Error('Drive upload: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return res.json();
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  function openModal(title, bodyHTML, onSubmit) {
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1b2028;color:#e8ebef;border:1px solid #424953;border-radius:12px;padding:20px;min-width:320px;max-width:92vw;font:14px system-ui;box-shadow:0 10px 32px #0008';
    box.innerHTML = `<div style="font-weight:600;font-size:16px;margin-bottom:12px;">${title}</div>${bodyHTML}
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
        <button data-cancel style="padding:8px 14px;background:#333;border:1px solid #555;color:#eee;border-radius:6px;cursor:pointer;">Cancel·lar</button>
        <button data-ok style="padding:8px 14px;background:#e07820;border:1px solid #e07820;color:#fff;border-radius:6px;cursor:pointer;">Entrar</button>
      </div>
      <div data-err style="color:#ff8080;margin-top:8px;font-size:12px;min-height:1em;"></div>`;
    back.appendChild(box); document.body.appendChild(back);
    const err = box.querySelector('[data-err]');
    const close = () => back.remove();
    box.querySelector('[data-cancel]').onclick = close;
    const submit = async () => {
      try { await onSubmit(box, close); }
      catch (e) { err.textContent = e.message || String(e); }
    };
    box.querySelector('[data-ok]').onclick = submit;
    box.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
    setTimeout(() => box.querySelector('input')?.focus(), 20);
    return { close };
  }

  function askPassword() {
    openModal('🔒 Privat — Contrasenya',
      `<label style="display:block;margin-bottom:4px;color:#bbb;font-size:12px;">Contrasenya mestra</label>
       <input type="password" autocomplete="current-password"
         style="width:100%;padding:8px;background:#262d37;border:1px solid #414a57;color:#e8ebef;border-radius:6px;font:14px ui-monospace,monospace;">`,
      async (box, close) => {
        const pw = box.querySelector('input').value;
        if (!pw) throw new Error('Posa la contrasenya');
        box.querySelector('[data-ok]').textContent = 'Entrant…';
        await unlock(pw);
        close();
        openPanel();
      });
  }

  function openPanel() {
    document.getElementById('privatPanel')?.remove();
    const panel = document.createElement('aside');
    panel.id = 'privatPanel';
    panel.style.cssText = 'position:fixed;top:70px;right:16px;width:360px;max-width:92vw;max-height:80vh;background:#0f1119;border:1px solid #2a2d40;border-radius:10px;padding:14px;z-index:9998;box-shadow:0 8px 30px #000a;font:13px system-ui;color:#e8ebef;display:flex;flex-direction:column;';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="color:#e0a15e;font-weight:600;font-size:14px;">🔒 Privat · Drive</span>
        <div style="display:flex;gap:4px;">
          <button data-reload title="Recarregar llista" style="background:#262d37;border:1px solid #414a57;color:#eee;border-radius:4px;padding:3px 8px;cursor:pointer;">↻</button>
          <button data-upload title="Pujar fitxer" style="background:#262d37;border:1px solid #414a57;color:#eee;border-radius:4px;padding:3px 8px;cursor:pointer;">↑</button>
          <button data-lock title="Bloquejar" style="background:#262d37;border:1px solid #414a57;color:#eee;border-radius:4px;padding:3px 8px;cursor:pointer;">🔒</button>
          <button data-close title="Tancar" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;">✕</button>
        </div>
      </div>
      <div data-status style="color:#aaa;font-size:11px;margin-bottom:6px;">Carregant…</div>
      <div data-list style="overflow:auto;flex:1;"></div>`;
    document.body.appendChild(panel);
    const status = panel.querySelector('[data-status]');
    const list = panel.querySelector('[data-list]');
    panel.querySelector('[data-close]').onclick = () => panel.remove();
    panel.querySelector('[data-lock]').onclick = () => { lock(); panel.remove(); };

    async function reload() {
      status.textContent = 'Carregant…'; list.innerHTML = '';
      try {
        const files = await listFiles();
        status.textContent = files.length ? `${files.length} fitxers.` : 'Carpeta buida.';
        for (const f of files) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid #262d37;cursor:pointer;';
          const sizeKB = f.size ? ` · ${(f.size/1024).toFixed(0)} KB` : '';
          row.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
            <span style="color:#888;font-size:10px;">${f.mimeType.split('/').pop()}${sizeKB}</span>`;
          row.title = 'Obrir ' + f.name;
          row.onclick = async () => {
            row.style.opacity = '0.5';
            try {
              const file = await downloadFile(f.id, f.name);
              if (typeof window.handleFiles === 'function') await window.handleFiles([file]);
              panel.remove();
            } catch (e) { status.textContent = 'Error obrint: ' + e.message; row.style.opacity = '1'; }
          };
          list.appendChild(row);
        }
      } catch (e) { status.textContent = 'Error: ' + e.message; }
    }
    panel.querySelector('[data-reload]').onclick = reload;
    panel.querySelector('[data-upload]').onclick = () => {
      const fi = document.createElement('input');
      fi.type = 'file';
      fi.onchange = async () => {
        const f = fi.files[0]; if (!f) return;
        status.textContent = 'Pujant ' + f.name + '…';
        try { await uploadFile(f, f.name); await reload(); }
        catch (e) { status.textContent = 'Error pujant: ' + e.message; }
      };
      fi.click();
    };
    reload();
  }

  // Exporta i enganxa al botó.
  window.MCPrivat = { askPassword, lock, isUnlocked: () => !!session };
  function bind() {
    const btn = document.getElementById('tbPrivat');
    if (btn) btn.addEventListener('click', () => {
      if (session) openPanel();
      else askPassword();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
