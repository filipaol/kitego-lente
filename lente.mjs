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

function ventoDaJson(d){
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
  const uNome = unitaDa(vento.k);
  return { campo: vento.via, vento: num(vento.v), raffica: raffica ? num(raffica.v) : null, dir: dir ? Math.round(num(dir.v)) : null, unita: uAccanto || uNome || null };
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
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1200, height: 900 }, locale: "it-IT" });
  const page = await ctx.newPage();
  const risposte = [];
  page.on("response", async r => {
    try{
      const ct = r.headers()["content-type"] || "";
      if (!/json|javascript/i.test(ct) && !/\.json(\?|$)/.test(r.url())) return;
      const testo = await r.text(); if (!testo || testo.length > 800000) return;
      const t = testo.replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "");
      try{ risposte.push({ url: r.url(), d: JSON.parse(t) }); }catch(e){}
    }catch(e){}
  });
  let esito = null;
  try{
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    /* LA PAGINA CHIEDE I NUMERI IN PIU' TEMPI (Ecowitt: prima le impostazioni,
       poi i dati). Si aspetta fino a 30 secondi, e ci si ferma appena una
       risposta ha dentro il vento. Primo giro vero (25/9, Siponto): con 6
       secondi fissi si vedeva una risposta sola, senza vento. */
    const limite = Date.now() + Math.min(45000, 30000 + (+c.attesa_ms || 0));
    const trova = () => { for (const r of risposte.slice().reverse()){ const v = ventoDaJson(r.d); if (v && v.vento != null) return { ...v, fonte: r.url }; } return null; };
    while (Date.now() < limite){ await page.waitForTimeout(1500); esito = trova(); if (esito) break; }
    const senzaCodici = u => { try{ const x = new URL(u); return x.origin + x.pathname; }catch(e){ return String(u).slice(0, 80); } };
    console.log(`    risposte dati viste (${risposte.length}): ${[...new Set(risposte.map(r => senzaCodici(r.url)))].slice(0, 12).join(" | ") || "nessuna"}`);
    if (!esito){
      const testo = await page.evaluate(() => document.body ? document.body.innerText : "");
      const v = ventoDaTesto(testo); if (v) esito = { ...v, fonte: url };
    }
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
