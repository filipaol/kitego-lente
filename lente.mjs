/* ==========================================================================
   KITEGO — LA LENTE AUTOMATICA (55.506)

   Le pagine delle centraline che si costruiscono i numeri nel browser
   (Ecowitt in condivisione, siti fatti in casa, widget) dal server non si
   leggono. La Lente nell'app le legge a mano, una per volta: qui la stessa
   cosa la fa un browser vero, ogni ora, per tutte le scuole che hanno detto
   si'. Gira su GitHub Actions (gratis) e scrive in Supabase.

   Per ogni riga di `stazioni` con tipo "pagina" (accesa o spenta):
   1. robots.txt: se vieta i lettori automatici, si salta e si scrive perche'.
   2. apre config.url, aspetta che la pagina abbia chiesto i suoi dati,
      cattura ogni risposta JSON;
   3. cerca il vento con le stesse regole della Lente (campi wind/vento,
      mai gust/max/dir, mai *_id, setting, unit, config);
   4. l'unita': config.unita se c'e', altrimenti quella che la pagina dice
      accanto al valore ("unit": "km/h"), altrimenti nodi;
   5. se nei dati non c'e', legge il testo della pagina: "12.3 kn", "12 nodi",
      "23 km/h" accanto a "vento";
   6. upsert in `pagina_letture` (spot_id, quando, kn, raffica_kn, dir, ...).
   ========================================================================== */
import { chromium } from "playwright";

const SB = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest(\/v1)?$/, "");
const KEY = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!SB || !KEY){ console.error("mancano SUPABASE_URL e SUPABASE_SERVICE_KEY"); process.exit(1); }
const H = { apikey: KEY, authorization: "Bearer " + KEY, "content-type": "application/json" };
const UA = "KITEGO-Lente/1.0 (+https://kitego.it; legge le pagine delle scuole col loro permesso)";

const MS = 1.943844;
const aKn = (v, u) => u === "ms" ? v * MS : u === "kmh" ? v / 1.852 : u === "mph" ? v * 0.868976 : v;
const unitaDa = s => { s = String(s || "").toLowerCase(); return /km\/?h/.test(s) ? "kmh" : /m\/?s/.test(s) ? "ms" : /mph/.test(s) ? "mph" : /kn|kt|nod/.test(s) ? "kn" : null; };

/* ---------- robots.txt: la regola piu' semplice, applicata con prudenza ---------- */
async function robotsPermette(url){
  try{
    const u = new URL(url);
    const r = await fetch(u.origin + "/robots.txt", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { ok:true };
    const t = await r.text();
    let mio = false, tutti = false, disallow = [];
    for (const riga of t.split(/\r?\n/)){
      const l = riga.replace(/#.*/, "").trim(); if (!l) continue;
      const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "user-agent"){ const ag = v.toLowerCase(); mio = ag === "*" || ag.includes("kitego"); tutti = ag === "*"; }
      else if (k === "disallow" && (mio || tutti) && v) disallow.push(v);
    }
    const path = u.pathname + u.search;
    const vietato = disallow.some(d => d === "/" || path.startsWith(d.replace(/\*.*$/, "")));
    return vietato ? { ok:false, motivo:"robots.txt della pagina vieta i lettori automatici: serve che la scuola lo permetta o dia i dati in altro modo" } : { ok:true };
  }catch(e){ return { ok:true }; }
}

/* ---------- le foglie di un JSON, con il loro percorso ---------- */
function foglie(obj, via = "", out = [], prof = 0){
  if (prof > 7 || out.length > 4000) return out;
  if (Array.isArray(obj)){ const i = obj.length - 1; if (i >= 0) foglie(obj[i], via + "[" + i + "]", out, prof + 1); return out; }
  if (obj && typeof obj === "object"){
    for (const k of Object.keys(obj)){
      const v = obj[k], p = via ? via + "." + k : k;
      if (v && typeof v === "object") foglie(v, p, out, prof + 1);
      else out.push({ via: p, k, v, padre: obj });
    }
    return out;
  }
  return out;
}
const num = v => { if (typeof v === "number") return v; if (typeof v === "string"){ const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; } return null; };
const nonMisura = via => /(_id|Id)$|setting|\bunit\b|units|config|option|threshold|alarm/i.test(via);

/* ECOWITT: i campi si chiamano "windspeedmph" qualunque unita' mostrino. L'unita'
   vera sta in setting/info -> unit_setting_info.windspeed_id (25/9, Siponto:
   la pagina diceva 5,6 nodi, la Lente 4,9 perche' convertiva da miglia). */
const ECOWITT_UNITA = { 6:"kmh", 7:"ms", 8:"kn", 9:"mph" };
let unitaEcowitt = null;
function ventoDaJson(d){
  try{ const id = d && d.data && d.data.unit_setting_info && d.data.unit_setting_info.windspeed_id;
       if (id != null && ECOWITT_UNITA[+id]) unitaEcowitt = ECOWITT_UNITA[+id]; }catch(e){}
  const F = foglie(d).filter(f => num(f.v) != null);
  const k = f => f.via.toLowerCase();
  const vento = F.find(f => /(wind|vento)[^.]*(speed|avg|media|vel|kn|kt|ms|kmh)|windspeed|wspd|wind_?kn|vel_?vento/.test(k(f)) && !/gust|raffic|max|dir|min/.test(k(f)) && !nonMisura(f.via))
    || F.find(f => /(^|\.)(wind|vento)(\.value|\.val)?$/.test(k(f)) && !nonMisura(f.via))
    || F.find(f => /(wind|vento)\.[^.]*(speed|avg|media|value)/.test(k(f)) && !/gust|raffic|max|dir|min/.test(k(f)) && !nonMisura(f.via));
  if (!vento) return null;
  const raffica = F.find(f => /gust|raffic|wgust|wind_?max|maxwind/.test(k(f)) && !/dir/.test(k(f)) && !nonMisura(f.via));
  const dir = F.find(f => /(wind_?|vento_?)?(dir|direction|direzione)(\.value)?$|wdir|winddir|bearing/.test(k(f)) && num(f.v) >= 0 && num(f.v) <= 360 && !nonMisura(f.via));
  /* l'unita': accanto al valore ("unit": "km/h") o nel nome del campo */
  const uAccanto = vento.padre && typeof vento.padre === "object" ? unitaDa(vento.padre.unit || vento.padre.units || vento.padre.unita) : null;
  const eco = /windspeedmph|windgustmph/i.test(vento.via);
  const uNome = eco ? null : unitaDa(vento.k);   /* per Ecowitt il nome mente */
  return { campo: vento.via, vento: num(vento.v), raffica: raffica ? num(raffica.v) : null, dir: dir ? Math.round(num(dir.v)) : null,
           unita: uAccanto || (eco ? unitaEcowitt : null) || uNome || null };
}

/* ---------- il testo della pagina, se i dati non bastano ---------- */
function ventoDaTesto(t){
  const s = String(t || "").replace(/\s+/g, " ");
  const m = s.match(/(?:vento|wind|speed|velocit[aà])[^0-9]{0,40}(\d{1,2}(?:[.,]\d)?)\s*(kn|kts?|nodi|km\/?h|m\/?s|mph)\b/i)
    || s.match(/(\d{1,2}(?:[.,]\d)?)\s*(kn|kts|nodi)\b/i);
  if (!m) return null;
  const g = s.match(/(?:raffic[ae]|gust)[^0-9]{0,30}(\d{1,2}(?:[.,]\d)?)/i);
  return { campo:"testo della pagina", vento: +m[1].replace(",", "."), raffica: g ? +g[1].replace(",", ".") : null, dir: null, unita: unitaDa(m[2]) || "kn" };
}

async function leggiPagina(browser, st){
  const c = st.config || {}, url = c.url || st.link;
  if (!/^https?:\/\//.test(url || "")) return { errore:"manca l'indirizzo della pagina" };
  const rb = await robotsPermette(url); if (!rb.ok) return { errore: rb.motivo };
  /* Si presenta come un Chrome normale: alcuni siti, davanti a un browser
     "automatico", non caricano i dati. La firma KITEGO resta nel registro. */
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "it-IT",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" });
  const page = await ctx.newPage();
  const risposte = [], viste = [];
  page.on("response", async r => {
    try{
      const tipo = r.request().resourceType(), ct = (r.headers()["content-type"] || "").split(";")[0];
      if (!["xhr", "fetch", "document", "script", "other"].includes(tipo)) return;
      let testo = null; try{ testo = await r.text(); }catch(e){}
      const n = testo ? testo.length : 0;
      if (tipo === "xhr" || tipo === "fetch") viste.push(`${tipo} ${ct} ${n}b ${(()=>{ try{ const x = new URL(r.url()); return x.origin + x.pathname; }catch(e){ return "?"; } })()}`);
      if (!testo || n > 800000) return;
      /* qualunque etichetta abbia, se il corpo e' JSON si legge */
      const t = testo.trim(); if (!/^[{[]/.test(t)) return;
      try{ risposte.push({ url: r.url(), d: JSON.parse(t) }); }catch(e){}
    }catch(e){}
  });
  let esito = null;
  try{
    unitaEcowitt = null;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    /* IL BANNER DEI COOKIE (Resia, 25/9): la pagina resta ferma su "scelte di
       consenso" e i dati non partono. Si preme il tasto di consenso, se c'e'. */
    const consenso = async () => {
      for (const t of ["Accetta tutto", "Accetta tutti", "Accetta", "Accept all", "Accept", "Consenti tutti", "Consenti", "OK", "Ho capito", "Chiudi"]){
        try{ const b = page.getByRole("button", { name: t, exact: false }).first(); if (await b.isVisible({ timeout: 800 })){ await b.click({ timeout: 2000 }); await page.waitForTimeout(1500); return t; } }catch(e){}
      }
      return null;
    };
    const premuto = await consenso();
    if (premuto) console.log(`    premuto il consenso: "${premuto}"`);
    /* LA PAGINA CHIEDE I NUMERI IN PIU' TEMPI (Ecowitt: prima le impostazioni,
       poi i dati). Si aspetta fino a 30 secondi, e ci si ferma appena una
       risposta ha dentro il vento. Primo giro vero (25/9, Siponto): con 6
       secondi fissi si vedeva una risposta sola, senza vento. */
    const limite = Date.now() + Math.min(45000, 30000 + (+c.attesa_ms || 0));
    const trova = () => { for (const r of risposte.slice().reverse()){ const v = ventoDaJson(r.d); if (v && v.vento != null) return { ...v, fonte: r.url }; } return null; };
    while (Date.now() < limite){ await page.waitForTimeout(1500); esito = trova(); if (esito) break; }
    const senzaCodici = u => { try{ const x = new URL(u); return x.origin + x.pathname; }catch(e){ return String(u).slice(0, 80); } };
    console.log(`    risposte dati lette (${risposte.length}): ${[...new Set(risposte.map(r => senzaCodici(r.url)))].slice(0, 12).join(" | ") || "nessuna"}`);
    console.log(`    richieste della pagina (${viste.length}):\n      ${viste.slice(0, 25).join("\n      ") || "nessuna"}`);
    if (!esito){ const testo = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 400) : ""); console.log(`    inizio del testo della pagina: ${JSON.stringify(testo)}`); }
    /* LA HOME NON E' LA STAZIONE (Alghero, 25/9): zero richieste, ma nel menu
       c'e' "STAZIONE METEO". Si segue quel link, una volta, e si riprova. */
    if (!esito && !viste.length){
      const link = await page.evaluate(() => { const L = [...document.querySelectorAll("a[href]")];
        const t = L.find(a => /stazione\s*meteo|meteo\s*live|vento\s*(live|in diretta|reale)|live\s*wind|webcam/i.test(a.textContent || "") || /meteo|wind|webcam|stazione/i.test(a.getAttribute("href") || ""));
        return t ? t.href : null; });
      if (link && link !== url){
        console.log(`    seguo il link della stazione: ${link}`);
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await consenso();
        const limite2 = Date.now() + 25000;
        while (Date.now() < limite2){ await page.waitForTimeout(1500); esito = trova(); if (esito) break; }
        if (esito) esito.fonte = esito.fonte || link;
        if (!esito){ const t2 = await page.evaluate(() => document.body ? document.body.innerText : ""); const v2 = ventoDaTesto(t2); if (v2) esito = { ...v2, fonte: link }; }
      }
    }
    if (!esito){
      const testo = await page.evaluate(() => document.body ? document.body.innerText : "");
      const v = ventoDaTesto(testo); if (v) esito = { ...v, fonte: url };
    }
    if (unitaEcowitt) console.log(`    unita' Ecowitt dalla pagina: ${unitaEcowitt}`);
    if (!esito) return { errore:"la pagina si apre, ma dentro non trovo il vento (" + risposte.length + " risposte dati viste)" };
    const unita = c.unita || esito.unita || "kn";
    const kn = +aKn(esito.vento, unita).toFixed(1);
    if (!(kn >= 0 && kn <= 100)) return { errore:"vento letto " + kn + " kn: qualcosa non torna nell'unita' (" + unita + ")" };
    return { kn, raffica_kn: esito.raffica != null ? +aKn(esito.raffica, unita).toFixed(1) : null, dir: esito.dir, campo: esito.campo, fonte: esito.fonte, unita };
  }catch(e){ return { errore: String(e && e.message || e).slice(0, 160) }; }
  finally{ await ctx.close().catch(() => {}); }
}

async function main(){
  /* si leggono TUTTE le pagine affidate, accese o spente: leggere non pubblica
     niente, e' l'interruttore "accesa" (Plancia) che decide cosa vede l'utente.
     Cosi' una pagina appena affidata si prova prima di accenderla. */
  const r = await fetch(`${SB}/rest/v1/stazioni?select=spot_id,chi,link,config&tipo=eq.pagina`, { headers: H });
  if (!r.ok){ console.error("Supabase", r.status, await r.text()); process.exit(1); }
  const righe = await r.json();
  console.log(`Lente automatica: ${righe.length} pagine da leggere`);
  if (!righe.length) return;
  const browser = await chromium.launch();
  const ora = new Date().toISOString();
  let ok = 0;
  for (const st of righe){
    const e = await leggiPagina(browser, st);
    const riga = { spot_id: st.spot_id, letta: ora, quando: e.errore ? null : ora, kn: e.kn ?? null, raffica_kn: e.raffica_kn ?? null, dir: e.dir ?? null,
                   fonte: e.fonte || null, campo: e.campo || null, unita: e.unita || null, errore: e.errore || null };
    if (e.errore) console.log(`  ✗ ${st.spot_id}: ${e.errore}`); else { ok++; console.log(`  ✓ ${st.spot_id}: ${e.kn} kn${e.raffica_kn != null ? " (raffica " + e.raffica_kn + ")" : ""} da ${e.campo}`); }
    /* l'ultima lettura buona non si cancella con un errore: si aggiorna solo lo stato */
    const corpo = e.errore ? { spot_id: st.spot_id, letta: ora, errore: e.errore } : riga;
    const w = await fetch(`${SB}/rest/v1/pagina_letture?on_conflict=spot_id`, { method:"POST", headers: { ...H, Prefer:"resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(corpo) });
    if (!w.ok) console.log(`    (non salvata: Supabase ${w.status} ${(await w.text()).slice(0, 120)})`);
  }
  await browser.close();
  console.log(`fatto: ${ok} su ${righe.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
