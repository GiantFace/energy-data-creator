import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { zipSync, strToU8 } from 'fflate';
import logo from './assets/logo.webp';
import DotField from './DotField';
import {
  DSOS,
  BALANCE_RESPONSIBLES,
  generateBundle,
  generatePods,
  examplePodTemplate,
  mavirXmlChunks,
  mavirSplitPlan,
  mavirFileNames,
  buildEnergyReport,
  reportFileName,
  parseSzinkron,
  szinkronKeyRows,
  type GeneratedFile,
  type InverterSpec,
  type MsconstSpec,
} from './lib/generators';
import { DEVICE_BRANDS, DEVICE_TYPES, type DeviceModel } from './lib/deviceTypes';
import { getCookie, setCookie } from './lib/cookies';
import { Icon, type IconName } from './Icons';
import './App.css';

const APP_VERSION = 'v1.0.0';

const DEFAULT_SFTP = 'https://sftp.uat.enap.oci/web/client/files';
const DEFAULT_SWAGGER =
  'https://device-data-receiver.uat.enap.oci/swagger/swagger-ui/index.html#/inverter-controller/receiveMasterDataFromManufacturer_1';
// Inverter MÉRÉSADAT (v1.2 inverter-controller) – külön a párosítás (master-data) végpontjától.
const DEFAULT_SWAGGER_MEAS =
  'https://device-data-receiver.uat.enap.oci/swagger/swagger-ui/index.html#/inverter-controller/receiveMeasurementData_3';
const PGWEB_URL = 'https://pgweb-ui.uat.enap.oci/#';
// RabbitMQ Management UI – ide kell publikálni az inverter-párosítást (pod-registry.inverter-pod-data).
const DEFAULT_RABBIT = 'https://rabbitmq-ui.uat.enap.oci/#/exchanges';
// mongo-express (pod-registry-db Messages) – az inverter beküldés sikere a serialNumber alapján.
const DEFAULT_MONGO = 'https://pod-registry-mongodb-express.uat.enap.oci/db/pod-registry-db/Messages';

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

// Véletlen POD-törzs (változó hosszú, nagybetű + szám) – minden oldalbetöltéskor más,
// hogy ne mindig ugyanazt a POD-ot generálja (elkerüli az ütközést a betöltésnél).
function randomPodBody(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const len = 6 + Math.floor(Math.random() * 6); // 6..11 karakter
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// A generált fájlok csoportjai – EBBEN a sorrendben, összecsukható szekciókban.
const FILE_GROUPS: { key: string; label: string }[] = [
  { key: 'szinkron', label: 'SZINKRON törzsadat (CSV) → SFTP' },
  { key: 'mavir', label: 'MAVIR mérés (XML) → SFTP' },
  { key: 'msconst', label: 'MSCONST (MAVIR EDW_XML, konstans) → SFTP' },
  { key: 'master', label: 'Inverter gyártói törzsadat → Swagger' },
  { key: 'pair', label: 'Inverter párosítás → RabbitMQ' },
  { key: 'meas', label: 'Inverter mérésadat (v1.2) → Swagger' },
];
function fileGroup(f: GeneratedFile): string {
  switch (f.target) {
    case 'rabbit': return 'pair';
    case 'measurement': return 'meas';
    case 'swagger': return 'master';
    case 'msconst': return 'msconst';
    case 'report': return 'mavir'; // energia-összesítő a MAVIR mellett
    default: return f.mime === 'text/csv' || f.name.startsWith('Szinkron') ? 'szinkron' : 'mavir';
  }
}

// Összecsukható kártya: a fejlécre kattintva nyílik/csukódik. Generálás után a rendszer
// automatikusan összecsukja őket, hogy a lekérdezések/eredmények jobban láthatóak legyenek.
function CollapsibleCard({ title, collapsed, onToggle, children }: { title: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="card">
      <button className="card-collapse-head" onClick={onToggle} aria-expanded={!collapsed}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} />
        <h2>{title}</h2>
      </button>
      {!collapsed && children}
    </section>
  );
}

function download(file: GeneratedFile) {
  // application/octet-stream → a böngésző MINDIG letölti, nem nyitja meg előnézetben
  // (ez fordulhatott elő az XML-nél). A tényleges típus a kiterjesztésből (.xml/.csv/.json) látszik.
  // Nagy fájlnál a kész Blob-ot használjuk (nincs óriási sztring a memóriában).
  const blob = file.blob ?? new Blob([file.content], { type: 'application/octet-stream' });
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
  const blob = file.blob ?? new Blob([file.content], { type: 'application/octet-stream' });
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

// Eddig a méretig (pl. rövid idősoros MAVIR XML) a Blob-os fájl is bekerül a ZIP-be;
// a nagyobbak (és a lemezre streamelt) maradnak külön, közvetlen letöltéssel.
const ZIP_INCLUDE_CAP = 64 * 1024 * 1024; // 64 MB

// Az összes generált fájl egyetlen ZIP-be csomagolva, böngészőben (fflate – nincs szerver).
async function downloadZip(files: GeneratedFile[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    if (f.savedToDisk) continue;                   // nincs memóriában (lemezre streamelt) – marad külön
    if (f.blob) {
      if (f.blob.size > ZIP_INCLUDE_CAP) continue; // túl nagy – marad külön, közvetlen letöltés
      entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
    } else {
      entries[f.name] = strToU8(f.content);
    }
  }
  if (!Object.keys(entries).length) return;
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

// A MAVIR mérés felső korlátja: ennél több adatpontból a böngésző nem tud egy fájlt építeni
// (~80 karakter/pont → string-méret/memória korlát). E felett a generálás nem indul el.
const MAVIR_POINTS_CAP = 2_000_000;
const FIFTEEN_MIN_MS = 15 * 60_000;

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

// Cookie + localStorage együtt: a süti egyes böngészőkben megbízhatatlan (törlődhet),
// ezért a localStorage a tartalék – így a név/téma/URL biztosan megmarad frissítés után is.
function useCookie(key: string, initial: string) {
  const [v, setV] = useState(() => {
    const c = getCookie(key);
    if (c != null) return c;
    try { return localStorage.getItem('enap_' + key) ?? initial; } catch { return initial; }
  });
  useEffect(() => {
    setCookie(key, v);
    try { localStorage.setItem('enap_' + key, v); } catch { /* nem elérhető */ }
  }, [key, v]);
  return [v, setV] as const;
}

// Form-mezők megőrzése localStorage-ban (túléli a frissítést, süti nélkül is).
function useLocalStorage(key: string, initial: string) {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem('enap_' + key) ?? initial; } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem('enap_' + key, v); } catch { /* kvóta/nem elérhető */ }
  }, [key, v]);
  return [v, setV] as const;
}

// Logikai (checkbox) beállítás megőrzése localStorage-ban.
function useLocalBool(key: string, initial: boolean) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem('enap_' + key); return s == null ? initial : s === '1'; }
    catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem('enap_' + key, v ? '1' : '0'); } catch { /* nem elérhető */ }
  }, [key, v]);
  return [v, setV] as const;
}

type View = 'generate' | 'szinkron' | 'settings' | 'about';

// Egy feltöltött (és szerkeszthető) SZINKRON profil – böngésző-cache-ben (localStorage), nincs DB.
type SavedSzinkron = { id: string; name: string; createdAt: string; columns: string[]; rows: Record<string, string>[]; selectedPods?: string[] };

export default function App() {
  const [theme, setTheme] = useCookie('theme', 'light');
  const [name, setName] = useCookie('name', '');
  const [sftpUrl, setSftpUrl] = useCookie('sftpUrl', DEFAULT_SFTP);
  const [swaggerUrl, setSwaggerUrl] = useCookie('swaggerUrl', DEFAULT_SWAGGER);
  const [swaggerMeasUrl, setSwaggerMeasUrl] = useCookie('swaggerMeasUrl', DEFAULT_SWAGGER_MEAS);
  const [rabbitUrl, setRabbitUrl] = useCookie('rabbitUrl', DEFAULT_RABBIT);
  const [mongoUrl, setMongoUrl] = useCookie('mongoUrl', DEFAULT_MONGO);

  const [view, setView] = useState<View>('generate');
  const [cookieOk, setCookieOk] = useState(() => {
    if (getCookie('cookie_consent') === '1') return true;
    try { return localStorage.getItem('enap_cookie_consent') === '1'; } catch { return false; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mongoOpen, setMongoOpen] = useState(true);
  // A bal oldali konfig-kártyák összecsukása (generálás után automatikusan összecsukódnak).
  const [genCol, setGenCol] = useState(false);
  const [invCol, setInvCol] = useState(false);
  const [msCol, setMsCol] = useState(false);

  // POD-forrás: automatikus generálás vagy valódi POD-ok beillesztése. (Mind megőrződik frissítésnél.)
  const [podMode, setPodMode] = useLocalStorage('podMode', 'auto');
  // Feltöltött SZINKRON profilok – böngésző-cache-ben (localStorage), reload-állóan.
  const [savedSz, setSavedSz] = useState<SavedSzinkron[]>(() => {
    try { return JSON.parse(localStorage.getItem('enap_savedSzinkron') || '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('enap_savedSzinkron', JSON.stringify(savedSz)); } catch { /* tele lehet a tár */ }
  }, [savedSz]);
  const [selectedSzId, setSelectedSzId] = useLocalStorage('selectedSzId', ''); // a generáláshoz kiválasztott
  const [editSzId, setEditSzId] = useState<string>(''); // a SZINKRON-lapon épp szerkesztett
  const [count, setCount] = useLocalStorage('count', '5');
  const [dso, setDso] = useLocalStorage('dso', 'EHE000210');
  const [merlegkor, setMerlegkor] = useLocalStorage('merlegkor', '15X-SINERGY----D');
  // A POD-törzs SZÁNDÉKOSAN nem perzisztens: minden oldalbetöltéskor új véletlen érték.
  const [podBody, setPodBody] = useState(randomPodBody);
  const [podsText, setPodsText] = useState(() => {
    try { return localStorage.getItem(PODS_KEY) ?? ''; } catch { return ''; }
  });
  const [from, setFrom] = useLocalStorage('from', yesterday());
  const [genDate, setGenDate] = useState(today());
  const [szinkron, setSzinkron] = useLocalBool('szinkron', true);
  const [meres, setMeres] = useLocalBool('meres', true);
  const [inverter, setInverter] = useLocalBool('inverter', false);
  const [invMeres, setInvMeres] = useLocalBool('invMeres', false);
  const [invPair, setInvPair] = useLocalBool('invPair', false);
  const [msconst, setMsconst] = useLocalBool('msconst', false);
  // MSCONST mezők (alapból a minta értékei, szerkeszthetők)
  const [msChannel, setMsChannel] = useLocalStorage('msChannel', 'A+');
  const [msValueName, setMsValueName] = useLocalStorage('msValueName', '1.29.99.145');
  const [msUnit, setMsUnit] = useLocalStorage('msUnit', 'kwh');
  const [msTFactor, setMsTFactor] = useLocalStorage('msTFactor', '1');
  const [msInterval, setMsInterval] = useLocalStorage('msInterval', '00:05:00');
  const [msF2, setMsF2] = useLocalStorage('msF2', 'W');
  const [msStart, setMsStart] = useLocalStorage('msStart', '2026-03-22T12:00');
  const [msMin, setMsMin] = useLocalStorage('msMin', '100');
  const [msMax, setMsMax] = useLocalStorage('msMax', '1500');
  const [allowLarge, setAllowLarge] = useState(false);

  const initModel = DEVICE_TYPES[FIRST_BRAND]?.[0];
  const [brand, setBrand] = useLocalStorage('brand', FIRST_BRAND);
  const [model, setModel] = useLocalStorage('model', initModel?.model ?? '');
  const [power, setPower] = useLocalStorage('power', str(initModel?.nominalPower));
  const [vmin, setVmin] = useLocalStorage('vmin', str(initModel?.acVoltageMin));
  const [vmax, setVmax] = useLocalStorage('vmax', str(initModel?.acVoltageMax));
  const [invDate, setInvDate] = useLocalStorage('invDate', today());
  const [customerMail, setCustomerMail] = useLocalStorage('customerMail', 'teszt@feak.hu');

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
  // Csoportok összecsukása (true = csukva) és a „felhasználva" jelölők (fájlnév szerint).
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [usedFiles, setUsedFiles] = useState<Set<string>>(new Set());
  const markUsed = (name: string) =>
    setUsedFiles((s) => (s.has(name) ? s : new Set(s).add(name)));
  const toggleUsed = (name: string) =>
    setUsedFiles((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const [toast, setToast] = useState<{ pct: number; done: boolean } | null>(null);
  const runRef = useRef(0);

  // A generált fájlokat megőrizzük újratöltésnél; üres/nagyon nagy lista esetén nem.
  useEffect(() => {
    try {
      const totalLen = (files ?? []).reduce((s, f) => s + f.content.length, 0);
      const hasBlob = (files ?? []).some((f) => f.blob);
      // A nagy (Blob-os / sok hónapos MAVIR) fájlt nem tesszük localStorage-ba (nem szerializálható / kvóta) – csak letölthető.
      if (files && files.length && totalLen <= 3_000_000 && !hasBlob) localStorage.setItem(FILES_KEY, JSON.stringify(files));
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

  // A generáláshoz kiválasztott feltöltött SZINKRON profil + a belőle nyert kulcs-sorok (POD/poc/mérlegkör).
  const selectedSz = useMemo(() => savedSz.find((s) => s.id === selectedSzId) ?? null, [savedSz, selectedSzId]);
  const szKeys = useMemo(() => (selectedSz ? szinkronKeyRows(selectedSz.rows) : []), [selectedSz]);
  // A generáláshoz ténylegesen használt sorok: ha van kijelölés (selectedPods), csak azok; egyébként mind.
  const szKeysSel = useMemo(() => {
    const sel = selectedSz?.selectedPods;
    return sel && sel.length ? szKeys.filter((k) => sel.includes(k.pod)) : szKeys;
  }, [szKeys, selectedSz]);
  // Vegyes-e a fájl (több DSO vagy több mérlegkör) – figyelmeztetéshez (de mind betöltjük).
  const szMixed = useMemo(() => {
    const dsoSet = new Set(szKeys.map((k) => k.pod.slice(0, 8)));
    const mkSet = new Set(szKeys.map((k) => k.merlegkor).filter(Boolean));
    return dsoSet.size > 1 || mkSet.size > 1;
  }, [szKeys]);

  // A generálandó POD-ok száma (a választott mód szerint) és a becsült MAVIR adatpontok száma.
  const podCount = podMode === 'auto' ? Math.max(0, parseInt(count, 10) || 0)
    : podMode === 'szinkron' ? szKeysSel.length : realPods.length;
  const mavirPoints = useMemo(() => {
    if (!meres || !from) return 0;
    const fromMs = new Date(from + 'T00:00:00').getTime();
    const intervals = Math.max(0, Math.floor((Date.now() - fromMs) / FIFTEEN_MIN_MS));
    return podCount * intervals;
  }, [meres, from, podCount]);

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
    () => (files ?? []).filter((f) => f.target === 'sftp' || f.target === 'msconst').map((f) => f.name),
    [files],
  );
  const checkQuery = useMemo(() => buildCheckQuery(sftpNames), [sftpNames]);
  // Az inverter serialNumberök (a párosítás-fájlokból) – a mongo-express beküldés-ellenőrzéshez.
  const invSerials = useMemo(
    () => Array.from(new Set((files ?? []).map((f) => f.serial).filter((s): s is string => !!s))),
    [files],
  );

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // Egyszeri normalizálás: a régi/elavult inverter-Swagger URL-t (congestMasterData vagy a _1 nélküli
  // változat) a helyes végpontra (…receiveMasterDataFromManufacturer_1) cseréli – ne kelljen kézzel javítani.
  useEffect(() => {
    if (/congestMasterData/.test(swaggerUrl) || /receiveMasterDataFromManufacturer$/.test(swaggerUrl)) setSwaggerUrl(DEFAULT_SWAGGER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const greeting = useMemo(
    () => (name.trim() ? `Üdv, ${name.trim()}!` : 'POD-ok, mérés és inverter generálása'),
    [name],
  );

  async function onGenerate() {
    setError('');
    setUsedFiles(new Set()); // új generálás → tiszta „felhasználva" jelölők
    let pods: string[];
    let pocs: string[] | undefined;     // importált SZINKRON: POD-onkénti FOGYHELY_AZON (a párosítás poc-ja)
    let szMerlegkor: string | undefined; // importált SZINKRON: a fájl mérlegkör felelőse
    if (podMode === 'auto') {
      const n = parseInt(count, 10);
      if (!Number.isFinite(n) || n < 1) { setError('Adj meg egy pozitív POD-darabszámot.'); return; }
      // Minden generáláskor FRISS véletlen POD-törzs – így sosem ugyanaz a POD-készlet.
      const body = randomPodBody();
      setPodBody(body);
      pods = generatePods(n, dso, body);
    } else if (podMode === 'szinkron') {
      if (!selectedSz) { setError('Válassz egy feltöltött SZINKRON profilt (a „Feltöltött SZINKRON” lapon tölthetsz fel és menthetsz).'); return; }
      if (!szKeysSel.length) { setError('A kiválasztott SZINKRON nem tartalmaz (kijelölt) POD-ot.'); return; }
      pods = szKeysSel.map((k) => k.pod);
      pocs = szKeysSel.map((k) => k.poc || ''); // üres → a párosítás a számított poc-ra esik vissza
      szMerlegkor = szKeysSel.find((k) => k.merlegkor)?.merlegkor;
    } else {
      if (!realPods.length) { setError('Illessz be legalább egy valódi POD-ot (soronként egyet).'); return; }
      pods = realPods;
    }
    // Importált SZINKRON-nál a fájl mérlegkörét használjuk (ha van), különben a kiválasztottat.
    const mkForGen = (podMode === 'szinkron' && szMerlegkor) ? szMerlegkor : merlegkor;
    if (!from) { setError('Válassz érvényes mérés-kezdő dátumot.'); return; }
    if (!szinkron && !meres && !inverter && !invMeres && !invPair && !msconst) { setError('Pipálj ki legalább egy kimenetet.'); return; }
    if (meres && mavirPoints > MAVIR_POINTS_CAP && !allowLarge) {
      setError(
        `Túl nagy MAVIR adatmennyiség: ~${mavirPoints.toLocaleString('hu-HU')} adatpont ` +
          `(${podCount} POD × 15 perces idősor). Pipáld be a „Nagy generálás engedélyezése” négyzetet, ha ` +
          `mindenképp ennyit szeretnél (lassú lehet, és nagyon nagy méretnél a böngésző akár el is szállhat), ` +
          `vagy válassz későbbi mérés-kezdő dátumot / kevesebb POD-ot.`,
      );
      return;
    }

    const spec: InverterSpec = {
      brand,
      model: model.trim() || 'N/A',
      nominalPower: parseInt(power, 10) || 0,
      acVoltageMin: parseInt(vmin, 10) || 0,
      acVoltageMax: parseInt(vmax, 10) || 0,
      installationDate: invDate || today(),
      customerMail: customerMail.trim(),
    };
    // A datetime-local 'YYYY-MM-DDTHH:mm' – ha nincs másodperc, kiegészítjük ':00'-val.
    const msStartFull = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(msStart.trim()) ? `${msStart.trim()}:00` : msStart.trim();
    const msconstSpec: MsconstSpec = {
      channelName: msChannel, valueName: msValueName, valueUnit: msUnit, tFactor: msTFactor,
      interval: msInterval, f2: msF2, startDateTime: msStartFull,
      valueMin: parseFloat(msMin) || 0, valueMax: parseFloat(msMax) || 0,
    };
    const fromDate = new Date(from + 'T00:00:00');
    const genDateD = new Date((genDate || today()) + 'T00:00:00');
    // Generálás indul → a konfig-kártyák automatikusan összecsukódnak, hogy az eredmények/lekérdezések látszódjanak.
    setGenCol(true); setInvCol(true); setMsCol(true);

    // Nagy MAVIR + támogatott böngésző → közvetlenül LEMEZRE streameljük (nincs memória-összeomlás).
    const largeMavir = meres && mavirPoints > MAVIR_POINTS_CAP;
    const canStream = typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
    if (largeMavir && canStream) {
      await generateStreamed(pods, fromDate, genDateD, spec, msconstSpec, pocs, mkForGen);
      return;
    }

    const myRun = ++runRef.current;
    setToast({ pct: 0, done: false });
    try {
      const res = await generateBundle(pods, fromDate, genDateD, { szinkron, meres, inverter, invMeres, invPair, msconst }, spec, mkForGen, msconstSpec, (frac) => {
        if (runRef.current === myRun) setToast({ pct: Math.round(frac * 100), done: false });
      }, pocs);
      if (runRef.current !== myRun) return; // időközben új generálás indult
      setFiles(res.files);
      setToast({ pct: 100, done: true });
      setTimeout(() => { if (runRef.current === myRun) setToast(null); }, 4000);
    } catch {
      if (runRef.current === myRun) { setToast(null); setError('Hiba történt a generálás közben.'); }
    }
  }

  // Nagy MAVIR: a böngésző egy save-dialógusban kéri a helyet, majd ~1 MB-os darabokban a LEMEZRE írja
  // (a memóriában mindig csak egy darab van), így tetszőleges méret sem szállítja el a fület.
  async function generateStreamed(pods: string[], fromDate: Date, genDateD: Date, spec: InverterSpec, msconstSpec: MsconstSpec, pocs: string[] | undefined, mkStream: string) {
    type Writable = { write: (s: string) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> };
    const now = new Date();
    const { podsPerFile, parts } = mavirSplitPlan(pods.length, fromDate, now);
    const names = mavirFileNames(pods, mkStream, parts);

    // >~1 GB → POD-onként több részfájl egy MAPPÁBA streamelve (memóriabiztos, egy dialógus).
    const dirPicker = (window as unknown as {
      showDirectoryPicker?: () => Promise<{ getFileHandle: (n: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<Writable> }> }>;
    }).showDirectoryPicker;
    if (parts > 1 && typeof dirPicker === 'function') {
      let dir: { getFileHandle: (n: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<Writable> }> };
      try { dir = await dirPicker(); } catch { return; }
      const myRun = ++runRef.current;
      setToast({ pct: 0, done: false });
      try {
        const res = await generateBundle(pods, fromDate, genDateD, { szinkron, meres: false, inverter, invMeres, invPair, msconst }, spec, mkStream, msconstSpec, undefined, pocs);
        const sums: number[] = new Array(pods.length).fill(0);
        const partInfos: GeneratedFile[] = [];
        for (let pi = 0; pi < parts; pi++) {
          const groupPods = pods.slice(pi * podsPerFile, (pi + 1) * podsPerFile);
          const groupSums: number[] = new Array(groupPods.length).fill(0);
          const fh = await dir.getFileHandle(names[pi], { create: true });
          const w = await fh.createWritable();
          for await (const chunk of mavirXmlChunks(groupPods, fromDate, now, now, (frac) => {
            if (runRef.current === myRun) setToast({ pct: Math.round(((pi + frac) / parts) * 100), done: false });
          }, groupSums)) {
            await w.write(chunk);
          }
          await w.close();
          for (let i = 0; i < groupSums.length; i++) sums[pi * podsPerFile + i] = groupSums[i];
          partInfos.push({
            name: names[pi], content: '', mime: 'text/xml', target: 'sftp',
            hint: `MAVIR mérés (${pi + 1}/${parts} rész) – mappába mentve`,
            meta: `${groupPods.length} POD · streamelt`, savedToDisk: true,
          });
        }
        if (runRef.current !== myRun) return;
        const report: GeneratedFile = {
          name: reportFileName(), content: buildEnergyReport(pods, sums, fromDate, now, now),
          mime: 'text/plain', target: 'report',
          hint: 'Energia-összesítő (POD ↔ inverter ↔ kWh) a MAVIR mérésből', meta: `${pods.length} POD`,
        };
        setFiles([...res.files, ...partInfos, report]);
        setToast({ pct: 100, done: true });
        setTimeout(() => { if (runRef.current === myRun) setToast(null); }, 4000);
      } catch {
        if (runRef.current === myRun) { setToast(null); setError('Hiba a MAVIR mappába írása közben.'); }
      }
      return;
    }

    // Egy fájl (nem kell bontani, vagy nincs mappa-választó) – showSaveFilePicker.
    const suggested = names[0];
    let writable: Writable;
    let savedName = suggested;
    try {
      const picker = (window as unknown as {
        showSaveFilePicker: (o: unknown) => Promise<{ name: string; createWritable: () => Promise<Writable> }>;
      }).showSaveFilePicker;
      const handle = await picker({
        suggestedName: suggested,
        types: [{ description: 'MAVIR mérés (XML)', accept: { 'application/xml': ['.xml'] } }],
      });
      savedName = handle.name || suggested;
      writable = await handle.createWritable();
    } catch {
      return; // a felhasználó megszakította a mentést – nem hiba
    }

    const myRun = ++runRef.current;
    setToast({ pct: 0, done: false });
    try {
      // SZINKRON + inverter (gyors, memóriában) – MAVIR nélkül; a MAVIR-t streameljük.
      const res = await generateBundle(pods, fromDate, genDateD, { szinkron, meres: false, inverter, invMeres, invPair, msconst }, spec, mkStream, msconstSpec, undefined, pocs);
      const sums: number[] = new Array(pods.length).fill(0);
      for await (const chunk of mavirXmlChunks(pods, fromDate, now, now, (frac) => {
        if (runRef.current === myRun) setToast({ pct: Math.round(frac * 100), done: false });
      }, sums)) {
        await writable.write(chunk);
      }
      await writable.close();
      if (runRef.current !== myRun) return;
      const mavirInfo: GeneratedFile = {
        name: savedName, content: '', mime: 'text/xml', target: 'sftp',
        hint: 'MAVIR mérés – közvetlenül lemezre mentve', meta: `${pods.length} POD · streamelt`, savedToDisk: true,
      };
      const report: GeneratedFile = {
        name: reportFileName(), content: buildEnergyReport(pods, sums, fromDate, now, now),
        mime: 'text/plain', target: 'report',
        hint: 'Energia-összesítő (POD ↔ inverter ↔ kWh) a MAVIR mérésből', meta: `${pods.length} POD`,
      };
      setFiles([...res.files, mavirInfo, report]);
      setToast({ pct: 100, done: true });
      setTimeout(() => { if (runRef.current === myRun) setToast(null); }, 4000);
    } catch {
      try { await writable.abort?.(); } catch { /* ignore */ }
      if (runRef.current === myRun) { setToast(null); setError('Hiba a MAVIR lemezre írása közben.'); }
    }
  }

  const targetLabel = (t: string) =>
    t === 'swagger' ? 'Swagger (gyártói törzsadat)'
      : t === 'measurement' ? 'Swagger (mérés v1.2)'
      : t === 'rabbit' ? 'RabbitMQ Management'
      : 'SFTP web kliens';
  const targetUrl = (t: string) =>
    t === 'swagger' ? swaggerUrl
      : t === 'measurement' ? swaggerMeasUrl
      : t === 'rabbit' ? rabbitUrl
      : sftpUrl;
  // mongo-express ellenőrző URL egy inverter serialNumberre (a beküldés sikere a Messages-ben).
  // sort[ReceivedAt]=-1 → a legfrissebb beküldés elöl; a value az adott POD inverterének serialNumbere (dinamikus).
  const mongoVerifyUrl = (serial: string) =>
    `${mongoUrl}?sort%5BReceivedAt%5D=-1&key=Raw.podContracts.devices.serialNumber&value=${encodeURIComponent(serial)}&type=S`;

  // SZINKRON fájl beolvasása → új mentett profil (a nyers fájlt NEM tároljuk, csak a parsolt adatokat cache-eljük).
  async function onSzinkronFile(file: File | null | undefined) {
    if (!file) return;
    try {
      const parsed = parseSzinkron(await file.text());
      if (!parsed.rows.length) { setError('A SZINKRON fájl nem tartalmaz adatsort.'); return; }
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const prof: SavedSzinkron = {
        id, name: file.name.replace(/\.[^.]+$/, '') || 'SZINKRON', createdAt: new Date().toISOString(),
        columns: parsed.columns, rows: parsed.rows,
      };
      setSavedSz((list) => [prof, ...list]);
      setEditSzId(id);
      setError('');
    } catch {
      setError('A SZINKRON fájl beolvasása nem sikerült.');
    }
  }
  const updateSzCell = (id: string, rowIdx: number, col: string, value: string) =>
    setSavedSz((list) => list.map((s) => (s.id === id ? { ...s, rows: s.rows.map((r, i) => (i === rowIdx ? { ...r, [col]: value } : r)) } : s)));
  const renameSz = (id: string, name: string) => setSavedSz((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
  // Egy sor törlése (a kijelölésből is kivesszük az adott POD-ot).
  const deleteSzRow = (id: string, rowIdx: number) =>
    setSavedSz((list) => list.map((s) => {
      if (s.id !== id) return s;
      const pod = s.rows[rowIdx]?.['POD'];
      return { ...s, rows: s.rows.filter((_, i) => i !== rowIdx), selectedPods: (s.selectedPods ?? []).filter((p) => p !== pod) };
    }));
  // Egy sor (POD) kijelölésének váltása a generáláshoz.
  const toggleSzRowSel = (id: string, pod: string) =>
    setSavedSz((list) => list.map((s) => {
      if (s.id !== id) return s;
      const cur = s.selectedPods ?? [];
      return { ...s, selectedPods: cur.includes(pod) ? cur.filter((p) => p !== pod) : [...cur, pod] };
    }));
  // Összes sor ki-/bejelölése.
  const setSzAllSel = (id: string, all: boolean) =>
    setSavedSz((list) => list.map((s) => (s.id === id ? { ...s, selectedPods: all ? s.rows.map((r) => r['POD']).filter(Boolean) : [] } : s)));
  const deleteSz = (id: string) => {
    setSavedSz((list) => list.filter((s) => s.id !== id));
    if (editSzId === id) setEditSzId('');
    if (selectedSzId === id) setSelectedSzId('');
  };
  const editSz = savedSz.find((s) => s.id === editSzId) ?? null;

  const nav: { id: View; icon: IconName; label: string }[] = [
    { id: 'generate', icon: 'zap', label: 'Generálás' },
    { id: 'szinkron', icon: 'database', label: 'Feltöltött SZINKRON' },
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
          sparkle={false}
          waveAmplitude={0}
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
              <CollapsibleCard title="Mit generáljunk?" collapsed={genCol} onToggle={() => setGenCol((v) => !v)}>
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
                  <button className={podMode === 'szinkron' ? 'active' : ''} onClick={() => setPodMode('szinkron')}>
                    Feltöltött SZINKRON
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
                        <span>POD törzs (véletlen)</span>
                        <span className="input-row">
                          <input
                            type="text"
                            value={podBody}
                            placeholder="pl. KSP19D"
                            onChange={(e) => setPodBody(e.target.value)}
                          />
                          <button
                            type="button"
                            className="mini-btn"
                            title="Új véletlen törzs"
                            onClick={() => setPodBody(randomPodBody())}
                          >
                            <Icon name="shuffle" size={14} />
                          </button>
                        </span>
                      </label>
                    </div>
                    <p className="hint">
                      Minta POD (1.): <code>{examplePodTemplate(dso, podBody)}</code> — a törzs után a sorszám
                      nullával <b>33 karakterre</b> töltve. A törzs <b>minden generáláskor</b> (és oldalbetöltéskor)
                      új véletlen érték. a 🔀 gombbal előre is pörgethetsz egyet —, így sosem generálsz kétszer
                      ugyanolyan POD-ot.
                    </p>
                  </>
                ) : podMode === 'szinkron' ? (
                  <>
                    <label className="full">
                      <span>Feltöltött SZINKRON profil</span>
                      <select value={selectedSzId} onChange={(e) => setSelectedSzId(e.target.value)}>
                        <option value="">— válassz —</option>
                        {savedSz.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({szinkronKeyRows(s.rows).length} POD)</option>
                        ))}
                      </select>
                    </label>
                    {selectedSz ? (
                      <p className="hint">
                        <b>{szKeysSel.length}</b> POD a(z) <b>{selectedSz.name}</b> profilból
                        {selectedSz.selectedPods?.length ? <> ({szKeys.length}-ből kijelölve)</> : <> (mind)</>}. A párosítás
                        <b> poc</b>-ja a fájl <code>[FOGYHELY_AZON]</code>-ja, a mérlegkör is a fájlból jön. A kijelölést a
                        <b> „Feltöltött SZINKRON"</b> lapon, a szerkesztőben állíthatod.
                        {szMixed && <> ⚠ A fájl <b>többféle DSO-t/mérlegkört</b> tartalmaz – mind betöltjük.</>}
                      </p>
                    ) : (
                      <p className="hint">
                        Nincs kiválasztva profil. A <b>Feltöltött SZINKRON</b> lapon tölts fel egy SZINKRON CSV-t,
                        szerkeszd és mentsd – itt utána kiválaszthatod.
                      </p>
                    )}
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

                <label className="full" style={{ marginTop: 4 }}>
                  <span>Mérlegkör felelős (SZINKRON [Merlegkor_Felelos] + fájlnév partnere)</span>
                  <select value={merlegkor} onChange={(e) => setMerlegkor(e.target.value)}>
                    {BALANCE_RESPONSIBLES.map((b) => (
                      <option key={b.eic} value={b.eic}>{b.eic} — {b.name}</option>
                    ))}
                  </select>
                </label>
                <p className="hint">
                  A SZINKRON fájlnév partnere: <code>Szinkron_{dso}_{merlegkor.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '')}_…</code> — valódi, regisztrált érték a DB-ből.
                </p>

                <div className="checks">
                  <label className="check"><input type="checkbox" checked={szinkron} onChange={(e) => setSzinkron(e.target.checked)} /> <span>SZINKRON törzsadat (CSV) → SFTP</span></label>
                  <div className="check-row">
                    <label className="check"><input type="checkbox" checked={meres} onChange={(e) => setMeres(e.target.checked)} /> <span>MAVIR mérés (XML) → SFTP</span></label>
                    <label className="check"><input type="checkbox" checked={msconst} onChange={(e) => setMsconst(e.target.checked)} /> <span>MSCONST → SFTP</span></label>
                  </div>
                  <label className="check"><input type="checkbox" checked={inverter} onChange={(e) => setInverter(e.target.checked)} /> <span>Inverter gyártói törzsadat (JSON) → Swagger</span></label>
                  <label className="check"><input type="checkbox" checked={invPair} onChange={(e) => setInvPair(e.target.checked)} /> <span>Inverter párosítás (JSON) → RabbitMQ</span></label>
                  <label className="check"><input type="checkbox" checked={invMeres} onChange={(e) => setInvMeres(e.target.checked)} /> <span>Inverter mérésadat (JSON) → Swagger</span></label>
                </div>
                {invPair && (
                  <p className="hint">
                    Az inverter <b>párosítás</b> <b>POD-onként egy fájl</b> — a <b>RabbitMQ Management</b>-ben a
                    <code> pod-registry.inverter-pod-data</code> exchange-re publikáld (Publish message → Payload). Ez hozza
                    létre a pod↔eszköz párosítást a PodRegistry-ben (a 10 fix HMKE-csatornával).
                  </p>
                )}
                {invMeres && (
                  <p className="hint">
                    Az inverter mérésadat <b>serialNumber-alapú</b> (OBIS <code>2.8.0</code>, 5 perces idősor), <b>inverterenként egy fájl</b>.
                    A <b>v1.2</b> végpont <code>200</code> = párosítva (PodRegistry-ben), <code>202</code>/„Missing device data" = nincs párosítva.
                  </p>
                )}

                {meres && mavirPoints > 300_000 && (
                  <p className={`hint${mavirPoints > MAVIR_POINTS_CAP ? ' warn' : ''}`}>
                    MAVIR: ~<b>{mavirPoints.toLocaleString('hu-HU')}</b> adatpont készülne ({podCount} POD × 15 perces idősor).
                    {mavirPoints > MAVIR_POINTS_CAP
                      ? ` ⚠ Több a böngészőnek ajánlott ~${MAVIR_POINTS_CAP.toLocaleString('hu-HU')}-nál — engedélyezd alább, vagy rövidíts.`
                      : ' Nagy fájl lesz, a generálás eltarthat egy ideig (a folyamatjelző mutatja).'}
                  </p>
                )}

                {meres && mavirPoints > MAVIR_POINTS_CAP && (
                  <label className="check" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={allowLarge} onChange={(e) => setAllowLarge(e.target.checked)} />
                    <span>Nagy generálás engedélyezése (lassú lehet, extrém méretnél a böngésző elszállhat)</span>
                  </label>
                )}

                {error && <p className="error">{error}</p>}
                {!(inverter || invMeres) && !msconst && <button className="primary" onClick={onGenerate}>Generálás</button>}
              </CollapsibleCard>

              {(inverter || invMeres) && (
                <CollapsibleCard title="Inverter gyártói adatok" collapsed={invCol} onToggle={() => setInvCol((v) => !v)}>
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
                    <label><span>Ügyfél e-mail (customerMail)</span><input type="email" value={customerMail} placeholder="pl. teszt@feak.hu" onChange={(e) => setCustomerMail(e.target.value)} /></label>
                    <div className="gen-cell"><button className="primary" onClick={onGenerate}>Generálás</button></div>
                  </div>
                </CollapsibleCard>
              )}

              {msconst && (
                <CollapsibleCard title="MSCONST mezők" collapsed={msCol} onToggle={() => setMsCol((v) => !v)}>
                  <p className="desc">
                    MAVIR <code>EDW_XML</code>, de NEM idősor: POD-onként egy konstans érték (egy <code>&lt;BLOCK&gt;</code>/egy <code>&lt;E&gt;</code>).
                    A <b>LOC-KEY a generált POD</b>, a <b>V</b> érték véletlen a tartományból; a többi mező a mintából, szerkeszthető.
                  </p>
                  <div className="grid3">
                    <label><span>CHANNEL-NAME</span><input value={msChannel} onChange={(e) => setMsChannel(e.target.value)} /></label>
                    <label><span>VALUE-NAME</span><input value={msValueName} onChange={(e) => setMsValueName(e.target.value)} /></label>
                    <label><span>VALUE-UNIT</span><input value={msUnit} onChange={(e) => setMsUnit(e.target.value)} /></label>
                    <label><span>T-FACTOR</span><input value={msTFactor} onChange={(e) => setMsTFactor(e.target.value)} /></label>
                    <label><span>INTERVAL</span><input value={msInterval} placeholder="00:05:00" onChange={(e) => setMsInterval(e.target.value)} /></label>
                    <label><span>F2</span><input value={msF2} onChange={(e) => setMsF2(e.target.value)} /></label>
                    <label><span>START-DATETIME</span><input type="datetime-local" step={1} value={msStart} onChange={(e) => setMsStart(e.target.value)} /></label>
                    <label><span>Érték min (V)</span><input type="number" value={msMin} onChange={(e) => setMsMin(e.target.value)} /></label>
                    <label><span>Érték max (V)</span><input type="number" value={msMax} onChange={(e) => setMsMax(e.target.value)} /></label>
                    {!(inverter || invMeres) && <div className="gen-cell"><button className="primary" onClick={onGenerate}>Generálás</button></div>}
                  </div>
                </CollapsibleCard>
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

              {invSerials.length > 0 && (
                <section className="card side-panel">
                  <div className="panel-head">
                    <button className="panel-toggle" onClick={() => setMongoOpen((v) => !v)} aria-expanded={mongoOpen}>
                      <Icon name="database" size={15} />
                      <span className="panel-title-text">Inverter ellenőrzése — mongo-express (<b>pod-registry-db</b>)</span>
                    </button>
                    <div className="head-actions">
                      <button className="ghost sm panel-chevron" onClick={() => setMongoOpen((v) => !v)} aria-label={mongoOpen ? 'Összecsukás' : 'Kinyitás'}>
                        <Icon name={mongoOpen ? 'chevron-down' : 'chevron-right'} size={16} />
                      </button>
                    </div>
                  </div>
                  {mongoOpen && (
                    <div className="panel-body">
                      <p className="hint" style={{ marginTop: 0 }}>
                        Beküldés után serialNumberenként ellenőrizd, hogy bekerült-e a <b>Messages</b>-be:
                      </p>
                      <div className="mongo-list">
                        {invSerials.map((s) => (
                          <a key={s} className="ghost sm mongo-item" href={mongoVerifyUrl(s)} target="_blank" rel="noreferrer" title="Megnyitás a mongo-express-ben">
                            <Icon name="external" size={14} /> <span className="mongo-serial">{s}</span>
                          </a>
                        ))}
                      </div>
                    </div>
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
                      <button className="primary sm" onClick={() => downloadZip(files).catch(() => setError('Nem sikerült a ZIP elkészítése.'))}>
                        <Icon name="archive" size={15} /> Összes letöltése (ZIP)
                      </button>
                      <button className="ghost sm" onClick={() => { setFiles(null); setUsedFiles(new Set()); }}>
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
                    {FILE_GROUPS.map((g) => {
                      const groupFiles = files.filter((f) => fileGroup(f) === g.key);
                      if (!groupFiles.length) return null;
                      const open = !collapsedGroups[g.key];
                      const usedCount = groupFiles.filter((f) => usedFiles.has(f.name)).length;
                      return (
                        <div className="file-group" key={g.key}>
                          <button className="file-group-head" onClick={() => setCollapsedGroups((c) => ({ ...c, [g.key]: open }))}>
                            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
                            <span className="file-group-title">{g.label}</span>
                            <span className="file-group-count">{usedCount}/{groupFiles.length}</span>
                          </button>
                          {open && (
                            <div className="file-group-body">
                              {groupFiles.map((f) => (
                                <div className={`result-row${usedFiles.has(f.name) ? ' used' : ''}`} key={f.name}>
                                  <input
                                    type="checkbox"
                                    className="row-check"
                                    checked={usedFiles.has(f.name)}
                                    onChange={() => toggleUsed(f.name)}
                                    title="Felhasználva (jelölő) – másoláskor/letöltéskor magától bepipálódik"
                                  />
                                  <div
                                    className="rfile"
                                    draggable={!f.savedToDisk}
                                    onDragStart={f.savedToDisk ? undefined : (e) => dragOutFile(e, f)}
                                    title={f.savedToDisk ? 'Ez a fájl már a lemezre lett mentve' : 'Fogd és húzd egy mappába / az asztalra (Chrome/Edge), majd onnan az SFTP-be'}
                                  >
                                    {!f.savedToDisk && <span className="rgrip" aria-hidden="true"><Icon name="grip" size={16} /></span>}
                                    <div className="rfile-text">
                                      <div className="rname">{f.name}</div>
                                      <div className="rhint">{f.hint} · {f.meta}</div>
                                    </div>
                                  </div>
                                  <div className="ractions">
                                    {f.savedToDisk ? (
                                      <span className="saved-badge"><Icon name="check" size={15} /> Lemezre mentve</span>
                                    ) : (
                                      <>
                                        <button className="primary sm" onClick={() => { download(f); markUsed(f.name); }}><Icon name="download" size={15} /> Letöltés</button>
                                        {!f.blob && (
                                          <button className="ghost sm" onClick={() => { copyText(f.content, f.name); markUsed(f.name); }}>
                                            {copied === f.name
                                              ? <><Icon name="check" size={15} /> Másolva</>
                                              : <><Icon name="copy" size={15} /> Másolás</>}
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {f.target !== 'report' && (
                                      <a className="ghost sm" href={targetUrl(f.target)} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> {targetLabel(f.target)}</a>
                                    )}
                                    {f.serial && (
                                      <a className="ghost sm" href={mongoVerifyUrl(f.serial)} target="_blank" rel="noreferrer" title="A beküldés ellenőrzése a pod-registry-db Messages-ben"><Icon name="database" size={15} /> mongo ellenőrzés</a>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
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

          {view === 'szinkron' && (
            <>
              <header className="page-head">
                <h1>Feltöltött SZINKRON adatok</h1>
                <p>Húzz be vagy tölts fel egy SZINKRON CSV-t. A mezők szerkeszthetők; minden a böngésző cache-ében marad (nincs adatbázis), és reload után is megmarad. A Generálás fülön kiválaszthatod, melyiket használd.</p>
              </header>

              <section className="card">
                <h2>Új feltöltés</h2>
                <p className="desc">Húzd ide a SZINKRON fájlt, vagy válaszd ki. A <b>nyers fájlt nem tároljuk</b>, csak a kiolvasott adatokat.</p>
                <div
                  className="drop-zone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); onSzinkronFile(e.dataTransfer.files?.[0]); }}
                >
                  <Icon name="download" size={22} />
                  <span>Húzd ide a SZINKRON CSV-t</span>
                  <label className="ghost sm file-pick">
                    Fájl kiválasztása
                    <input type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => { onSzinkronFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                </div>
                {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
              </section>

              <section className="card">
                <h2>Mentett SZINKRON-ok ({savedSz.length})</h2>
                {savedSz.length === 0 ? (
                  <p className="desc">Még nincs feltöltés.</p>
                ) : (
                  <div className="sz-list">
                    {savedSz.map((s) => (
                      <div className={`sz-item${editSzId === s.id ? ' active' : ''}`} key={s.id}>
                        <div className="sz-item-info">
                          <div className="sz-item-name">{s.name}</div>
                          <div className="sz-item-meta">{szinkronKeyRows(s.rows).length} POD · {s.rows.length} sor{selectedSzId === s.id ? ' · generáláshoz kiválasztva' : ''}</div>
                        </div>
                        <div className="head-actions">
                          <button className="ghost sm" onClick={() => setEditSzId(editSzId === s.id ? '' : s.id)}>{editSzId === s.id ? <><Icon name="x" size={15} /> Bezárás</> : <><Icon name="pencil" size={15} /> Szerkesztés</>}</button>
                          <button className="ghost sm" onClick={() => { setSelectedSzId(s.id); setPodMode('szinkron'); setView('generate'); }}><Icon name="zap" size={15} /> Generáláshoz</button>
                          <button className="ghost sm" onClick={() => deleteSz(s.id)}><Icon name="trash" size={15} /> Törlés</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {editSz && (
                <section className="card">
                  <div className="card-head">
                    <h2>Szerkesztés — {editSz.name}</h2>
                    <div className="head-actions">
                      <button className="primary sm" onClick={() => setEditSzId('')}><Icon name="check" size={15} /> Kész</button>
                    </div>
                  </div>
                  <label className="full"><span>Profil neve</span><input value={editSz.name} onChange={(e) => renameSz(editSz.id, e.target.value)} /></label>
                  <p className="hint" style={{ marginTop: 10 }}>
                    Minden mező szerkeszthető; a változások azonnal mentődnek a böngésző cache-ébe. A generáláshoz a
                    <code> POD</code>, <code>FOGYHELY_AZON</code> (poc) és <code>Merlegkor_Felelos</code> oszlopok a fontosak.
                    A <b>☑ jelöléssel</b> kiválaszthatod, mely sorokhoz (POD-okhoz) generáljon mérésadatot/invertert
                    (<b>üres jelölés = mind</b>); a <Icon name="trash" size={12} /> gombbal sort törölhetsz.
                    {(editSz.selectedPods?.length ?? 0) > 0 && <> Jelenleg <b>{editSz.selectedPods!.length}</b> sor kijelölve.</>}
                  </p>
                  <div className="sz-table-wrap pretty-scroll">
                    <table className="sz-table">
                      <thead>
                        <tr>
                          <th className="sz-selcol">
                            <input
                              type="checkbox"
                              title="Összes ki-/bejelölése"
                              checked={editSz.rows.length > 0 && editSz.rows.every((r) => (editSz.selectedPods ?? []).includes(r['POD']))}
                              onChange={(e) => setSzAllSel(editSz.id, e.target.checked)}
                            />
                          </th>
                          <th>#</th>
                          <th className="sz-delcol"></th>
                          {editSz.columns.map((c) => <th key={c}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {editSz.rows.map((r, ri) => {
                          const sel = (editSz.selectedPods ?? []).includes(r['POD']);
                          return (
                            <tr key={ri} className={sel ? 'sz-row-sel' : ''}>
                              <td className="sz-selcol">
                                <input type="checkbox" checked={sel} disabled={!r['POD']} onChange={() => toggleSzRowSel(editSz.id, r['POD'])} title={r['POD'] ? r['POD'] : 'nincs POD ebben a sorban'} />
                              </td>
                              <td className="sz-rownum">{ri + 1}</td>
                              <td className="sz-delcol">
                                <button className="sz-del-btn" title="Sor törlése" onClick={() => deleteSzRow(editSz.id, ri)}><Icon name="trash" size={14} /></button>
                              </td>
                              {editSz.columns.map((c) => (
                                <td key={c}><input value={r[c] ?? ''} onChange={(e) => updateSzCell(editSz.id, ri, c, e.target.value)} /></td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
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
                <label className="full" style={{ marginTop: 12 }}><span>Swagger UI — inverter gyártói törzsadat (receiveMasterDataFromManufacturer)</span><input value={swaggerUrl} onChange={(e) => setSwaggerUrl(e.target.value)} /></label>
                <label className="full" style={{ marginTop: 12 }}><span>Swagger UI — inverter mérésadat (v1.2 measurement)</span><input value={swaggerMeasUrl} onChange={(e) => setSwaggerMeasUrl(e.target.value)} /></label>
                <label className="full" style={{ marginTop: 12 }}><span>RabbitMQ Management — inverter párosítás (pod-registry.inverter-pod-data)</span><input value={rabbitUrl} onChange={(e) => setRabbitUrl(e.target.value)} /></label>
                <label className="full" style={{ marginTop: 12 }}><span>mongo-express — beküldés-ellenőrzés (pod-registry-db Messages)</span><input value={mongoUrl} onChange={(e) => setMongoUrl(e.target.value)} /></label>
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
          <button className="primary sm" onClick={() => { setCookie('cookie_consent', '1'); try { localStorage.setItem('enap_cookie_consent', '1'); } catch { /* nem elérhető */ } setCookieOk(true); }}>
            Elfogadom
          </button>
        </div>
      )}

      {toast && (
        <div className={`toast${toast.done ? ' done' : ''}`} role="status" aria-live="polite">
          <span className="toast-ic">
            {toast.done ? <Icon name="check" size={18} /> : <span className="toast-spin" aria-hidden="true" />}
          </span>
          <div className="toast-body">
            <div className="toast-title">
              {toast.done ? 'Kész ✓' : `Fájlok létrehozása… ${toast.pct}%`}
            </div>
            {!toast.done && (
              <div className="toast-bar"><div className="toast-bar-fill" style={{ width: `${toast.pct}%` }} /></div>
            )}
          </div>
        </div>
      )}

      <div className="credit">Az oldalt készítette: <b>Modroczky Ferenc</b></div>
    </>
  );
}
