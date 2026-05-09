const ALLOWED_KEYS = ['tldr', 'claims', 'evidence', 'steelman', 'couldnt_verify', 'how_to_verify'];

export function clear() {
  for (const key of ALLOWED_KEYS) {
    const card = document.querySelector(`.card[data-key="${key}"] .content`);
    if (card) card.innerHTML = '';
  }
}

export function render(raw) {
  const data = sanitize(raw);

  setText('tldr', data.tldr);
  setClaims('claims', data.claims);
  setEvidence('evidence', data.evidence, data.claims);
  setSteelman('steelman', data.steelman, data.claims);
  setStringList('couldnt_verify', data.couldnt_verify);
  setStringList('how_to_verify', data.how_to_verify);
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return blank();
  const out = blank();
  if (typeof raw.tldr === 'string') out.tldr = raw.tldr;
  if (Array.isArray(raw.claims)) out.claims = raw.claims;
  if (Array.isArray(raw.evidence)) out.evidence = raw.evidence;
  if (Array.isArray(raw.steelman)) out.steelman = raw.steelman;
  if (Array.isArray(raw.couldnt_verify)) out.couldnt_verify = raw.couldnt_verify.filter(s => typeof s === 'string');
  if (Array.isArray(raw.how_to_verify)) out.how_to_verify = raw.how_to_verify.filter(s => typeof s === 'string');
  const extras = Object.keys(raw).filter(k => !ALLOWED_KEYS.includes(k));
  if (extras.length) console.warn('ClaimCheck: dropped unexpected keys:', extras);
  return out;
}

function blank() {
  return { tldr: '', claims: [], evidence: [], steelman: [], couldnt_verify: [], how_to_verify: [] };
}

function content(key) {
  return document.querySelector(`.card[data-key="${key}"] .content`);
}

function setText(key, text) {
  const el = content(key);
  if (!text) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.textContent = text;
}

function setStringList(key, items) {
  const el = content(key);
  if (!items.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  const ul = document.createElement('ul');
  ul.style.margin = '0';
  ul.style.paddingLeft = '18px';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
  el.innerHTML = '';
  el.appendChild(ul);
}

function setClaims(key, claims) {
  const el = content(key);
  if (!claims.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.innerHTML = '';
  for (const c of claims) {
    const div = document.createElement('div');
    div.style.marginBottom = '6px';
    const tag = document.createElement('span');
    tag.className = `claim-tag ${typeOf(c.type)}`;
    tag.textContent = typeOf(c.type);
    div.appendChild(tag);
    const text = document.createElement('span');
    text.textContent = typeof c.text === 'string' ? c.text : '(missing claim text)';
    div.appendChild(text);
    el.appendChild(div);
  }
}

function typeOf(t) {
  return ['factual', 'opinion', 'mixed'].includes(t) ? t : 'mixed';
}

function setEvidence(key, evidence, claims) {
  const el = content(key);
  if (!evidence.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.innerHTML = '';
  for (const e of evidence) {
    const block = document.createElement('div');
    block.style.marginBottom = '10px';

    const claim = claims.find(c => c.id === e.claim_id);
    if (claim) {
      const cite = document.createElement('div');
      cite.style.fontSize = '11px';
      cite.style.color = '#666';
      cite.textContent = `Claim: ${claim.text}`;
      block.appendChild(cite);
    }

    if (typeof e.synthesis === 'string') {
      const syn = document.createElement('div');
      syn.style.margin = '4px 0';
      syn.textContent = e.synthesis;
      block.appendChild(syn);
    }

    if (Array.isArray(e.sources) && e.sources.length) {
      for (const s of e.sources) {
        if (s && typeof s.url === 'string' && /^https?:/i.test(s.url) && typeof s.title === 'string') {
          const link = document.createElement('div');
          link.className = 'source-link';
          link.innerHTML = `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`;
          if (typeof s.summary === 'string') {
            const sum = document.createElement('div');
            sum.style.fontSize = '11px';
            sum.style.color = '#555';
            sum.textContent = s.summary;
            link.appendChild(sum);
          }
          block.appendChild(link);
        }
      }
    }

    if (e.linked_source_check && typeof e.linked_source_check === 'object') {
      const lsc = document.createElement('div');
      lsc.style.marginTop = '6px';
      lsc.style.padding = '6px';
      lsc.style.background = '#fff8e0';
      lsc.style.borderRadius = '3px';
      lsc.style.fontSize = '11px';
      const accuracy = e.linked_source_check.represented_accurately;
      const explanation = e.linked_source_check.explanation;
      lsc.innerHTML = `<strong>Linked source check:</strong> ${escapeHtml(accuracy || '?')} — ${escapeHtml(explanation || '')}`;
      block.appendChild(lsc);
    }

    el.appendChild(block);
  }
}

function setSteelman(key, steelman, claims) {
  const el = content(key);
  if (!steelman.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.innerHTML = '';
  for (const s of steelman) {
    const block = document.createElement('div');
    block.style.marginBottom = '10px';

    const claim = claims.find(c => c.id === s.claim_id);
    if (claim) {
      const cite = document.createElement('div');
      cite.style.fontSize = '11px';
      cite.style.color = '#666';
      cite.textContent = `Claim: ${claim.text}`;
      block.appendChild(cite);
    }

    if (typeof s.factually_wrong_redirect === 'string' && s.factually_wrong_redirect) {
      const redirect = document.createElement('div');
      redirect.style.padding = '6px';
      redirect.style.background = '#fde0e0';
      redirect.style.borderRadius = '3px';
      redirect.textContent = s.factually_wrong_redirect;
      block.appendChild(redirect);
    } else if (typeof s.counter === 'string') {
      const counter = document.createElement('div');
      counter.style.margin = '4px 0';
      counter.textContent = s.counter;
      block.appendChild(counter);
    }

    el.appendChild(block);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
