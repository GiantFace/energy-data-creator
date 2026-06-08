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
};

export type Outputs = { szinkron: boolean; meres: boolean; inverter: boolean };

export type GeneratedFile = {
  name: string;
  content: string; // szöveges tartalom (CSV/JSON/TXT); nagy MAVIR-nál üres, helyette `blob`
  mime: string;
  target: 'sftp' | 'swagger' | 'report';
  hint: string;
  meta: string;
  // Nagy fájl (sok hónapos MAVIR): a tartalom Blob-ként, mert egy ekkora sztring meghaladná a böngésző korlátját.
  blob?: Blob;
  // Nagyon nagy fájl: közvetlenül lemezre streamelve (nincs memóriában) – csak info-bejegyzés a listában.
  savedToDisk?: boolean;
};

export type BundleResult = { pods: number; points: number; invDevices: number; files: GeneratedFile[] };

const TRADER = 'SYNTH-TEST';
const BALANCE_EIC = '15X-SINERGY----D';
const MEAS_OBIS = '1.29.99.128';

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

// Az inverter (HMKE) eszköz fix adatcsatornái a master-data formátumhoz.
const INVERTER_CHANNELS: { obisCode: string; dataChannelName: string; unit: string }[] = [
  // A registry típus egysége üres, de az API a bemeneten NEM enged üres unitot (@NotBlank) →
  // nem-üres értéket küldünk; a csatorna-típushoz az OBIS-kód alapján társít, nem az egységen.
  { obisCode: '13.7.0', dataChannelName: 'Inverter teljesítmény tényező', unit: '1' },
  { obisCode: '2.8.0', dataChannelName: 'HMKE termelt energia (kWh)', unit: 'kWh' },
  { obisCode: '31.7.0', dataChannelName: 'Áramerősség L1 fázison', unit: 'A' },
  { obisCode: '32.7.0', dataChannelName: 'Feszültség L1 fázison', unit: 'V' },
  { obisCode: '51.7.0', dataChannelName: 'Áramerősség L2 fázison', unit: 'A' },
  { obisCode: '52.7.0', dataChannelName: 'Feszültség L2 fázison', unit: 'V' },
  { obisCode: '71.7.0', dataChannelName: 'Áramerősség L3 fázison', unit: 'A' },
  { obisCode: '72.7.0', dataChannelName: 'Feszültség L3 fázison', unit: 'V' },
  { obisCode: '9.7.0', dataChannelName: 'HMKE termelési teljesítmény (kVA)', unit: 'kVA' },
  { obisCode: 'X.1.8.0', dataChannelName: 'HMKE termelésből saját célra történő felhasználás', unit: 'kWh' },
];

// A POD-ot kívülről kapja (a közös, beillesztett `pods` készletből) – így a SZINKRON, a MAVIR
// és az inverter MINDIG bájtra azonos POD-okat használ. Az [Eloszto] a POD-ból levezetett DSO.
function szinkronRow(p: string, i: number): string {
  const fogyhely = String(199700000 + i);
  return [
    '2024.09.01', '2040.12.31', dsoNoFromPod(p), TRADER, BALANCE_EIC, p, fogyhely,
    '0.0', 'IDOS', '2026.05.01', '10.01', '10.01', 'Teszt', `Ugyfel${i}`, 'Teszt utca', String(i),
    'Budapest', '1011', 'K', 'KOF', 'VIZUGY', 'KOF_A_KIF_T', '60,0000000', '1',
    '2023.01.09', '2021.03.01', '1+0', 'HMKE-02', '001', '1.0', '2025.08.01', '2025.08.01',
  ].join('|');
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
export function mavirFileName(pods: string[]): string {
  const dso = pods.length ? dsoNoFromPod(pods[0]) : 'EHE000000';
  return `${dso}_${TRADER}_Eseti_FF_EGYEDI1_${uniqueSuffix(new Date())}.xml`;
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

// Inverter párosítás – a master-data (podContracts) formátum, amit a dso-controller elfogad.
// A POD-hoz egy 'inverter' funkciójú eszköz az inverter brand/model/teljesítmény adataival és
// a 10 fix HMKE adatcsatornával.
function buildInverterJson(pods: string[], spec: InverterSpec): string {
  const install = spec.installationDate;
  const podContracts = pods.map((p, idx) => ({
    pod: p,
    utilityType: 'electricity',
    dsoNo: dsoNoFromPod(p),
    address: {
      zipCode: '1011',
      city: 'Budapest',
      street: 'Teszt',
      streetType: 'utca',
      streetCode: String(idx + 1),
      country: 'HU',
    },
    devices: [
      {
        serialNumber: `${p}_INV`,
        deviceType: {
          function: 'inverter',
          brand: spec.brand,
          model: spec.model,
          nominalPower: spec.nominalPower,
          acVoltageMin: spec.acVoltageMin,
          acVoltageMax: spec.acVoltageMax,
        },
        isSettlement: true,
        installationDate: install,
        dataChannels: INVERTER_CHANNELS.map((c) => ({
          obisCode: c.obisCode,
          dataChannelName: c.dataChannelName,
          integrationPeriod: '5',
          unit: c.unit,
          validFrom: install,
          validUntil: null,
          status: 'W',
        })),
      },
    ],
  }));
  return JSON.stringify({ podContracts }, null, 2);
}

// Közös generálás: a kipipált kimenetek, mind UGYANARRA a beillesztett (valódi) POD-készletre.
// Aszinkron, hogy a MAVIR-építés közben a UI (folyamatjelző) frissülhessen, és nagy adatnál ne fagyjon le.
export async function generateBundle(
  pods: string[],
  from: Date,
  genDate: Date,
  outputs: Outputs,
  invSpec: InverterSpec,
  onProgress?: (frac: number) => void,
): Promise<BundleResult> {
  let { szinkron, meres, inverter } = outputs;
  if (!szinkron && !meres && !inverter) { szinkron = true; meres = true; }

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

  if (szinkron) {
    const lines = [HEADER, ...pods.map((p, k) => szinkronRow(p, k + 1))];
    // A parser a fájlnév VÉGÉN két 8-jegyű dátumot vár: <szelekció YYYYMMDD>_<generálás YYYYMMDD>.
    // Idő (HHMMSS) ide INVALID_FORMAT-ot okoz, ezért itt NEM az egyedi időbélyeget használjuk.
    files.push({
      name: `Szinkron_${dso}_${TRADER}_${ymd(from)}_${ymd(genDate)}.csv`,
      content: lines.join('\r\n') + '\r\n',
      mime: 'text/csv',
      target: 'sftp',
      hint: 'SZINKRON törzsadat – töltsd fel az SFTP-re',
      meta: `${count} POD`,
    });
  }

  if (meres) {
    const sums: number[] = new Array(count).fill(0);
    const { blob, points: pts } = await buildMavirXml(pods, from, now, now, onProgress, sums);
    points = pts;
    files.push({
      name: `${dso}_${TRADER}_Eseti_FF_EGYEDI1_${suffix}.xml`,
      content: '',
      blob,
      mime: 'text/xml',
      target: 'sftp',
      hint: 'MAVIR mérés – töltsd fel az SFTP-re',
      meta: `${count} POD, ${pts} pont`,
    });
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
      content: buildInverterJson(pods, invSpec),
      mime: 'application/json',
      target: 'swagger',
      hint: 'Inverter párosítás – másold a Swagger (congestMasterData) request body-ba',
      meta: `${count} POD, ${INVERTER_CHANNELS.length} HMKE csatorna`,
    });
  }

  onProgress?.(1);
  return { pods: count, points, invDevices, files };
}
