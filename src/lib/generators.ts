// ============================================================================
//  ENAP - KEP adatgenerátor – böngészőben futó generátorok (a .NET verzió portja).
//  SZINKRON CSV, MAVIR EDW_XML és inverter-brand/master-data JSON – mind UGYANARRA
//  a POD-készletre. A mérés a megadott kezdettől a MOSTANI időig (a gép órája) készül,
//  15 perces felbontással.
// ============================================================================

export type Dso = { code: string; name: string };

export const DSOS: Dso[] = [
  { code: 'EHE000110', name: 'E.ON Észak-dunántúli Áramhálózati Zrt. (ÉDÁSZ)' },
  { code: 'EHE000120', name: 'EON Dél-dunántúli Áramhálózati Zrt.' },
  { code: 'EHE000130', name: 'OPUS TITÁSZ Zrt.' },
  { code: 'EHE000210', name: 'ELMŰ Kft.' },
  { code: 'EHE000220', name: 'MVM Émász Áramhálózati Kft.' },
  { code: 'EHE000310', name: 'MVM DÉMÁSZ Áramhálózati Kft. (DÉMÁSZ)' },
  { code: 'EHE001000', name: 'MAVIR Zrt.' },
];

export const BRANDS: string[] = [
  'BYD', 'ABB', 'AEG', 'AFORE', 'ASTRASUN', 'AUX SOL', 'Anhui EHE', 'BENNING', 'Chint', 'DIEHL-AKO',
  'Deye', 'EFFEKTA', 'EHE', 'ENVERTECH', 'Enecsys', 'Enphase', 'FIMER', 'FoxESS', 'Fronius', 'GOODWE',
  'GROWATT', 'Gsmart', 'HUAWEI', 'Hoymiles', 'Hypontech', 'ISUNA', 'KACO', 'KOSTAL Solar', 'LENERCOM',
  'Letrika', 'Midea', 'Ningbo Ginlong', 'Nord', 'Omnik New Energy', 'POWER-ONE', 'Profiszolár', 'REFUsol',
  'RENACPOWER', 'ReneSola', 'SAJ', 'SIAC Soleil', 'SIEL - SIAC', 'SIEMENS', 'SMA', 'SOCOMEC', 'SUNGROW',
  'SUNWAYS', 'Samil Power', 'Schneider', 'Shenzen INVT', 'Shenzen Kstar', 'Shenzen Sofarsolar', 'Sigenergy',
  'SolaX', 'SolarEdge', 'Solinteg', 'Solis', 'Solplanet', 'SolvElectric', 'Steca Elektronic', 'SunPower',
  'Trannergy', 'Ucanpower', 'Vaillant', 'Voltronic', 'Wattsonic', 'ZEVERSOLAR', 'Egyéb',
];

export type InverterSpec = {
  brand: string;
  model: string;
  nominalPower: number;
  acVoltageMin: number;
  acVoltageMax: number;
  installationDate: string; // yyyy-MM-dd
  customerMail: string;     // a párosítás (RabbitMQ) customerMail mezője
};

export type Outputs = { szinkron: boolean; meres: boolean; inverter: boolean; invMeres: boolean; invPair: boolean; msconst: boolean };

// MSCONST: MAVIR EDW_XML, de NEM idősor – POD-onként EGY konstans érték (egy <BLOCK>/egy <E>).
// A LOC-KEY a generált POD; az érték véletlen [valueMin, valueMax] tartományból; a többi mező szerkeszthető.
export type MsconstSpec = {
  channelName: string;
  valueName: string;
  valueUnit: string;
  tFactor: string;
  interval: string;
  f2: string;
  startDateTime: string; // 'YYYY-MM-DDTHH:mm:ss'
  valueMin: number;
  valueMax: number;
};

export type GeneratedFile = {
  name: string;
  content: string; // szöveges tartalom (CSV/JSON/TXT); nagy MAVIR-nál üres, helyette `blob`
  mime: string;
  target: 'sftp' | 'swagger' | 'measurement' | 'report' | 'rabbit' | 'msconst';
  hint: string;
  meta: string;
  // Nagy fájl (sok hónapos MAVIR): a tartalom Blob-ként, mert egy ekkora sztring meghaladná a böngésző korlátját.
  blob?: Blob;
  // Nagyon nagy fájl: közvetlenül lemezre streamelve (nincs memóriában) – csak info-bejegyzés a listában.
  savedToDisk?: boolean;
  // Inverter serialNumber (…_INV) – a mongo-express ellenőrző linkhez (a beküldés sikere).
  serial?: string;
};

export type BundleResult = { pods: number; points: number; invDevices: number; files: GeneratedFile[] };

const TRADER = 'SYNTH-TEST';
const BALANCE_EIC = '15X-SINERGY----D';
const MEAS_OBIS = '1.29.99.128';

// Mérlegkör felelősök a pod-registry-db-ből. Az `eic` kerül a [Merlegkor_Felelos] mezőbe ÉS
// (fájlnév-biztosan) a SZINKRON fájlnév partner-mezőjébe – valódi, regisztrált értékkel.
export type BalanceResponsible = { eic: string; name: string };
export const BALANCE_RESPONSIBLES: BalanceResponsible[] = [
  { eic: '15X-DEMO-BALAREG', name: 'DEMO mérlegkör felelős Zrt' },
  { eic: 'SZA-15X-DENERGIA---J', name: 'SB-MVM NEXT' },
  { eic: '15X-SINERGY----D', name: 'Sinergy Energiakereskedő Kft.' },
  { eic: '15X-ENERJISA---J', name: 'Enerjisa Europe Kft.' },
  { eic: '15X-TINMAR-H---Y', name: 'Tinmar Kft.' },
  { eic: '15X-BC-ENERGIA-A', name: 'BC Energiakereskedő Kft.' },
  { eic: '15X-VERTES-----2', name: 'Vértesi Erőmű ZRt.' },
  { eic: '15X-E-BUDAI----O', name: 'E-Budai – Tinmar Kft.' },
  { eic: 'MULTI_01', name: 'MULTI_01 – Tinmar Kft.' },
  { eic: 'MULTI_03', name: 'MULTI_03 – Tinmar Kft.' },
  { eic: 'MULTI_02', name: 'MULTI_02 – Tinmar Kft.' },
  { eic: 'TEST-FEAK1', name: 'FEAK TEST1 Zrt' },
  { eic: 'OTTI-FEAK1', name: 'OTTI TEST1 Zrt' },
  { eic: "HARVEY'S PARTNER", name: "HARVEY'S PARTNER DDK" },
  { eic: '15X-PGP-TSL1---6', name: 'PAKS TESZT' },
  { eic: '15X-HRVYS-BR-1', name: 'Balareg Harveys Kft.' },
];

// Fájlnév-biztos partner: a nem [A-Za-z0-9.-] karaktereket (pl. '_', szóköz, aposztróf) kötőjelre
// cseréli, hogy a SZINKRON fájlnév két végdátumát a parser biztosan ki tudja olvasni.
function fileSafePartner(s: string): string {
  return (s || '').replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || TRADER;
}

const HEADER =
  '[Ellatas_Kezd]|[Ellatas_Bef]|[Eloszto]|[Kereskedo]|[Merlegkor_Felelos]|[POD]|[FOGYHELY_AZON]|' +
  '[UF]|[PT]|[FORD_NAP]|[LEOLVASAS]|[ELSZAMOLAS]|[UGYFEL_NEVE_1]|[UGYFEL_NEVE_2]|[UTCA]|[HAZSZAM]|' +
  '[VAROS]|[IR_SZAM]|[RHD_Fiz]|[RHD_Tarifa]|[RHD_Kieg_1]|[RHD_Kieg_2]|[ELO_lek_kW]|[CsP]|' +
  '[RHD_Tarifa_kezd]|[ELO_Lek_Kezd]|[Mero_Tarifa]|[Termeles]|[Vedendo]|[Termeles_telj]|[HMKE_IGENY]|[HMKE_BE]';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const hms = (d: Date) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Egyedi fájlnév-bélyeg: yyyyMMdd_HHmmss; ha ugyanabba a másodpercbe esne két generálás,
// sorszámmal egészül ki, így MINDIG egyedi nevet kapunk.
let _lastTs = '';
let _seq = 0;
function uniqueSuffix(d: Date): string {
  const base = `${ymd(d)}_${hms(d)}`;
  if (base === _lastTs) { _seq += 1; return `${base}_${_seq}`; }
  _lastTs = base;
  _seq = 0;
  return base;
}

// A POD-ok VALÓDIAK (a DSO/registry adja ki) – a generátor nem gyárt POD-ot, mert a DDR
// formátum-validátora (checksum/minta) a kitalált POD-okat „Invalid POD format”-tal elutasítja.
// A POD-számból viszont levezethető a DSO-kód: HU + 6 jegyű DSO-kód (pl. HU000210… -> EHE000210).
export function dsoNoFromPod(pod: string): string {
  const p = (pod ?? '').trim().toUpperCase();
  const digits = p.slice(2, 8); // a HU utáni 6 jegyű DSO-azonosító
  return /^[0-9]{6}$/.test(digits) ? `EHE${digits}` : 'EHE000000';
}

// A POD-törzs tisztítása: nagybetűs [A-Z0-9-] (a doc-mintában kötőjel is van), max 25 karakter.
export function sanitizePodBody(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 25);
}

// A DSO-kódból az előtag: HU + 6 jegyű DSO-azonosító (pl. EHE000910 -> HU000910). Mindig 8 karakter.
function podPrefix(dso: string): string {
  const raw = dso.toUpperCase().startsWith('EHE') ? dso.slice(3) : dso.replace(/\D/g, '');
  return 'HU' + raw.slice(0, 6).padEnd(6, '0');
}

// Sorszámozott POD a master-data elvárt formátumában: HU + 6 jegyű DSO-kód + törzs + sorszám,
// ahol a sorszám NULLÁVAL TÖLTI KI a maradékot, hogy a POD PONTOSAN 33 karakter legyen.
//   Példa: HU000310 + F11-S + 00000000000000000001 = HU000310F11-S00000000000000000001 (33 kar.)
// (A korábbi 32 karakteres ...TESZT001 ezért bukott „Invalid POD format”-tal a master-datán.)
export function generatePods(count: number, dso: string, body: string): string[] {
  const n = Math.max(0, Math.floor(count) || 0);
  const prefix = podPrefix(dso); // 8 karakter
  // A törzset úgy korlátozzuk, hogy a sorszámnak legalább 1 hely maradjon a 33 karakteren belül.
  const b = sanitizePodBody(body).slice(0, Math.max(0, 33 - prefix.length - 1));
  const seqWidth = 33 - prefix.length - b.length; // a sorszám kitölti a maradékot → összesen 33
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(prefix + b + String(i).padStart(seqWidth, '0'));
  }
  return out;
}

// Stabil minta a felülethez (az 1. POD), hogy a felhasználó élőben lássa a végeredményt.
export function examplePodTemplate(dso: string, body: string): string {
  return generatePods(1, dso, body)[0] ?? '';
}

// A FOGYHELY_AZON (fogyasztási hely / POC azonosító): a SZINKRON ezt írja, és ez lesz a POD PocNo-ja
// a registry-ben. A párosítás `poc` mezője UGYANEZT kapja – e nélkül nem társítódik a mérési hely.
const FOGYHELY_BASE = 199700000;
const fogyhelyAzon = (i: number) => String(FOGYHELY_BASE + i);

// A POD-ot kívülről kapja (a közös, beillesztett `pods` készletből) – így a SZINKRON, a MAVIR
// és az inverter MINDIG bájtra azonos POD-okat használ. Az [Eloszto] a POD-ból levezetett DSO.
function szinkronRow(p: string, i: number, merlegkor: string): string {
  const fogyhely = fogyhelyAzon(i);
  return [
    '2024.09.01', '2040.12.31', dsoNoFromPod(p), TRADER, merlegkor, p, fogyhely,
    '0.0', 'IDOS', '2026.05.01', '10.01', '10.01', 'Teszt', `Ugyfel${i}`, 'Teszt utca', String(i),
    'Budapest', '1011', 'K', 'KOF', 'VIZUGY', 'KOF_A_KIF_T', '60,0000000', '1',
    '2023.01.09', '2021.03.01', '1+0', 'HMKE-02', '001', '1.0', '2025.08.01', '2025.08.01',
  ].join('|');
}

// A SZINKRON oszlopnevei (a [...] zárójeleket levéve) – a parser fejléc hiányában ezt használja fallbacknek.
export const SZINKRON_COLUMNS = HEADER.split('|').map((c) => c.replace(/^\[|\]$/g, ''));

export type SzinkronParsed = { columns: string[]; rows: Record<string, string>[] };

// SZINKRON CSV beolvasása: a fejléc ([...] sor) átugorva/feldolgozva, a pipe-delimitált sorok mező-objektumokká.
// Ha van bracketes fejléc, annak oszlopneveit használja; egyébként a SZINKRON_COLUMNS fallbacket.
export function parseSzinkron(text: string): SzinkronParsed {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  if (!lines.length) return { columns: SZINKRON_COLUMNS, rows: [] };
  let columns = SZINKRON_COLUMNS;
  let start = 0;
  const first = lines[0];
  if (first.includes('[') && /\[[^\]]+\]/.test(first)) {
    columns = first.split('|').map((c) => c.trim().replace(/^\[|\]$/g, ''));
    start = 1;
  }
  const rows: Record<string, string>[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split('|');
    const row: Record<string, string> = {};
    columns.forEach((col, ci) => { row[col] = (cells[ci] ?? '').trim(); });
    rows.push(row);
  }
  return { columns, rows };
}

// A parsolt SZINKRON sorokból a generáláshoz fontos mezők (POD, FOGYHELY_AZON=poc, mérlegkör, eloszto).
export type SzinkronRowKey = { pod: string; poc: string; merlegkor: string; eloszto: string };
export function szinkronKeyRows(rows: Record<string, string>[]): SzinkronRowKey[] {
  return rows
    .map((r) => ({
      pod: r['POD'] ?? '',
      poc: r['FOGYHELY_AZON'] ?? '',
      merlegkor: r['Merlegkor_Felelos'] ?? '',
      eloszto: r['Eloszto'] ?? '',
    }))
    .filter((r) => r.pod);
}

// A MAVIR XML-t ~1 MB-os szövegdarabokban állítja elő (async generator). Így soha nincs egyetlen
// óriási sztring a memóriában – egyenesen lemezre streamelhető (File System Access API) anélkül,
// hogy a böngésző-fül kifogyna a memóriából. onProgress 0..1 közötti törtet jelez.
export async function* mavirXmlChunks(
  pods: string[],
  from: Date,
  end: Date,
  generated: Date,
  onProgress?: (frac: number) => void,
  sums?: number[], // POD-onkénti energiaösszeg (kWh) – az összesítő TXT-hez, generálás közben gyűjtve
): AsyncGenerator<string, void, unknown> {
  const stepMs = 15 * 60_000;
  const perPod = Math.max(0, Math.floor((end.getTime() - from.getTime()) / stepMs));
  const total = Math.max(1, pods.length * perPod);
  let buf =
    "<?xml version='1.0' encoding='UTF-8'?>\r\n" +
    '<EDW_XML xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://tempuri.org/MAVIR">\r\n' +
    '    <HEADER>\r\n        <VERSION>1.0</VERSION>\r\n        <GENERATOR>WM_XML_Generator</GENERATOR>\r\n' +
    `        <GENERATED-DATETIME>${isoLocal(generated)}</GENERATED-DATETIME>\r\n    </HEADER>\r\n`;
  let points = 0;
  let lastTick = Date.now();
  for (let i = 0; i < pods.length; i++) {
    const p = pods[i];
    buf += '    <DATA>\r\n';
    buf += `        <LOC-KEY>${p}</LOC-KEY>\r\n`;
    buf += '        <CHANNEL-NAME>A+</CHANNEL-NAME>\r\n';
    buf += `        <VALUE-NAME>${MEAS_OBIS}</VALUE-NAME>\r\n`;
    buf += '        <VALUE-UNIT>kwh</VALUE-UNIT>\r\n        <T-FACTOR>1</T-FACTOR>\r\n        <INTERVAL>00:15:00</INTERVAL>\r\n';
    buf += '        <BLOCK>\r\n';
    buf += `            <START-DATETIME>${isoLocal(from)}</START-DATETIME>\r\n`;
    for (let t = from.getTime(); t < end.getTime(); t += stepMs) {
      const v = (100 + Math.random() * 1400).toFixed(2);
      if (sums) sums[i] = (sums[i] ?? 0) + Number(v);
      buf += `            <E>\r\n                <V>${v}</V>\r\n                <F2>W</F2>\r\n            </E>\r\n`;
      points++;
      if (buf.length >= 1_000_000) {
        onProgress?.(points / total);
        yield buf;
        buf = '';
        if (Date.now() - lastTick > 40) { lastTick = Date.now(); await new Promise<void>((r) => setTimeout(r)); }
      }
    }
    buf += '        </BLOCK>\r\n    </DATA>\r\n';
  }
  buf += '</EDW_XML>';
  onProgress?.(1);
  yield buf;
}

// POD ↔ inverter ↔ összesített energia (A+ / kWh) szöveges riport a MAVIR mérésből.
export function buildEnergyReport(pods: string[], sums: number[], from: Date, end: Date, generated: Date): string {
  const perPod = Math.max(0, Math.floor((end.getTime() - from.getTime()) / (15 * 60_000)));
  const fmt = (n: number) => n.toLocaleString('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines: string[] = [];
  lines.push('ENAP - KEP — Energia-összesítő (a MAVIR mérés alapján)');
  lines.push(`Generálva:  ${isoLocal(generated)}`);
  lines.push(`Mérés:      ${isoLocal(from)} → ${isoLocal(end)}  (15 perces felbontás)`);
  lines.push('Csatorna:   A+ (aktív energia / fogyasztás) · egység: kWh');
  lines.push(`Pont/POD:   ${perPod}`);
  lines.push('');
  lines.push(`${'POD'.padEnd(35)}${'Inverter (serialNumber)'.padEnd(40)}${'Energia (kWh)'.padStart(20)}`);
  lines.push('-'.repeat(95));
  let grand = 0;
  for (let i = 0; i < pods.length; i++) {
    const e = sums[i] ?? 0;
    grand += e;
    lines.push(`${pods[i].padEnd(35)}${(pods[i] + '_INV').padEnd(40)}${fmt(e).padStart(20)}`);
  }
  lines.push('-'.repeat(95));
  lines.push(`Összesen: ${pods.length} POD · ${fmt(grand)} kWh`);
  return lines.join('\r\n') + '\r\n';
}

export function reportFileName(): string {
  return `energia_osszesito_${uniqueSuffix(new Date())}.txt`;
}

// A MAVIR fájl neve a megszokott formátumban (a lemezre-mentés javasolt neveként és a listához).
export function mavirFileName(pods: string[], merlegkor?: string): string {
  const dso = pods.length ? dsoNoFromPod(pods[0]) : 'EHE000000';
  return `${dso}_${fileSafePartner(merlegkor || BALANCE_EIC)}_Eseti_FF_EGYEDI1_${uniqueSuffix(new Date())}.xml`;
}

// MSCONST: MAVIR EDW_XML konstans értékekkel – POD-onként egy <DATA> egyetlen <E>-vel.
// Kicsi fájl (1 érték/POD), ezért szinkron, nincs streamelés. A V érték véletlen, 3 tizedessel (mint a minta).
export function buildMsconst(pods: string[], spec: MsconstSpec, generated: Date): string {
  const head =
    "<?xml version='1.0' encoding='UTF-8'?>\r\n" +
    '<EDW_XML xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://tempuri.org/MAVIR">\r\n' +
    '    <HEADER>\r\n        <VERSION>1.0</VERSION>\r\n        <GENERATOR>WM_XML_Generator</GENERATOR>\r\n' +
    `        <GENERATED-DATETIME>${isoLocal(generated)}</GENERATED-DATETIME>\r\n    </HEADER>\r\n`;
  const lo = Math.min(spec.valueMin, spec.valueMax);
  const span = Math.max(0, spec.valueMax - spec.valueMin);
  let buf = head;
  for (const p of pods) {
    const v = (lo + Math.random() * span).toFixed(3);
    buf += '    <DATA>\r\n';
    buf += `        <LOC-KEY>${p}</LOC-KEY>\r\n`;
    buf += `        <CHANNEL-NAME>${spec.channelName}</CHANNEL-NAME>\r\n`;
    buf += `        <VALUE-NAME>${spec.valueName}</VALUE-NAME>\r\n`;
    buf += `        <VALUE-UNIT>${spec.valueUnit}</VALUE-UNIT>\r\n`;
    buf += `        <T-FACTOR>${spec.tFactor}</T-FACTOR>\r\n`;
    buf += `        <INTERVAL>${spec.interval}</INTERVAL>\r\n`;
    buf += '        <BLOCK>\r\n';
    buf += `            <START-DATETIME>${spec.startDateTime}</START-DATETIME>\r\n`;
    buf += `            <E>\r\n                <V>${v}</V>\r\n                <F2>${spec.f2}</F2>\r\n            </E>\r\n`;
    buf += '        </BLOCK>\r\n    </DATA>\r\n';
  }
  buf += '</EDW_XML>';
  return buf;
}

export function msconstFileName(pods: string[], merlegkor?: string): string {
  const dso = pods.length ? dsoNoFromPod(pods[0]) : 'EHE000000';
  return `${dso}_${fileSafePartner(merlegkor || BALANCE_EIC)}_MSCONST_${uniqueSuffix(new Date())}.xml`;
}

// MAVIR darabolási terv: ~80 bájt/adatpont + ~320 bájt/POD. ~1 GB felett POD-onként több részre bontunk
// (mindegyik önálló, érvényes EDW_XML), hogy egy fájl se legyen ~1 GB-nál nagyobb.
const MAVIR_SPLIT_LIMIT = 1024 * 1024 * 1024; // ~1 GB
const MAVIR_SPLIT_TARGET = 900 * 1024 * 1024; // célméret/fájl (ráhagyással 1 GB alatt)
export function mavirSplitPlan(podCount: number, from: Date, end: Date): { podsPerFile: number; parts: number } {
  const pointsPerPod = Math.max(0, Math.floor((end.getTime() - from.getTime()) / (15 * 60_000)));
  const perPodBytes = pointsPerPod * 80 + 320;
  const podsPerFile = podCount * perPodBytes + 280 > MAVIR_SPLIT_LIMIT
    ? Math.max(1, Math.floor(MAVIR_SPLIT_TARGET / Math.max(1, perPodBytes)))
    : podCount;
  const parts = Math.max(1, Math.ceil(podCount / Math.max(1, podsPerFile)));
  return { podsPerFile, parts };
}

// A MAVIR (rész)fájlnevek – KÖZÖS időbélyeggel, rész-jelöléssel (part{i}of{n}), ha több részre bontunk.
export function mavirFileNames(pods: string[], merlegkor: string | undefined, parts: number): string[] {
  const dso = pods.length ? dsoNoFromPod(pods[0]) : 'EHE000000';
  const partner = fileSafePartner(merlegkor || BALANCE_EIC);
  const sfx = uniqueSuffix(new Date());
  if (parts <= 1) return [`${dso}_${partner}_Eseti_FF_EGYEDI1_${sfx}.xml`];
  return Array.from({ length: parts }, (_, i) => `${dso}_${partner}_Eseti_FF_EGYEDI1_part${i + 1}of${parts}_${sfx}.xml`);
}

// In-memory Blob (kis/közepes MAVIR, vagy ha nincs lemez-streamelés) – a chunk-generátorból építve.
async function buildMavirXml(
  pods: string[],
  from: Date,
  end: Date,
  generated: Date,
  onProgress?: (frac: number) => void,
  sums?: number[],
): Promise<{ blob: Blob; points: number }> {
  const stepMs = 15 * 60_000;
  const perPod = Math.max(0, Math.floor((end.getTime() - from.getTime()) / stepMs));
  const blobParts: BlobPart[] = [];
  for await (const chunk of mavirXmlChunks(pods, from, end, generated, onProgress, sums)) blobParts.push(chunk);
  return { blob: new Blob(blobParts, { type: 'application/octet-stream' }), points: pods.length * perPod };
}

// Inverter gyártói törzsadat – a LAPOS `devices` formátum, amit az
// inverter-controller/receiveMasterDataFromManufacturer (POST /api/v1.1/inverter-brand/master-data) vár.
// Nincs pod/podContracts/dataChannels: az inverter-ESZKÖZT regisztrálja (a POD-ot a serialNumber hordozza).
// A párosítás (pod↔eszköz) külön, RabbitMQ `pod-registry.inverter-pod-data` üzenettel megy.
function buildInverterMasterData(pods: string[], spec: InverterSpec): string {
  const devices = pods.map((p, idx) => ({
    serialNumber: `${p}_INV`,
    address: {
      zipCode: '1011',
      city: 'Budapest',
      street: 'Teszt',
      streetType: 'allé',
      streetCode: String(idx + 1),
      building: '2',
      stairway: '4',
      door: '3',
      floor: '1',
      latitude: '47',
      longitude: '17',
      country: 'HU',
    },
    brand: spec.brand,
    model: spec.model,
    nominalPower: spec.nominalPower,
    acVoltageMin: spec.acVoltageMin,
    acVoltageMax: spec.acVoltageMax,
    installationDate: spec.installationDate,
    removalDate: null,
  }));
  return JSON.stringify({ devices }, null, 2);
}

// Az inverter-PÁROSÍTÁS (RabbitMQ pod-registry.inverter-pod-data) 10 adatcsatornája – a Mongo-üzenet
// szerinti rövid nevekkel/egységekkel (a 13.7.0 egysége üres, a status mindenhol üres).
const PAIRING_CHANNELS: { obisCode: string; name: string; unit: string }[] = [
  { obisCode: '9.7.0', name: 'S+', unit: 'kVA' },
  { obisCode: '2.8.0', name: 'A-', unit: 'kWh' },
  { obisCode: 'X.1.8.0', name: 'A+', unit: 'kWh' },
  { obisCode: '32.7.0', name: 'U (L1)', unit: 'V' },
  { obisCode: '52.7.0', name: 'U (L2)', unit: 'V' },
  { obisCode: '72.7.0', name: 'U (L3)', unit: 'V' },
  { obisCode: '31.7.0', name: 'I (L1)', unit: 'A' },
  { obisCode: '51.7.0', name: 'I (L2)', unit: 'A' },
  { obisCode: '71.7.0', name: 'I (L3)', unit: 'A' },
  { obisCode: '13.7.0', name: 'cos φ', unit: '' },
];

// Inverter PÁROSÍTÁS üzenet a RabbitMQ `pod-registry.inverter-pod-data` queue-hoz (egy POD / üzenet).
// EZ az, ami a pod↔eszköz párosítást létrehozza a pod-registry-ben (a Mongo `messages` formátuma szerint).
function inverterPairingObj(pod: string, spec: InverterSpec, idx: number, pocOverride?: string) {
  const install = spec.installationDate;
  return {
    pod,
    // A POC-szám = a SZINKRON FOGYHELY_AZON-ja → ez a POD PocNo-ja a registry-ben. E nélkül (null) a
    // párosítás nem társítja a mérési helyet. Importált SZINKRON-nál a fájl valódi FOGYHELY_AZON-ja (pocOverride),
    // egyébként a számított érték (199700000 + sorszám).
    poc: pocOverride || fogyhelyAzon(idx + 1),
    customerMail: spec.customerMail,
    utilityType: 'electricity',
    address: {
      zipCode: '1011',
      city: 'Budapest',
      street: 'Teszt',
      streetType: 'allé',
      streetCode: String(idx + 1),
      building: '2',
      stairway: '4',
      door: '3',
      floor: '1',
      latitude: '47',
      longitude: '17',
      country: 'HU',
    },
    devices: [
      {
        serialNumber: `${pod}_INV`,
        deviceType: {
          function: 'inverter',
          brand: spec.brand,
          model: spec.model,
          nominalPower: spec.nominalPower,
          acVoltageMin: spec.acVoltageMin,
          acVoltageMax: spec.acVoltageMax,
        },
        installationDate: install,
        dataChannels: PAIRING_CHANNELS.map((c) => ({
          obisCode: c.obisCode,
          dataChannelName: c.name,
          integrationPeriod: '5',
          unit: c.unit,
          validFrom: install,
          status: '',
        })),
      },
    ],
  };
}

// Egy POD párosítás-üzenete: { podContracts: [ … ] } wrapper, TÖMÖR (minified) – a RabbitMQ
// érzékeny a sortörésre/whitespace-re, ezért nem szépítjük. __TypeId__ = …MasterDataMainDto.
function buildInverterPairing(pod: string, spec: InverterSpec, idx: number, pocOverride?: string): string {
  return JSON.stringify({ podContracts: [inverterPairingObj(pod, spec, idx, pocOverride)] });
}

// MINDEN POD párosítása egyetlen { podContracts: [ … ] } üzenetben (a „sum" kimenethez) – tömör.
function buildInverterPairingAll(pods: string[], spec: InverterSpec, pocs?: string[]): string {
  return JSON.stringify({ podContracts: pods.map((p, idx) => inverterPairingObj(p, spec, idx, pocs?.[idx])) });
}

// ISO-8601 UTC, ezredmásodperc nélkül (a mérés-DTO <date-time> formátuma, pl. 2026-06-09T08:00:00Z).
const isoUtc = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Inverter mérésadat (inverter-controller, v1.2) – serialNumber-alapú, EGY OBIS-kód / kérés.
// Ezzel ellenőrizhető a PÁROSÍTÁS: ha a v1.2 végpont 200-at ad → az eszköz benne van a PodRegistry-ben
// (202 / „Missing device data" → nincs párosítva). A payload v1/v1.1/v1.2-n azonos; csak az URL más.
export const INV_MEAS_OBIS = '2.8.0'; // HMKE termelt energia (kWh) – regisztrált, 5 perces csatorna
export function buildInverterMeasurements(
  pods: string[],
  spec: InverterSpec,
  from: Date,
  end: Date,
): { serial: string; json: string }[] {
  const step = 5 * 60_000;
  return pods.map((p) => {
    const serial = `${p}_INV`;
    const data: { timestamp: string; value: number }[] = [];
    for (let t = from.getTime(); t < end.getTime(); t += step) {
      data.push({ timestamp: isoUtc(new Date(t)), value: Number((100 + Math.random() * 1400).toFixed(2)) });
    }
    // Mindig legyen legalább egy pont (ha a tartomány túl rövid lenne).
    if (!data.length) data.push({ timestamp: isoUtc(end), value: Number((100 + Math.random() * 1400).toFixed(2)) });
    const json = JSON.stringify(
      { serialNumber: serial, readOutTs: isoUtc(end), obisCode: INV_MEAS_OBIS, brand: spec.brand, data },
      null,
      2,
    );
    return { serial, json };
  });
}

// Közös generálás: a kipipált kimenetek, mind UGYANARRA a beillesztett (valódi) POD-készletre.
// Aszinkron, hogy a MAVIR-építés közben a UI (folyamatjelző) frissülhessen, és nagy adatnál ne fagyjon le.
export async function generateBundle(
  pods: string[],
  from: Date,
  genDate: Date,
  outputs: Outputs,
  invSpec: InverterSpec,
  merlegkor: string,
  msconstSpec: MsconstSpec,
  onProgress?: (frac: number) => void,
  pocs?: string[], // importált SZINKRON esetén POD-onkénti FOGYHELY_AZON (a párosítás poc-ja); egyébként undefined
): Promise<BundleResult> {
  let { szinkron, meres, inverter, invMeres, invPair, msconst } = outputs;
  if (!szinkron && !meres && !inverter && !invMeres && !invPair && !msconst) { szinkron = true; meres = true; }

  const now = new Date();
  if (from.getTime() >= now.getTime()) from = new Date(now.getTime() - 24 * 3600_000);
  // A SZINKRON fájlnév Datum2 mezője (generálás dátuma) – paraméterezhető (doc); a parser dátumként olvassa.
  if (!(genDate instanceof Date) || isNaN(genDate.getTime())) genDate = now;

  const count = pods.length;
  const files: GeneratedFile[] = [];
  let points = 0;
  let invDevices = 0;
  onProgress?.(0);

  // Közös, egyedi időbélyeg az egész generáláshoz (a MAVIR/inverter fájlnév ezzel egyedi).
  const suffix = uniqueSuffix(now);
  // A fájlnevekhez egy DSO-kód kell – az első POD-ból vezetjük le (jellemzően mind ugyanaz a DSO).
  const dso = count ? dsoNoFromPod(pods[0]) : 'EHE000000';
  // A mérlegkör felelős EIC – a SZINKRON ÉS a MAVIR fájlnév partner-mezője is ezt használja.
  const mkf = merlegkor || BALANCE_EIC;

  if (szinkron) {
    const lines = [HEADER, ...pods.map((p, k) => szinkronRow(p, k + 1, mkf))];
    // A parser a fájlnév VÉGÉN két 8-jegyű dátumot vár: <szelekció YYYYMMDD>_<generálás YYYYMMDD>.
    // Idő (HHMMSS) ide INVALID_FORMAT-ot okoz, ezért itt NEM az egyedi időbélyeget használjuk.
    // A partner-mező a kiválasztott (valódi) mérlegkör felelős EIC – fájlnév-biztos formában.
    files.push({
      name: `Szinkron_${dso}_${fileSafePartner(mkf)}_${ymd(from)}_${ymd(genDate)}.csv`,
      content: lines.join('\r\n') + '\r\n',
      mime: 'text/csv',
      target: 'sftp',
      hint: 'SZINKRON törzsadat – töltsd fel az SFTP-re',
      meta: `${count} POD`,
    });
  }

  if (meres) {
    const sums: number[] = new Array(count).fill(0);
    // ~1 GB felett POD-onként több önálló, érvényes EDW_XML fájlra bontunk (megosztott terv).
    const { podsPerFile, parts } = mavirSplitPlan(count, from, now);
    for (let pi = 0; pi < parts; pi++) {
      const groupPods = pods.slice(pi * podsPerFile, (pi + 1) * podsPerFile);
      const groupSums = new Array(groupPods.length).fill(0);
      const { blob, points: pts } = await buildMavirXml(groupPods, from, now, now, onProgress, groupSums);
      points += pts;
      for (let i = 0; i < groupSums.length; i++) sums[pi * podsPerFile + i] = groupSums[i];
      const part = parts > 1 ? `_part${pi + 1}of${parts}` : '';
      files.push({
        name: `${dso}_${fileSafePartner(mkf)}_Eseti_FF_EGYEDI1${part}_${suffix}.xml`,
        content: '',
        blob,
        mime: 'text/xml',
        target: 'sftp',
        hint: parts > 1
          ? `MAVIR mérés (${pi + 1}/${parts} rész) – töltsd fel az SFTP-re`
          : 'MAVIR mérés – töltsd fel az SFTP-re',
        meta: `${groupPods.length} POD, ${pts} pont`,
      });
    }
    files.push({
      name: `energia_osszesito_${suffix}.txt`,
      content: buildEnergyReport(pods, sums, from, now, now),
      mime: 'text/plain',
      target: 'report',
      hint: 'Energia-összesítő (POD ↔ inverter ↔ kWh) a MAVIR mérésből',
      meta: `${count} POD`,
    });
  } else {
    onProgress?.(0.5);
  }

  if (inverter) {
    invDevices = count;
    files.push({
      name: `inverter_master-data_${suffix}.json`,
      content: buildInverterMasterData(pods, invSpec),
      mime: 'application/json',
      target: 'swagger',
      hint: 'Inverter gyártói törzsadat – másold a Swagger (receiveMasterDataFromManufacturer) request body-ba',
      meta: `${count} eszköz`,
    });
  }

  if (invMeres) {
    // Egy fájl / inverter (a v1.2 inverter-controller egy serialNumber-t fogad kérésenként).
    // A párosítás ellenőrzésére: 200 → benne van a PodRegistry-ben; 202 → „Missing device data".
    buildInverterMeasurements(pods, invSpec, from, now).forEach(({ serial, json }, idx) => {
      files.push({
        name: `inverter_meresadat_${idx + 1}_${suffix}.json`,
        content: json,
        mime: 'application/json',
        target: 'measurement',
        hint: `Inverter mérésadat (v1.2) – ${serial} · OBIS ${INV_MEAS_OBIS}`,
        meta: `1 eszköz · ${INV_MEAS_OBIS}`,
      });
    });
  }

  if (invPair) {
    // Egy üzenet / POD a RabbitMQ pod-registry.inverter-pod-data queue-hoz (Management UI → Publish → Payload).
    pods.forEach((p, idx) => {
      files.push({
        name: `inverter_parositas_${idx + 1}_${suffix}.json`,
        content: buildInverterPairing(p, invSpec, idx, pocs?.[idx]),
        mime: 'application/json',
        target: 'rabbit',
        hint: 'Inverter párosítás → RabbitMQ pod-registry.inverter-pod-data (Management UI → Publish → Payload)',
        meta: `1 POD · RabbitMQ`,
        serial: `${p}_INV`,
      });
    });
    // „Sum": minden párosítás egyetlen JSON tömbben (1-nél több POD esetén) – egy üzenetként publikálható.
    if (count > 1) {
      files.push({
        name: `inverter_parositas_OSSZES_${suffix}.json`,
        content: buildInverterPairingAll(pods, invSpec, pocs),
        mime: 'application/json',
        target: 'rabbit',
        hint: 'Inverter párosítás – ÖSSZES egy JSON tömbben (egy üzenetként, ha a consumer elfogadja a tömböt)',
        meta: `${count} POD egyben · RabbitMQ`,
      });
    }
  }

  if (msconst) {
    files.push({
      name: msconstFileName(pods, mkf),
      content: buildMsconst(pods, msconstSpec, now),
      mime: 'text/xml',
      target: 'msconst',
      hint: 'MSCONST (MAVIR EDW_XML, konstans érték / POD) – töltsd fel az SFTP-re',
      meta: `${count} POD`,
    });
  }

  onProgress?.(1);
  return { pods: count, points, invDevices, files };
}
