/* ==========================================================================
   KITEGO — SCOVA (55.511): cerca da sola i siti delle sezioni della Lega
   Navale e vede se hanno una centralina o una webcam.

   Il sito nazionale della LNI non si lascia leggere dalle macchine, e va
   rispettato. Ma le sezioni si danno quasi tutte lo stesso nome di dominio:
   lnigrado.it, lnimandello.com, leganavalenapoli.it, leganavaleostia.it...
   Allora si prova, per ogni citta' con uno spot in KITEGO, i nomi piu'
   probabili, e si guarda la home: se parla di stazione meteo, webcam,
   vento, o usa un servizio noto (Ecowitt, Holfuy, Davis WeatherLink,
   MeteoTemplate, Wunderground...), si segna. Niente di piu': una pagina per
   sito, con la firma KITEGO, e i robots.txt rispettati.
   L'esito e' nel registro del giro: righe "TROVATO ...", da copiare nel
   catalogo delle scuole. Si lancia a mano (Run workflow), non ogni ora.
   ========================================================================== */
const UA = "KITEGO-Scova/1.0 (+https://kitego.it; cerca centraline pubbliche dei circoli)";
const slug = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(marina di|lido di|santa|santo|san|la|il|lo|di|del|della|dello|degli|delle|al)\b/g, " ")
  .replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);

async function robotsPermette(origin){
  try{ const r = await fetch(origin + "/robots.txt", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return true; const t = await r.text(); let mio = false;
    for (const riga of t.split(/\r?\n/)){ const l = riga.replace(/#.*/, "").trim(); const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
      if (m[1].toLowerCase() === "user-agent") mio = m[2].trim() === "*" || /kitego/i.test(m[2]);
      else if (mio && m[1].toLowerCase() === "disallow" && m[2].trim() === "/") return false; }
    return true; }catch(e){ return true; }
}
const SEGNI = [
  [/ecowitt\.net|ecowitt/i, "Ecowitt"], [/holfuy/i, "Holfuy"], [/weatherlink|davis/i, "Davis WeatherLink"],
  [/meteotemplate/i, "MeteoTemplate"], [/wunderground|weather underground/i, "Weather Underground"],
  [/windguru/i, "Windguru"], [/meteosystem/i, "MeteoSystem"], [/vedetta\.org/i, "Vedetta"], [/windy\.com/i, "Windy"],
  [/stazione\s*meteo|dati\s*meteo|meteo\s*(in\s*)?tempo\s*reale|meteo\s*live|anemometro|vento\s*(in\s*)?diretta|live\s*wind/i, "pagina meteo"],
  [/webcam|web\s*cam|telecamera/i, "webcam"],
];
async function guarda(url){
  try{
    const u = new URL(url); if (!(await robotsPermette(u.origin))) return { url, stato:"robots" };
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok) return { url, stato: "http " + r.status };
    const html = (await r.text()).slice(0, 400000);
    const lni = /lega\s*navale|\bl\.?n\.?i\.?\b/i.test(html);
    const segni = SEGNI.filter(([re]) => re.test(html)).map(([, n]) => n);
    const link = (html.match(/href=["']([^"']*(meteo|webcam|vento|wind|stazione)[^"']*)["']/i) || [])[1] || null;
    return { url: r.url, stato:"ok", lni, segni, link: link ? new URL(link, r.url).href : null };
  }catch(e){ return { url, stato:"no" }; }
}
async function main(){
  const S = await (await fetch("https://kitego.it/data/spots-italia.json")).json();
  const citta = new Map();
  for (const s of S){ for (const nome of [s.city, s.name]){ if (!nome) continue; const parti = slug(nome); if (!parti.length) continue;
    for (const c of [parti.join(""), parti[0]]) if (c.length >= 4 && !/^(lago|spiaggia|beach|lido|isola)$/.test(c)) citta.set(c, nome); } }
  const cand = [];
  for (const [c, nome] of citta) for (const d of [`https://www.lni${c}.it`, `https://lni${c}.it`, `https://www.lni${c}.com`, `https://www.leganavale${c}.it`, `https://leganavale${c}.it`, `https://www.lni-${c}.it`])
    cand.push({ url: d, citta: nome });
  console.log(`Scova: ${citta.size} citta', ${cand.length} indirizzi da provare`);
  const trovati = []; let i = 0;
  const lavora = async () => { while (i < cand.length){ const c = cand[i++]; const e = await guarda(c.url);
    if (e.stato === "ok" && e.lni){ trovati.push({ ...e, citta: c.citta }); console.log(`  TROVATO ${c.citta}: ${e.url}${e.segni.length ? "  [" + e.segni.join(", ") + "]" : ""}${e.link ? "  -> " + e.link : ""}`); } } };
  await Promise.all(Array.from({ length: 12 }, lavora));
  console.log(`\nfatto: ${trovati.length} siti di sezioni LNI trovati, ${trovati.filter(t => t.segni.length).length} con meteo/webcam`);
  console.log("\nRIEPILOGO (da copiare):");
  for (const t of trovati) console.log(JSON.stringify({ citta: t.citta, sito: t.url, segni: t.segni, pagina: t.link }));
}
main().catch(e => { console.error(e); process.exit(1); });
