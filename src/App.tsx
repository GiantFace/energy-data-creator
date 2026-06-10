import { useEffect, useMemo, useRef, useState } from 'react';
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
  'https://device-data-receiver.uat.enap.oci/swagger/swagger-ui/index.html#/inverter-controller/receiveMasterDataFromManufacturer';
// Inverter MÉRÉSADAT (v1.2 inverter-controller) – külön a párosítás (master-data) végpontjától.
const DEFAULT_SWAGGER_MEAS =
  'https://device-data-receiver.uat.enap.oci/swagger/swagger-ui/index.html#/inverter-controller/receiveMeasurementData_3';
const PGWEB_URL = 'https://pgweb-ui.uat.enap.oci/#';
// RabbitMQ Management UI – ide kell publikálni az inverter-párosítást (pod-registry.inverter-pod-data).
const DEFAULT_RABBIT = 'https://rabbitmq-ui.uat.enap.oci/#/exchanges';

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
  { key: 'master', label: 'Inverter gyártói törzsadat → Swagger' },
  { key: 'pair', label: 'Inverter párosítás → RabbitMQ' },
  { key: 'meas', label: 'Inverter mérésadat (v1.2) → Swagger' },
];
function fileGroup(f: GeneratedFile): string {
  switch (f.target) {
    case 'rabbit': return 'pair';
    case 'measurement': return 'meas';
    case 'swagger': return 'master';
    case 'report': return 'mavir'; // energia-összesítő a MAVIR mellett
    default: return f.mime === 'text/csv' || f.name.startsWith('Szinkron') ? 'szinkron' : 'mavir';
  }
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

type View = 'generate' | 'settings' | 'about';

export default function App() {
  const [theme, setTheme] = useCookie('theme', 'light');
  const [name, setName] = useCookie('name', '');
  const [sftpUrl, setSftpUrl] = useCookie('sftpUrl', DEFAULT_SFTP);
  const [swaggerUrl, setSwaggerUrl] = useCookie('swaggerUrl', DEFAULT_SWAGGER);
  const [swaggerMeasUrl, setSwaggerMeasUrl] = useCookie('swaggerMeasUrl', DEFAULT_SWAGGER_MEAS);
  const [rabbitUrl, setRabbitUrl] = useCookie('rabbitUrl', DEFAULT_RABBIT);

  const [view, setView] = useState<View>('generate');
  const [cookieOk, setCookieOk] = useState(() => {
    if (getCookie('cookie_consent') === '1') return true;
    try { return localStorage.getItem('enap_cookie_consent') === '1'; } catch { return false; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // POD-forrás: automatikus generálás vagy valódi POD-ok beillesztése. (Mind megőrződik frissítésnél.)
  const [podMode, setPodMode] = useLocalStorage('podMode', 'auto');
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
  const [allowLarge, setAllowLarge] = useState(false);

  const initModel = DEVICE_TYPES[FIRST_BRAND]?.[0];
  const [brand, setBrand] = useLocalStorage('brand', FIRST_BRAND);
  const [model, setModel] = useLocalStorage('model', initModel?.model ?? '');
  const [power, setPower] = useLocalStorage('power', str(initModel?.nominalPower));
  const [vmin, setVmin] = useLocalStorage('vmin', str(initModel?.acVoltageMin));
  const [vmax, setVmax] = useLocalStorage('vmax', str(initModel?.acVoltageMax));
  const [invDate, setInvDate] = useLocalStorage('invDate', today());

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

  // A generálandó POD-ok száma (a választott mód szerint) és a becsült MAVIR adatpontok száma.
  const podCount = podMode === 'auto' ? Math.max(0, parseInt(count, 10) || 0) : realPods.length;
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
    () => (files ?? []).filter((f) => f.target === 'sftp').map((f) => f.name),
    [files],
  );
  const checkQuery = useMemo(() => buildCheckQuery(sftpNames), [sftpNames]);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // Egyszeri normalizálás: a régi/elavult inverter-Swagger URL-t (congestMasterData vagy a téves _1)
  // a helyes végpontra cseréli a tárolt beállításban – hogy ne kelljen kézzel javítani.
  useEffect(() => {
    if (/congestMasterData|receiveMasterDataFromManufacturer_1/.test(swaggerUrl)) setSwaggerUrl(DEFAULT_SWAGGER);
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
    if (podMode === 'auto') {
      const n = parseInt(count, 10);
      if (!Number.isFinite(n) || n < 1) { setError('Adj meg egy pozitív POD-darabszámot.'); return; }
      // Minden generáláskor FRISS véletlen POD-törzs – így sosem ugyanaz a POD-készlet.
      const body = randomPodBody();
      setPodBody(body);
      pods = generatePods(n, dso, body);
    } else {
      if (!realPods.length) { setError('Illessz be legalább egy valódi POD-ot (soronként egyet).'); return; }
      pods = realPods;
    }
    if (!from) { setError('Válassz érvényes mérés-kezdő dátumot.'); return; }
    if (!szinkron && !meres && !inverter && !invMeres) { setError('Pipálj ki legalább egy kimenetet.'); return; }
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
    };
    const fromDate = new Date(from + 'T00:00:00');
    const genDateD = new Date((genDate || today()) + 'T00:00:00');

    // Nagy MAVIR + támogatott böngésző → közvetlenül LEMEZRE streameljük (nincs memória-összeomlás).
    const largeMavir = meres && mavirPoints > MAVIR_POINTS_CAP;
    const canStream = typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
    if (largeMavir && canStream) {
      await generateStreamed(pods, fromDate, genDateD, spec);
      return;
    }

    const myRun = ++runRef.current;
    setToast({ pct: 0, done: false });
    try {
      const res = await generateBundle(pods, fromDate, genDateD, { szinkron, meres, inverter, invMeres, invPair }, spec, merlegkor, (frac) => {
        if (runRef.current === myRun) setToast({ pct: Math.round(frac * 100), done: false });
      });
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
  async function generateStreamed(pods: string[], fromDate: Date, genDateD: Date, spec: InverterSpec) {
    type Writable = { write: (s: string) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> };
    const now = new Date();
    const { podsPerFile, parts } = mavirSplitPlan(pods.length, fromDate, now);
    const names = mavirFileNames(pods, merlegkor, parts);

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
        const res = await generateBundle(pods, fromDate, genDateD, { szinkron, meres: false, inverter, invMeres, invPair }, spec, merlegkor);
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
      const res = await generateBundle(pods, fromDate, genDateD, { szinkron, meres: false, inverter, invMeres, invPair }, spec, merlegkor);
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
                      új véletlen érték — a 🔀 gombbal előre is pörgethetsz egyet —, így sosem generálsz kétszer
                      ugyanolyan POD-ot.
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
                  <label className="check"><input type="checkbox" checked={meres} onChange={(e) => setMeres(e.target.checked)} /> <span>MAVIR mérés (XML) → SFTP</span></label>
                  <label className="check"><input type="checkbox" checked={inverter} onChange={(e) => setInverter(e.target.checked)} /> <span>Inverter gyártói törzsadat (JSON) → Swagger (receiveMasterDataFromManufacturer)</span></label>
                  <label className="check"><input type="checkbox" checked={invPair} onChange={(e) => setInvPair(e.target.checked)} /> <span>Inverter párosítás (JSON) → RabbitMQ (pod-registry.inverter-pod-data)</span></label>
                  <label className="check"><input type="checkbox" checked={invMeres} onChange={(e) => setInvMeres(e.target.checked)} /> <span>Inverter mérésadat (JSON) → Swagger (v1.2) — párosítás-ellenőrzés</span></label>
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
                <button className="primary" onClick={onGenerate}>Generálás</button>
              </section>

              {(inverter || invMeres) && (
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
