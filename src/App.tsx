import { useEffect, useMemo, useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import logo from './assets/logo.webp';
import DotField from './DotField';
import {
  DSOS,
  generateBundle,
  generatePods,
  examplePodTemplate,
  type GeneratedFile,
  type InverterSpec,
} from './lib/generators';
import { DEVICE_BRANDS, DEVICE_TYPES, type DeviceModel } from './lib/deviceTypes';
import { getCookie, setCookie } from './lib/cookies';
import { Icon, type IconName } from './Icons';
import './App.css';

const APP_VERSION = 'v1.0.0';

const DEFAULT_SFTP = 'https://sftp.uat.enap.oci/web/client/files';
const DEFAULT_SWAGGER =
  'https://device-data-receiver.uat.enap.oci/swagger/swagger-ui/index.html#/dso-controller/congestMasterData';
const PGWEB_URL = 'https://pgweb-ui.uat.enap.oci/#';

// Feltöltés-ellenőrző SQL a pgweb-hez (file-processor-db → public.file_metadata).
// A DONE státusz a file_processed_status oszlopban jelzi a sikeres feldolgozást.
function buildCheckQuery(names: string[]): string {
  const list = names.length
    ? names.map((n) => `    '${n.replace(/'/g, "''")}'`).join(',\n')
    : "    ''";
  return `SELECT
    file_name,
    file_type,
    file_processed_status,
    file_sender,
    file_receiver,
    file_selection_start_time,
    file_selection_end_time,
    file_processed_at,
    created_at
FROM public.file_metadata
WHERE file_name IN (
${list}
)
ORDER BY created_at DESC;`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return toInput(d); };
const today = () => toInput(new Date());
// Véletlen, közeli dátum (utolsó ~60 nap) – a SZINKRON fájlnév egyediségéhez, parser-biztosan (dátum marad).
const randomRecentDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * 60));
  return toInput(d);
};

// Inverter gyártó/modell – a pod-registry-db DeviceTypes adataiból
const FIRST_BRAND = DEVICE_TYPES['BYD'] ? 'BYD' : DEVICE_BRANDS[0];
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

// A beillesztett, VALÓDI POD-ok: soronként/elválasztóval, trimmelve, üresek nélkül, duplikátum-mentesen.
const PODS_KEY = 'enap_real_pods';
function parsePods(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? '').split(/[\s,;]+/)) {
    const p = raw.trim();
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

function download(file: GeneratedFile) {
  // application/octet-stream → a böngésző MINDIG letölti, nem nyitja meg előnézetben
  // (ez fordulhatott elő az XML-nél). A tényleges típus a kiterjesztésből (.xml/.csv/.json) látszik.
  const blob = new Blob([file.content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // A nagy fájlok (hosszú mérési idősor → nagy MAVIR XML) letöltése eltarthat;
  // ezért csak jóval később szabadítjuk fel a blob URL-t, különben a letöltés megszakadhat.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Fogd-és-vidd a böngészőből egy mappába/asztalra (Chrome/Edge: DownloadURL).
// Onnan a fájl behúzható az SFTP „Upload Files” drop-zónájába (közvetlenül a másik fülbe nem lehet).
function dragOutFile(e: React.DragEvent, file: GeneratedFile) {
  const blob = new Blob([file.content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    e.dataTransfer.setData('DownloadURL', `application/octet-stream:${file.name}:${url}`);
    e.dataTransfer.setData('text/plain', file.name);
  } catch {
    /* a böngésző nem támogatja a DownloadURL-t (pl. Firefox) – marad a Letöltés gomb */
  }
  e.dataTransfer.effectAllowed = 'copy';
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Az összes generált fájl egyetlen ZIP-be csomagolva, böngészőben (fflate – nincs szerver).
function downloadZip(files: GeneratedFile[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = strToU8(f.content);
  const zipped = zipSync(entries, { level: 6 });
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Fájlnév: enap-kep_YYYYMMDD_HHmm.zip — a dátum mellett az óra:perc is benne van (egyedibb).
  const now = new Date();
  const stamp = `${toInput(now).replace(/-/g, '')}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  a.download = `enap-kep_${stamp}.zip`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// A generált fájlok megőrzése oldal-újratöltésnél (localStorage – túléli a frissítést is).
const FILES_KEY = 'enap_generated_files';

function loadStoredFiles(): GeneratedFile[] | null {
  try {
    const raw = localStorage.getItem(FILES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeneratedFile[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

// Cookie-alapú, megjegyzett beállítás (név, téma, URL-ek).
function useCookie(key: string, initial: string) {
  const [v, setV] = useState(() => getCookie(key) ?? initial);
  useEffect(() => { setCookie(key, v); }, [key, v]);
  return [v, setV] as const;
}

type View = 'generate' | 'settings' | 'about';

export default function App() {
  const [theme, setTheme] = useCookie('theme', 'light');
  const [name, setName] = useCookie('name', '');
  const [sftpUrl, setSftpUrl] = useCookie('sftpUrl', DEFAULT_SFTP);
  const [swaggerUrl, setSwaggerUrl] = useCookie('swaggerUrl', DEFAULT_SWAGGER);

  const [view, setView] = useState<View>('generate');
  const [cookieOk, setCookieOk] = useState(() => getCookie('cookie_consent') === '1');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // POD-forrás: automatikus generálás vagy valódi POD-ok beillesztése.
  const [podMode, setPodMode] = useState<'auto' | 'paste'>('auto');
  const [count, setCount] = useState('5');
  const [dso, setDso] = useState('EHE000210');
  const [podBody, setPodBody] = useState('F11-S');
  const [podsText, setPodsText] = useState(() => {
    try { return localStorage.getItem(PODS_KEY) ?? ''; } catch { return ''; }
  });
  const [from, setFrom] = useState(yesterday());
  const [genDate, setGenDate] = useState(today());
  const [szinkron, setSzinkron] = useState(true);
  const [meres, setMeres] = useState(true);
  const [inverter, setInverter] = useState(false);

  const [brand, setBrand] = useState(FIRST_BRAND);
  const initModel = DEVICE_TYPES[FIRST_BRAND]?.[0];
  const [model, setModel] = useState(initModel?.model ?? '');
  const [power, setPower] = useState(str(initModel?.nominalPower));
  const [vmin, setVmin] = useState(str(initModel?.acVoltageMin));
  const [vmax, setVmax] = useState(str(initModel?.acVoltageMax));
  const [invDate, setInvDate] = useState(today());

  // A modell értékeit (nominal/min/max) automatikusan kitölti; a gyártóváltás az első modellt veszi.
  function applyModel(rec: DeviceModel | undefined) {
    if (!rec) return;
    setModel(rec.model);
    setPower(str(rec.nominalPower));
    setVmin(str(rec.acVoltageMin));
    setVmax(str(rec.acVoltageMax));
  }
  function onBrandChange(b: string) {
    setBrand(b);
    applyModel(DEVICE_TYPES[b]?.[0]);
  }
  function onModelChange(m: string) {
    applyModel(DEVICE_TYPES[brand]?.find((x) => x.model === m));
  }

  const [files, setFiles] = useState<GeneratedFile[] | null>(loadStoredFiles);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  // A generált fájlokat megőrizzük újratöltésnél; üres lista esetén töröljük.
  useEffect(() => {
    try {
      if (files && files.length) localStorage.setItem(FILES_KEY, JSON.stringify(files));
      else localStorage.removeItem(FILES_KEY);
    } catch {
      /* localStorage tele / nem elérhető – a letöltés/másolás így is működik */
    }
  }, [files]);

  // A beillesztett valódi POD-okat is megőrizzük újratöltésnél.
  useEffect(() => {
    try { localStorage.setItem(PODS_KEY, podsText); } catch { /* nem elérhető */ }
  }, [podsText]);

  // A felismert POD-ok és a gyanús (nem 33 karakteres) elemek.
  const realPods = useMemo(() => parsePods(podsText), [podsText]);
  const badPods = useMemo(() => realPods.filter((p) => p.length > 33), [realPods]);

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setError('A vágólapra másolás nem sikerült (a böngésző blokkolta).');
    }
  }

  // A feltöltés-ellenőrző lekérdezés a pgweb-hez (file-processor-db): az SFTP-s fájlok
  // (SZINKRON CSV + MAVIR XML) nevét dinamikusan az IN (...) listába teszi.
  const sftpNames = useMemo(
    () => (files ?? []).filter((f) => f.target === 'sftp').map((f) => f.name),
    [files],
  );
  const checkQuery = useMemo(() => buildCheckQuery(sftpNames), [sftpNames]);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const greeting = useMemo(
    () => (name.trim() ? `Üdv, ${name.trim()}!` : 'POD-ok, mérés és inverter generálása'),
    [name],
  );

  function onGenerate() {
    setError('');
    let pods: string[];
    if (podMode === 'auto') {
      const n = parseInt(count, 10);
      if (!Number.isFinite(n) || n < 1) { setError('Adj meg egy pozitív POD-darabszámot.'); return; }
      pods = generatePods(n, dso, podBody);
    } else {
      if (!realPods.length) { setError('Illessz be legalább egy valódi POD-ot (soronként egyet).'); return; }
      pods = realPods;
    }
    if (!from) { setError('Válassz érvényes mérés-kezdő dátumot.'); return; }
    if (!szinkron && !meres && !inverter) { setError('Pipálj ki legalább egy kimenetet.'); return; }

    const spec: InverterSpec = {
      brand,
      model: model.trim() || 'N/A',
      nominalPower: parseInt(power, 10) || 0,
      acVoltageMin: parseInt(vmin, 10) || 0,
      acVoltageMax: parseInt(vmax, 10) || 0,
      installationDate: invDate || today(),
    };
    const fromDate = new Date(from + 'T00:00:00');
    const genDateD = new Date((genDate || today()) + 'T00:00:00');
    const res = generateBundle(pods, fromDate, genDateD, { szinkron, meres, inverter }, spec);
    setFiles(res.files);
  }

  const targetLabel = (t: string) => (t === 'swagger' ? 'Swagger UI' : 'SFTP web kliens');
  const targetUrl = (t: string) => (t === 'swagger' ? swaggerUrl : sftpUrl);

  const nav: { id: View; icon: IconName; label: string }[] = [
    { id: 'generate', icon: 'zap', label: 'Generálás' },
    { id: 'settings', icon: 'settings', label: 'Beállítások' },
    { id: 'about', icon: 'info', label: 'Névjegy' },
  ];

  return (
    <>
      <div className="bg-dots" aria-hidden="true">
        <DotField
          dotRadius={1.5}
          dotSpacing={14}
          bulgeStrength={67}
          glowRadius={160}
          sparkle={false}
          waveAmplitude={0}
          glowColor={theme === 'dark' ? 'rgba(99, 102, 241, 0.20)' : 'rgba(99, 102, 241, 0.12)'}
        />
      </div>

      <div className="shell">
        <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="brand">
            <img src={logo} alt="FEAK" />
            <div>
              <div className="brand-name">ENAP - KEP</div>
              <div className="brand-sub">adatgenerátor</div>
            </div>
          </div>
          <nav className="nav">
            {nav.map((n) => (
              <button
                key={n.id}
                className={`nav-item${view === n.id ? ' active' : ''}`}
                onClick={() => setView(n.id)}
              >
                <span className="nav-ic"><Icon name={n.icon} size={18} /></span>
                <span className="nav-lbl">{n.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <button
              className="ghost block theme-btn"
              title={sidebarCollapsed ? 'Oldalsáv kinyitása' : 'Oldalsáv összecsukása'}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <Icon name={sidebarCollapsed ? 'chevron-right' : 'chevron-left'} size={16} />
              <span className="btn-lbl">Összecsukás</span>
            </button>
            <button className="ghost block theme-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
              <span className="btn-lbl">{theme === 'dark' ? 'Világos téma' : 'Sötét téma'}</span>
            </button>
            <div className="version">{APP_VERSION}</div>
          </div>
        </aside>

        <main className={`content${view === 'generate' ? ' content-gen' : ''}`}>
          {view === 'generate' && (
            <>
              <header className="page-head">
                <h1>ENAP - KEP adatgenerátor</h1>
                <p>{greeting}</p>
              </header>

              <div className="gen-layout">
                <div className="gen-left">
              <section className="card">
                <h2>Mit generáljunk?</h2>
                <p className="desc">
                  Válaszd ki a POD-forrást: a generátor <b>automatikusan</b> előállítja a POD-okat (az ENAP-doksi
                  szerinti formátumban: <code>HU000&lt;DSO&gt; + törzs + sorszám</code>), vagy beilleszthetsz
                  <b> valódi</b> registry-POD-okat. A kipipált fájlok mind UGYANARRA a POD-készletre készülnek; a DSO-t
                  (dsoNo / Eloszto) a POD-ból vezetjük le. A mérés a kezdettől a MOSTANI időig 15 perces felbontással.
                </p>

                <div className="mode-tabs">
                  <button className={podMode === 'auto' ? 'active' : ''} onClick={() => setPodMode('auto')}>
                    Automatikus generálás
                  </button>
                  <button className={podMode === 'paste' ? 'active' : ''} onClick={() => setPodMode('paste')}>
                    Valódi POD-ok beillesztése
                  </button>
                </div>

                {podMode === 'auto' ? (
                  <>
                    <div className="grid3">
                      <label>
                        <span>POD-ok száma</span>
                        <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
                      </label>
                      <label>
                        <span>DSO (Eloszto)</span>
                        <select value={dso} onChange={(e) => setDso(e.target.value)}>
                          {DSOS.map((d) => (
                            <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>POD törzs (jelölő)</span>
                        <input
                          type="text"
                          value={podBody}
                          placeholder="F11-S"
                          onChange={(e) => setPodBody(e.target.value)}
                        />
                      </label>
                    </div>
                    <p className="hint">
                      Minta POD (1.): <code>{examplePodTemplate(dso, podBody)}</code> — a törzs után a sorszám
                      nullával <b>33 karakterre</b> töltve (ezt várja a master-data: <code>F11-S</code> + 20 számjegy).
                    </p>
                  </>
                ) : (
                  <>
                    <label className="full">
                      <span>Valódi POD-ok (soronként egy)</span>
                      <textarea
                        className="pods-input"
                        rows={6}
                        value={podsText}
                        onChange={(e) => setPodsText(e.target.value)}
                        placeholder={'HU000210F51-U-000000000000HARVEYS\nHU000210D121S1CRV9DL516HT2EQ7LF8B'}
                      />
                    </label>
                    <p className="hint">
                      <b>{realPods.length}</b> POD felismerve. A mérés vége mindig a mostani idő (automatikus).
                    </p>
                    {badPods.length > 0 && (
                      <p className="hint warn">
                        ⚠ {badPods.length} POD hosszabb 33 karakternél (a DDR max 33-at enged) — ellenőrizd: <code>{badPods[0]}</code>
                        {badPods.length > 1 ? ` …(+${badPods.length - 1})` : ''}
                      </p>
                    )}
                  </>
                )}

                <div className="grid3" style={{ marginTop: 12 }}>
                  <label>
                    <span>Mérés kezdete (Datum1)</span>
                    <input type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label>
                    <span>Generálás dátuma (Datum2 · fájlnév)</span>
                    <div className="field-row">
                      <input type="date" value={genDate} max={today()} onChange={(e) => setGenDate(e.target.value)} />
                      <button
                        type="button"
                        className="ghost sm dice-btn"
                        title="Véletlen közeli dátum – egyedi SZINKRON fájlnévhez"
                        onClick={() => setGenDate(randomRecentDate())}
                      >
                        🎲
                      </button>
                    </div>
                  </label>
                </div>
                <p className="hint">
                  A SZINKRON fájlnév vége <code>…_{from.replaceAll('-', '')}_{genDate.replaceAll('-', '')}.csv</code> —
                  a <b>🎲</b>-val egyedivé teheted (a parser csak dátumot fogad el itt, ezért nem tehetünk bele időt/véletlen szöveget).
                </p>

                <div className="checks">
                  <label className="check"><input type="checkbox" checked={szinkron} onChange={(e) => setSzinkron(e.target.checked)} /> <span>SZINKRON törzsadat (CSV) → SFTP</span></label>
                  <label className="check"><input type="checkbox" checked={meres} onChange={(e) => setMeres(e.target.checked)} /> <span>MAVIR mérés (XML) → SFTP</span></label>
                  <label className="check"><input type="checkbox" checked={inverter} onChange={(e) => setInverter(e.target.checked)} /> <span>Inverter hozzárendelés (JSON) → Swagger</span></label>
                </div>

                {error && <p className="error">{error}</p>}
                <button className="primary" onClick={onGenerate}>Generálás</button>
              </section>

              {inverter && (
                <section className="card">
                  <h2>Inverter gyártói adatok</h2>
                  <p className="desc">
                    A pod-registry-db DeviceTypes táblából. Válassz gyártót, majd a hozzá tartozó modellek közül – a
                    nominalPower / acVoltageMin / acVoltageMax a modell alapján automatikusan kitöltődik (felülírható).
                    A serialNumber = POD + _INV.
                  </p>
                  <div className="grid3">
                    <label>
                      <span>Gyártó (brand)</span>
                      <select value={brand} onChange={(e) => onBrandChange(e.target.value)}>
                        {DEVICE_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Modell</span>
                      <select value={model} onChange={(e) => onModelChange(e.target.value)}>
                        {(DEVICE_TYPES[brand] ?? []).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
                      </select>
                    </label>
                    <label><span>Telepítés dátuma</span><input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></label>
                    <label><span>nominalPower</span><input type="number" value={power} onChange={(e) => setPower(e.target.value)} /></label>
                    <label><span>acVoltageMin</span><input type="number" value={vmin} onChange={(e) => setVmin(e.target.value)} /></label>
                    <label><span>acVoltageMax</span><input type="number" value={vmax} onChange={(e) => setVmax(e.target.value)} /></label>
                  </div>
                </section>
              )}

              {sftpNames.length > 0 && (
                <section className="card side-panel">
                  <div className="panel-head">
                    <button className="panel-toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
                      <Icon name="database" size={15} />
                      <span className="panel-title-text">Feltöltés ellenőrzése — pgweb (<b>file-processor-db</b>)</span>
                    </button>
                    <div className="head-actions">
                      <button className="primary sm" onClick={() => copyText(checkQuery, '__query__')}>
                        {copied === '__query__'
                          ? <><Icon name="check" size={15} /> Másolva</>
                          : <><Icon name="copy" size={15} /> Lekérdezés másolása</>}
                      </button>
                      <a className="ghost sm" href={PGWEB_URL} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> pgweb megnyitása</a>
                      <button className="ghost sm panel-chevron" onClick={() => setPanelOpen((v) => !v)} aria-label={panelOpen ? 'Összecsukás' : 'Kinyitás'}>
                        <Icon name={panelOpen ? 'chevron-down' : 'chevron-right'} size={16} />
                      </button>
                    </div>
                  </div>
                  {panelOpen && (
                    <>
                      <textarea className="check-sql" readOnly rows={10} value={checkQuery} onFocus={(e) => e.currentTarget.select()} />
                      <p className="hint">
                        Futtasd a <b>public.file_metadata</b> táblán. <code>file_processed_status</code> = <b>DONE</b> → sikeres.
                      </p>
                    </>
                  )}
                </section>
              )}
                </div>

                <div className="gen-right">
              {files && files.length > 0 ? (
                <section className="card">
                  <div className="card-head">
                    <h2>Generált fájlok</h2>
                    <div className="head-actions">
                      <button className="primary sm" onClick={() => downloadZip(files)}>
                        <Icon name="archive" size={15} /> Összes letöltése (ZIP)
                      </button>
                      <button className="ghost sm" onClick={() => setFiles(null)}>
                        <Icon name="trash" size={15} /> Lista törlése
                      </button>
                    </div>
                  </div>
                  <p className="desc">
                    Töltsd le vagy másold a fájlt, majd a jobb oldali linken nyisd meg a felületet, ahova be kell tölteni.
                    A lista <b>megőrződik</b> oldal-újratöltésnél is, amíg nem törlöd vagy nem generálsz újat.
                  </p>
                  <p className="safe-note">
                    <Icon name="check" size={14} /> A fájlok egyszerű <b>szövegfájlok</b> (CSV / XML / JSON) – ártalmatlanok.
                    Ha a böngésző letöltéskor figyelmeztet, az a friss domain miatti téves jelzés. A <b>JSON</b>-t a
                    „Másolás” gombbal letöltés nélkül is beillesztheted a Swaggerbe.
                  </p>
                  <p className="hint">
                    💡 A fájlt a sor elején lévő <Icon name="grip" size={13} /> fogantyúnál <b>fogd-és-viheted</b> egy
                    mappába vagy az asztalra (Chrome/Edge), onnan pedig az SFTP „Upload Files” zónájába húzva.
                  </p>
                  <div className="results">
                    {files.map((f) => (
                      <div className="result-row" key={f.name}>
                        <div
                          className="rfile"
                          draggable
                          onDragStart={(e) => dragOutFile(e, f)}
                          title="Fogd és húzd egy mappába / az asztalra (Chrome/Edge), majd onnan az SFTP-be"
                        >
                          <span className="rgrip" aria-hidden="true"><Icon name="grip" size={16} /></span>
                          <div className="rfile-text">
                            <div className="rname">{f.name}</div>
                            <div className="rhint">{f.hint} · {f.meta}</div>
                          </div>
                        </div>
                        <div className="ractions">
                          <button className="primary sm" onClick={() => download(f)}><Icon name="download" size={15} /> Letöltés</button>
                          <button className="ghost sm" onClick={() => copyText(f.content, f.name)}>
                            {copied === f.name
                              ? <><Icon name="check" size={15} /> Másolva</>
                              : <><Icon name="copy" size={15} /> Másolás</>}
                          </button>
                          <a className="ghost sm" href={targetUrl(f.target)} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> {targetLabel(f.target)}</a>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="card gen-empty">
                  <h2>Generált fájlok</h2>
                  <p className="desc">Itt jelennek meg a fájlok a <b>Generálás</b> után — letöltés, másolás és a pgweb-ellenőrző lekérdezés a bal oldali panelen.</p>
                </section>
              )}
                </div>
              </div>
            </>
          )}

          {view === 'settings' && (
            <>
              <header className="page-head">
                <h1>Beállítások</h1>
                <p>A név és a felület-URL-ek cookie-ban tárolódnak ezen a gépen.</p>
              </header>
              <section className="card">
                <h2>Megszólítás</h2>
                <p className="desc">A megadott név a köszöntésben jelenik meg (cookie-ban tárolva).</p>
                <label className="full"><span>Név</span><input value={name} placeholder="pl. Ferenc" onChange={(e) => setName(e.target.value)} /></label>
              </section>
              <section className="card">
                <h2>Beküldési felületek</h2>
                <p className="desc">A generált fájlok melletti linkek ezekre mutatnak.</p>
                <label className="full"><span>SFTP web kliens (SZINKRON / MAVIR)</span><input value={sftpUrl} onChange={(e) => setSftpUrl(e.target.value)} /></label>
                <label className="full" style={{ marginTop: 12 }}><span>Swagger UI (inverter)</span><input value={swaggerUrl} onChange={(e) => setSwaggerUrl(e.target.value)} /></label>
              </section>
            </>
          )}

          {view === 'about' && (
            <>
              <header className="page-head">
                <h1>Névjegy</h1>
                <p>ENAP - KEP adatgenerátor</p>
              </header>
              <section className="card">
                <p className="desc">
                  Ez az eszköz a böngésződben generál beküldendő fájlokat: <b>SZINKRON</b> törzsadat (CSV),
                  <b> MAVIR</b> mérés (XML) és <b>inverter</b> hozzárendelés (JSON) – mind ugyanarra a POD-készletre.
                  Semmilyen adat nem kerül szerverre; a fájlokat te töltöd fel az SFTP-re, illetve illeszted a Swagger UI-ba.
                </p>
                <p className="desc" style={{ marginBottom: 0 }}>
                  Sütik (cookie-k): kizárólag <b>funkcionális</b> célból – a megszólítás (név), a téma és a felület-URL-ek
                  megjegyzésére ezen a gépen. Nincs követés, nincs analitika, nincs harmadik fél.
                </p>
              </section>
            </>
          )}
        </main>
      </div>

      {!cookieOk && (
        <div className="cookie-banner" role="dialog" aria-label="Cookie tájékoztató">
          <span className="cookie-ic"><Icon name="cookie" size={22} /></span>
          <div className="cookie-text">
            Ez az oldal <b>funkcionális sütiket</b> használ a beállításaid (pl. a köszöntéshez megadott <b>név</b>,
            a téma és az URL-ek) megjegyzésére. Követés nincs.
          </div>
          <button className="primary sm" onClick={() => { setCookie('cookie_consent', '1'); setCookieOk(true); }}>
            Elfogadom
          </button>
        </div>
      )}

      <div className="credit">Az oldalt készítette: <b>Modroczky Ferenc</b></div>
    </>
  );
}
