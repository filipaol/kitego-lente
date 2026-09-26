/* ==========================================================================
   LA LENTE KITEGO (55.489)
   Molte pagine (Panoramicams, siti fatti con WordPress e plugin) costruiscono
   il video e i numeri del vento DOPO l'apertura, con i loro programmi: nel
   codice della pagina non c'e' niente da leggere, e la prova dal server non
   trova nulla. La Lente e' un segnalibro: si apre la pagina nel browser, la
   si lascia caricare (video partito, numeri comparsi), si preme la Lente.
   Guarda quello che il browser ha davvero caricato:
     - i riquadri (player) che il sito ha creato;
     - i flussi video e le immagini che si aggiornano;
     - i link delle centraline note (Ecowitt, Holfuy, WeatherLink, ...);
     - i dati che la pagina si e' fatta mandare: se dentro c'e' il vento,
       prepara la "ricetta" per leggerlo (indirizzo, campi, unita').
   Poi mostra un pannello e copia tutto per KITEGO. Non salva niente e non
   manda niente da nessuna parte: si incolla a mano nella scheda.
   ========================================================================== */
(async () => {
  try { if (window.__kitegoLente) window.__kitegoLente.remove(); } catch (e) {}
  const T = { lente: 1, pagina: location.href, titolo: String(document.title || "").slice(0, 120), quando: new Date().toISOString(),
    player: [], immagini: [], video: [], stazioni: [], dati: [], ricette: [] };
  const add = (a, x) => { if (x && !a.includes(x) && a.length < 12) a.push(x); };
  /* 55.501: sulla pagina di Panoramicams la Lente elencava come "player" dodici riquadri della
     pubblicita' (criteo, pubmatic, smartadserver...) e la pagina stessa */
  const NO = /google\.com\/maps|maps\.google|googletagmanager|google-analytics|doubleclick|googlesyndication|adservice|facebook\.com\/(plugins|tr)|recaptcha|about:blank|hotjar|clarity\.ms|cookie|iubenda|gravatar|criteo|pubmatic|smartadserver|lijit|inmobi|onetag|clvrads|betweendigital|sparteo|adnxs|rubiconproject|openx|amazon-adsystem|taboola|outbrain|teads|seedtag|3lift|casalemedia|adform|yieldlab|quantserve|scorecardresearch|moatads|weborama|streamrail|ogury|adsafeprotected|doubleverify|smartclip|spotx|teads|justpremium|richaudience|improvedigital|sharethrough|(^|\/)(usync|user_sync|user-sync|syncframe|csync|sync)\b|prebid|beacon|\/ads?\//i;

  /* 1. i riquadri che ci sono adesso (anche quelli creati dopo l'apertura) */
  document.querySelectorAll("iframe").forEach(f => {
    const s = f.src || f.getAttribute("data-src") || "";
    if (/^https?:/i.test(s) && !NO.test(s) && s.split("#")[0] !== location.href.split("#")[0]) add(T.player, s);
  });
  /* 2. i video della pagina */
  document.querySelectorAll("video, video source").forEach(v => { const s = v.currentSrc || v.src || ""; if (/^https?:/i.test(s)) add(T.video, s); });

  /* 3. quello che la pagina ha caricato */
  const ris = performance.getEntriesByType("resource").map(e => ({ u: e.name, t: e.initiatorType }));
  const volte = {};
  ris.forEach(({ u }) => { try { const p = new URL(u); volte[p.origin + p.pathname] = (volte[p.origin + p.pathname] || 0) + 1; } catch (e) {} });
  ris.forEach(({ u, t }) => {
    if (NO.test(u)) return;
    /* i flussi: la playlist (.m3u8/.mpd) o il flusso mjpeg, non i pezzetti .ts che arrivano ogni due secondi */
    if (/\.ts(\?|$)|\.m4s(\?|$)/i.test(u)) return;
    if (/\.m3u8|\.mpd|\.mjpe?g|videostream|mjpg/i.test(u)) add(T.video, u);
    else if (/\.(jpe?g|png|webp)(\?|$)/i.test(u)) {
      let p; try { p = new URL(u); } catch (e) { return; }
      const siAggiorna = (volte[p.origin + p.pathname] || 0) > 1;
      if (siAggiorna || /snapshot|cgi-bin|ISAPI|webcam|\bcam[_-]?\d|[?&](t|ts|time|_|v)=\d{6,}/i.test(u)) add(T.immagini, u);
    }
    if (/ecowitt\.net\/home\/share|holfuy\.com|weatherlink\.com|windguru\.cz\/station|wunderground\.com\/dashboard\/pws|weathercloud\.net|meteonetwork|api\.weather\.com\/v2\/pws/i.test(u)) add(T.stazioni, u);
    if (t === "fetch" || t === "xmlhttprequest") add(T.dati, u);
  });
  document.querySelectorAll("a[href]").forEach(a => {
    if (/ecowitt\.net\/home\/share|holfuy\.com\/(en|it|de|fr|es)\/weather|weatherlink\.com\/embeddablePage|windguru\.cz\/station|wunderground\.com\/dashboard\/pws|weathercloud\.net\/(it\/)?d\d/i.test(a.href)) add(T.stazioni, a.href);
  });

  /* 4. nei dati c'e' il vento? si prende l'ultimo valore di ogni elenco (il piu' recente) */
  const cerca = o => {
    const foglie = [];
    const giro = (x, via, d) => {
      if (d > 7 || x == null) return;
      if (Array.isArray(x)) { if (x.length) giro(x[x.length - 1], (via ? via + "." : "") + "-1", d + 1); return; }
      if (typeof x === "object") { Object.keys(x).slice(0, 120).forEach(k => giro(x[k], via ? via + "." + k : k, d + 1)); return; }
      const n = typeof x === "number" ? x : (typeof x === "string" && /^-?\d+([.,]\d+)?$/.test(x.trim()) ? +x.replace(",", ".") : null);
      if (n !== null && Number.isFinite(n)) foglie.push({ via, n });
    };
    giro(o, "", 0);
    const k = f => f.via.toLowerCase();
    const vento = foglie.find(f => /(wind|vento)[^.]*(speed|avg|media|vel|kn|kt|ms|kmh)|windspeed|wspd|wind_?kn|vel_?vento/.test(k(f)) && !/gust|raffic|max|dir/.test(k(f)))
      || foglie.find(f => /(^|\.)(wind|vento)(\.value|\.val)?$/.test(k(f)))
      || foglie.find(f => /(wind|vento)\.[^.]*(speed|avg|media|value)/.test(k(f)) && !/gust|raffic|max|dir/.test(k(f)));
    if (!vento) return null;
    /* 55.519: prima la raffica "di adesso"; il massimo del giorno solo se non c'e' altro */
    const eRaff = f => /gust|raffic|wgust|wind_?max|maxwind/.test(k(f)) && !/dir/.test(k(f));
    const raffica = foglie.find(f => eRaff(f) && !/max|day|daily|today|giorn|oggi|hi(gh)?_?|record/.test(k(f)))
      || foglie.find(f => eRaff(f) && !/day|daily|today|giorn|oggi|record/.test(k(f)));
    const dir = foglie.find(f => /(wind_?|vento_?)?(dir|direction|direzione)(\.value)?$|wdir|winddir|bearing/.test(k(f)) && f.n >= 0 && f.n <= 360);
    const u = k(vento);
    const unita = /mph/.test(u) ? "mph" : /kmh|km_h|kph|km\/h/.test(u) ? "kmh" : /(^|[._])ms$|m_s|mps|m\/s/.test(u) ? "ms" : /kn|kt|knot|nodi/.test(u) ? "kn" : "";
    return { campo_vento: vento.via, vento: vento.n, campo_raffica: raffica ? raffica.via : "", raffica: raffica ? raffica.n : null,
      campo_dir: dir ? dir.via : "", dir: dir ? dir.n : null, unita };
  };
  for (const u of T.dati.slice(0, 20)) {
    try {
      const r = await fetch(u, { credentials: "omit" }); if (!r.ok) continue;
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { continue; }
      const c = cerca(j); if (c) T.ricette.push({ url: u, ...c });
    } catch (e) {}
  }
  delete T.dati;   /* gli indirizzi senza vento non servono a KITEGO */
  /* della stessa immagine che si aggiorna basta l'ultimo indirizzo */
  const ultime = {}; T.immagini.forEach(u => { try { const p = new URL(u); ultime[p.origin + p.pathname] = u; } catch (e) {} });
  T.immagini = Object.values(ultime);

  /* 5. il pannello */
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const corto = u => { try { const p = new URL(u); return p.host + (p.pathname.length > 38 ? p.pathname.slice(0, 36) + "\u2026" : p.pathname); } catch (e) { return String(u).slice(0, 50); } };
  const sez = (tit, arr, fmt) => arr.length ? `<div style="margin-top:12px"><div style="font:600 11px/1 system-ui,sans-serif;letter-spacing:.12em;color:#8F9BA1">${tit}</div>${arr.map(fmt).join("")}</div>` : "";
  const riga = u => `<div style="margin-top:6px;font:13px/1.35 system-ui,sans-serif;color:#F2EFE9;word-break:break-all">${esc(corto(u))}</div>`;
  const nTot = T.player.length + T.immagini.length + T.video.length + T.stazioni.length + T.ricette.length;
  const box = document.createElement("div");
  window.__kitegoLente = box;
  box.setAttribute("style", "position:fixed;z-index:2147483647;top:16px;right:16px;width:360px;max-width:calc(100vw - 32px);max-height:80vh;overflow:auto;background:#0A1014;color:#F2EFE9;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.45),inset 0 0 0 1px #243038;padding:16px 16px 14px;font:14px/1.4 system-ui,-apple-system,sans-serif");
  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><b style="font:800 17px/1 system-ui,sans-serif;letter-spacing:-.3px">KITEGO</b><span style="font:600 12px/1 system-ui,sans-serif;color:#3FD8F5">Lente</span>
      <button id="kgLChiudi" style="margin-left:auto;background:none;border:0;color:#8F9BA1;font-size:20px;cursor:pointer">\u00d7</button></div>
    <div style="margin-top:6px;font-size:13px;color:#A2ACB1">${nTot ? "Ecco cosa ha caricato questa pagina." : "Non ho trovato niente. Aspetta che video e numeri compaiano, poi premi di nuovo la Lente."}</div>
    ${sez("PLAYER", T.player, riga)}${sez("VIDEO", T.video, riga)}${sez("IMMAGINI CHE SI AGGIORNANO", T.immagini, riga)}${sez("CENTRALINE", T.stazioni, riga)}
    ${sez("DATI DEL VENTO", T.ricette, r => `<div style="margin-top:6px;font:13px/1.4 system-ui,sans-serif">${esc(corto(r.url))}<br><span style="color:#22E39E">vento ${esc(r.vento)}${r.raffica != null ? " \u00b7 raffica " + esc(r.raffica) : ""}${r.dir != null ? " \u00b7 da " + esc(r.dir) + "\u00b0" : ""}</span> <span style="color:#8F9BA1">${r.unita ? "(" + r.unita + ")" : "(unit\u00e0 da scegliere)"}</span></div>`)}
    ${nTot ? `<button id="kgLCopia" style="margin-top:14px;width:100%;padding:11px;border:0;border-radius:999px;background:#3FD8F5;color:#0A1014;font:700 14px system-ui,sans-serif;cursor:pointer">Copia per KITEGO</button>
    <div id="kgLEsito" style="margin-top:8px;font-size:12.5px;color:#8F9BA1">Poi incollalo nella scheda dello spot, in \u00abLente\u00bb.</div>` : ""}`;
  document.body.appendChild(box);
  box.querySelector("#kgLChiudi").onclick = () => box.remove();
  const b = box.querySelector("#kgLCopia");
  if (b) b.onclick = async () => {
    const testo = JSON.stringify(T);
    let ok = false;
    try { await navigator.clipboard.writeText(testo); ok = true; } catch (e) {
      const ta = document.createElement("textarea"); ta.value = testo; box.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (_) {} ta.remove();
    }
    box.querySelector("#kgLEsito").textContent = ok ? "Copiato \u2713 Ora incollalo nella scheda dello spot, in \u00abLente\u00bb." : "Non riesco a copiare: seleziona questo testo e copialo a mano.";
    if (!ok) { const ta = document.createElement("textarea"); ta.value = testo; ta.style.cssText = "width:100%;height:90px;margin-top:8px"; box.appendChild(ta); ta.select(); }
  };
})();
