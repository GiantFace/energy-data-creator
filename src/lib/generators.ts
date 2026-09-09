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

// Kereskedő (a [Kereskedo] mező + a fájlnév trader-része) – a kért ELMŰ 210 – TEST-FEAK
// DSO-kereskedő teszt-pár. (Korábban 'SYNTH-TEST'.)
const TRADER = 'TEST-FEAK';
// Mérlegkör-felelős fallback EIC; a SZINKRON-ban a kiválasztott BALANCE_RESPONSIBLES (merlegkor) felülírja.
const BALANCE_EIC = '15X-SINERGY----D';
// A MAVIR terhelési-görbe csatornák (DataChannelTypes registry, 15 perc): CHANNEL-NAME → OBIS + egység.
export type MavirChannel = 'A+' | 'A-' | 'R+' | 'R-';
const MAVIR_CHANNELS: Record<MavirChannel, { obis: string; unit: string }> = {
  'A+': { obis: '1.29.99.128', unit: 'kwh' },   // hatásos energia fogyasztás (vételezés)
  'A-': { obis: '2.29.99.128', unit: 'kwh' },   // hatásos energia visszatáplálás (termelés)
  'R+': { obis: '3.29.99.128', unit: 'kVArh' }, // import meddő energia
  'R-': { obis: '4.29.99.128', unit: 'kVArh' }, // export meddő energia
};

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
  { eic: 'OTTI-FEAK1', name: 'OTTI TEST1 Zrt' },
  { eic: "HARVEY'S PARTNER", name: "HARVEY'S PARTNER DDK" },
  { eic: '15X-PGP-TSL1---6', name: 'PAKS TESZT' },
  { eic: '15X-HRVYS-BR-1', name: 'Balareg Harveys Kft.' },
  { eic: 'FEAKFECOOAA0001', name: 'FEAK-FECOO-AA-0001' },
];

// Fájlnév-biztos partner: a nem [A-Za-z0-9.-] karaktereket (pl. '_', szóköz, aposztróf) kötőjelre
// cseréli, hogy a SZINKRON fájlnév két végdátumát a parser biztosan ki tudja olvasni.
function fileSafePartner(s: string): string {
  return (s || '').replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || TRADER;
}

// A SZINKRON fejléce – az „ENAP fájlfeldolgozás követelményei" szerint RÖGZÍTETT, nem paraméterezhető.
// (A korábbi verzió csupa nagybetűs neveket írt, és az utolsó két oszlop [HMKE_IGENY]|[HMKE_BE] volt
//  a követelményben szereplő [HMKE_TDIJ_KEZD]|[HMKE_TMERO_KEZD] helyett.)
const HEADER =
  '[Ellatas_Kezd]|[Ellatas_Bef]|[Eloszto]|[Kereskedo]|[Merlegkor_Felelos]|[POD]|[Fogyhely_Azon]|' +
  '[UF]|[PT]|[Ford_Nap]|[Leolvasas]|[Elszamolas]|[Ugyfel_Neve_1]|[Ugyfel_Neve_2]|[Utca]|[Hazszam]|' +
  '[Varos]|[Ir_Szam]|[RHD_Fiz]|[RHD_Tarifa]|[RHD_Kieg_1]|[RHD_Kieg_2]|[ELO_Lek_kW]|[CsP]|' +
  '[RHD_Tarifa_Kezd]|[ELO_Lek_Kezd]|[Mero_Tarifa]|[Termeles]|[Vedendo]|[Termeles_telj]|' +
  '[HMKE_TDIJ_KEZD]|[HMKE_TMERO_KEZD]';

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

// A POD PONTOS hossza – ennél se több, se kevesebb nem megy át a master-data validátorán.
export const POD_LEN = 33;
// A törzs maximuma: 33 - 8 (HU + 6 jegyű DSO) - 1, mert a sorszámnak legalább egy jegy kell.
export const POD_BODY_MAX = POD_LEN - 8 - 1; // 24

// A POD-törzs tisztítása: nagybetűs [A-Z0-9-] (a doc-mintában kötőjel is van), a maradék helyre vágva.
export function sanitizePodBody(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, POD_BODY_MAX);
}

// A DSO-kódból az előtag: HU + 6 jegyű DSO-azonosító (pl. EHE000910 -> HU000910). Mindig 8 karakter.
function podPrefix(dso: string): string {
  const raw = dso.toUpperCase().startsWith('EHE') ? dso.slice(3) : dso.replace(/\D/g, '');
  return 'HU' + raw.slice(0, 6).padEnd(6, '0');
}

// Mennyi POD fér el egy adott törzzsel? A POD FIX 33 karakter, így a sorszámnak csak az marad,
// amit az előtag (8) és a törzs meghagy: `seqWidth` jegy → 1..10^seqWidth-1 sorszám.
// Ennél többet kérve a sorszám kilógna (34 karakteres POD → „Invalid POD format”), ezért a
// hívó ELŐRE ellenőrzi ezzel, és nem a generálás közben derül ki, hogy nem fér el.
//   pl. 24 karakteres törzs → 1 jegy → max 9 POD;  19 karakteres törzs → 6 jegy → max 999 999 POD.
export function podCapacity(dso: string, body: string): { body: string; seqWidth: number; max: number } {
  const b = sanitizePodBody(body);
  const seqWidth = POD_LEN - podPrefix(dso).length - b.length;
  return { body: b, seqWidth, max: 10 ** seqWidth - 1 };
}

// Sorszámozott POD a master-data elvárt formátumában: HU + 6 jegyű DSO-kód + törzs + sorszám,
// ahol a sorszám NULLÁVAL TÖLTI KI a maradékot, hogy a POD PONTOSAN 33 karakter legyen.
//   Példa: HU000310 + F11-S + 00000000000000000001 = HU000310F11-S00000000000000000001 (33 kar.)
// (A korábbi 32 karakteres ...TESZT001 ezért bukott „Invalid POD format”-tal a master-datán.)
export function generatePods(count: number, dso: string, body: string): string[] {
  const n = Math.max(0, Math.floor(count) || 0);
  const prefix = podPrefix(dso); // 8 karakter
  const { body: b, seqWidth, max } = podCapacity(dso, body);
  // Backstop: ennyi sorszám nem fér a 33 karakterbe. A felület ezt előre jelzi, ide már nem juthat el.
  if (n > max) {
    throw new RangeError(`A(z) "${b}" törzs mellett csak ${max} POD fér el (${seqWidth} jegyű sorszám).`);
  }
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(prefix + b + String(i).padStart(seqWidth, '0'));
  }
  return out;
}

// Egyetlen sorszámozott POD (a készlet i-edik eleme) – a felület mintáihoz, tömb építése nélkül.
export function podAt(dso: string, body: string, index: number): string {
  const { body: b, seqWidth } = podCapacity(dso, body);
  return podPrefix(dso) + b + String(Math.max(1, Math.floor(index) || 1)).padStart(seqWidth, '0');
}

// Stabil minta a felülethez (az 1. POD), hogy a felhasználó élőben lássa a végeredményt.
export function examplePodTemplate(dso: string, body: string): string {
  return podAt(dso, body, 1);
}

// A FOGYHELY_AZON (fogyasztási hely / POC azonosító): a SZINKRON ezt írja, és ez lesz a POD PocNo-ja
// a registry-ben. A párosítás `poc` mezője UGYANEZT kapja – e nélkül nem társítódik a mérési hely.
const FOGYHELY_BASE = 199700000;
const fogyhelyAzon = (i: number) => String(FOGYHELY_BASE + i);

// A POD-ot kívülről kapja (a közös, beillesztett `pods` készletből) – így a SZINKRON, a MAVIR
// és az inverter MINDIG bájtra azonos POD-okat használ. Az [Eloszto] a POD-ból levezetett DSO.
// A követelmény KÖTELEZŐ ellenőrzése: a fájlnévből öröklődő mezők (Eloszto, Kereskedo,
// Merlegkor_Felelos, Ford_Nap) értéke EGYEZZEN a fájlnévvel. Ezért a `kereskedo` ugyanaz az EIC,
// ami a fájlnév 3. mezőjébe kerül, a `fordNap` pedig a fájlnév Datum1 (szelekciós dátum) mezője.
// A `poc` (ha van) a feltöltött SZINKRON Fogyhely_Azon-ja vagy annak léptetett párja – így a CSV,
// a párosítás és a registry UGYANAZT a fogyasztási helyet kapja. Nélküle a számított érték megy.
function szinkronRow(p: string, i: number, merlegkor: string, kereskedo: string, fordNap: string, poc?: string): string {
  const fogyhely = poc || fogyhelyAzon(i);
  return [
    ellatasKezd(fordNap), '9999.12.31', dsoNoFromPod(p), kereskedo, merlegkor, p, fogyhely,
    '0', 'IDOS', fordNap, '10.01', '10.01', 'Teszt', `Ugyfel${i}`, 'Teszt utca', String(i),
    'Budapest', '1011', 'K', 'KOF', 'VIZUGY', 'KOF_A_KIF_T', '60,0000000', '1',
    '2023.01.09', '2021.03.01', '1+0', 'HMKE-02', '001', '1.0', '2025.08.01', '2025.08.01',
  ].join('|');
}

// [Ellatas_Kezd] <= [Ford_Nap] – a követelmény ezt is ellenőrzi. Alapból 2024.09.01, de ha a
// szelekciós dátum ennél korábbi, akkor azzal megyünk (különben a sor elbukna az ellenőrzésen).
const ELLATAS_KEZD_DEFAULT = '2024.09.01';
function ellatasKezd(fordNap: string): string {
  return fordNap && fordNap < ELLATAS_KEZD_DEFAULT ? fordNap : ELLATAS_KEZD_DEFAULT;
}

// A fájlnév Datum1 (szelekciós dátum) mezője éééé.hh.nn alakban – ez megy a [Ford_Nap] oszlopba.
const ymdDots = (d: Date) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;

// A SZINKRON oszlopnevei (a [...] zárójeleket levéve) – a parser fejléc hiányában ezt használja fallbacknek.
export const SZINKRON_COLUMNS = HEADER.split('|').map((c) => c.replace(/^\[|\]$/g, ''));

// Egy feltöltött SZINKRON forrássora, oszlopnév → érték (a [...] zárójelek nélkül).
export type SzinkronSource = Record<string, string>;

// Feltöltött SZINKRON-ból generálva a sor a MINTÁBÓL jön: a cím ([UTCA]/[HAZSZAM]/[VAROS]/[IR_SZAM]),
// az ügyfél és az összes tarifa-mező VÁLTOZATLANUL a forrássorból; csak a POD és a FOGYHELY_AZON új
// (a származtatott soroknál). Az oszlopsorrend a generált fejléchez igazodik, a hiányzó mező üres.
function szinkronRowFromSource(
  src: Record<string, string>, pod: string, i: number,
  merlegkor: string, kereskedo: string, fordNap: string, poc?: string,
): string {
  // Ha a feltöltött fájl fejléce eltér (hiányzó oszlop), a beépített mintasor adott mezője pótolja –
  // így a kimenet akkor sem lesz hiányos/érvénytelen. Az ÜRESEN hagyott mezőt viszont NEM töltjük ki
  // (az a minta szándéka), kivéve a Fogyhely_Azon-t: annak egyeznie kell a párosítás poc-jával.
  const fallback = szinkronRow(pod, i, merlegkor, kereskedo, fordNap, poc).split('|');
  const get = srcLookup(src);
  return SZINKRON_COLUMNS.map((c, ci) => {
    // A fájlnévből öröklődő mezőket KÖTELEZŐ a fájlnévhez igazítani (a validátor ezt ellenőrzi),
    // ezért ezeket a mintából NEM vesszük át.
    if (c === 'POD') return pod;
    if (c === 'Kereskedo') return kereskedo;
    if (c === 'Ford_Nap') return fordNap;
    // Az Ellatas_Kezd a mintából jön, DE a követelmény szerint <= Ford_Nap – ha későbbi lenne,
    // a szelekciós dátumra húzzuk vissza, különben a sor elbukna az ellenőrzésen.
    if (c === 'Ellatas_Kezd') { const v = get(c)?.trim(); return v && v <= fordNap ? v : ellatasKezd(fordNap); }
    if (c === 'Fogyhely_Azon') return poc || get(c) || fogyhelyAzon(i);
    const v = get(c);
    return v === undefined ? (fallback[ci] ?? '') : v.trim();
  }).join('|');
}

// Oszlop-kiolvasás a forrássorból KIS/NAGYBETŰ-eltéréstől függetlenül: a korábbi verzió által
// generált (és utána visszatöltött) SZINKRON-ok csupa nagybetűs fejlécet írtak ([FOGYHELY_AZON]),
// a követelmény viszont [Fogyhely_Azon]-t ír elő – mindkettőt fel kell ismernünk.
function srcLookup(src: Record<string, string>): (col: string) => string | undefined {
  const map = new Map<string, string>();
  for (const k of Object.keys(src)) map.set(k.trim().toLowerCase(), src[k]);
  return (col: string) => map.get(col.trim().toLowerCase());
}

// Egy mező kiolvasása a parsolt sorból, a fejléc kis/nagybetűs írásmódjától függetlenül.
export function szinkronField(row: Record<string, string>, col: string): string {
  return srcLookup(row)(col) ?? '';
}

// A SZINKRON [UTCA] mezője a közterület nevét ÉS jellegét együtt tartalmazza (pl. „Kossuth utca"),
// a párosítás viszont külön kéri – az utolsó szót leválasztjuk, ha ismert közterület-jelleg.
const STREET_TYPES = [
  'utca', 'út', 'útja', 'tér', 'tere', 'körút', 'krt', 'krt.', 'allé', 'sor', 'köz', 'sétány', 'part',
  'fasor', 'dűlő', 'rakpart', 'lakótelep', 'ltp', 'ltp.', 'telep', 'liget', 'sugárút', 'körönd',
  'udvar', 'park', 'kert', 'lejtő', 'domb', 'erdősor', 'forduló', 'sétaút', 'u.', 'u',
];
// Ékezetre érzéketlen összevetés: a teszt-fájlokban a „tér"/„út" gyakran ékezet nélkül szerepel.
const noAccent = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STREET_TYPES_N = STREET_TYPES.map(noAccent);
function splitStreet(utca: string): { street: string; streetType: string } {
  const parts = (utca ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: parts.join(' '), streetType: '' };
  const last = parts[parts.length - 1];
  if (STREET_TYPES_N.includes(noAccent(last))) {
    return { street: parts.slice(0, -1).join(' '), streetType: last };
  }
  return { street: parts.join(' '), streetType: '' };
}

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

// A FOGYHELY_AZON léptetése a HOSSZ MEGTARTÁSÁVAL: a benne lévő leghosszabb számjegy-blokkot növeli
// (egyenlőségnél a jobb szélsőt) – a poc jellemzően csupa szám (199700001), ott ez a teljes érték.
// BigInt kell hozzá, mert az azonosító akár 25 jegyű is lehet (a Number ott már pontatlan).
// null, ha nincs benne szám, vagy ha túlcsordulna (csupa 9) – ilyenkor a poc üresen marad.
function bumpSerial(id: string, by: number): string | null {
  const rest = id ?? '';
  let best: { at: number; digits: string } | null = null;
  for (const m of rest.matchAll(/\d+/g)) {
    if (!best || m[0].length >= best.digits.length) best = { at: m.index, digits: m[0] };
  }
  if (!best) return null;
  const next = (BigInt(best.digits) + BigInt(by)).toString();
  if (next.length > best.digits.length) return null; // hosszabb lenne az azonosító → nem használható
  return rest.slice(0, best.at) + next.padStart(best.digits.length, '0') + rest.slice(best.at + best.digits.length);
}

// Ugyanaz, de átugorja a már foglalt értékeket (a feltöltött fájlban lévőket és a korábban gyártottakat).
function bumpUnique(id: string, by: number, used: Set<string>): string | null {
  for (let k = by; k < by + 10_000; k++) {
    const v = bumpSerial(id, k);
    if (!v) return null;
    if (!used.has(v)) return v;
  }
  return null;
}

// A feltöltött SZINKRON sorainak FELSZORZÁSA `total` darabra.
// A fájl sorai VÁLTOZATLANUL megmaradnak (azok a valódi, registry-beli POD-ok) – a hiányzó darabot
// belőlük származtatjuk úgy, hogy a POD VÉGÉRE tesszük a sorszámot (a forrás-POD vége íródik felül,
// a hossz marad pontosan annyi, amennyi az eredetié – tipikusan 33 karakter):
//   HU000210F51-U-000000000000HARVEYS + 4. sorszám → HU000210F51-U-000000000000HARV004
// A sorszám szélessége a kért darabszámhoz igazodik (100 → 3 jegy, 1000 → 4 jegy).
// A FOGYHELY_AZON a forrássoré léptetve, a cím/ügyfél/tarifa és a mérlegkör a forrássorból öröklődik.
// `total` <= a sorok száma esetén csak az első `total` sort adja vissza (szűkítés).
export function expandSzinkronRows(base: SzinkronRowKey[], total: number): SzinkronRowKey[] {
  const want = Math.max(0, Math.floor(total) || 0);
  if (!base.length || !want) return [];
  if (want <= base.length) return base.slice(0, want);
  const out = base.slice();
  const usedPods = new Set(base.map((r) => r.pod));
  const usedPocs = new Set(base.map((r) => r.poc).filter(Boolean));
  const width = String(want).length; // ennyi jegy kell a legnagyobb sorszámhoz
  const made = new Array(base.length).fill(0); // forrássoronként hány származtatottat gyártottunk már
  for (let n = base.length + 1; n <= want; n++) {
    // Körbe-körbe a forrássorokon, hogy több DSO/mérlegkör/cím esetén mindegyikből származzon új POD.
    const si = (n - 1) % base.length;
    const src = base[si];
    const stem = src.pod.slice(0, Math.max(0, src.pod.length - width));
    if (!stem) continue; // védelem: a POD rövidebb, mint a sorszám → abból nem származtatunk
    // A sorszám a POD VÉGÉN; ütközésnél (két forrássor azonos törzse) a következő szabad számot kapja.
    let pod = '';
    for (let k = n; k < n + 10_000; k++) {
      const cand = stem + String(k).padStart(width, '0').slice(-width);
      if (!usedPods.has(cand)) { pod = cand; break; }
    }
    if (!pod) continue;
    // A FOGYHELY_AZON a forrássoré + 1, +2, … (forrássoronként külön számolva, hogy szép sorozat legyen);
    // a hossz itt is marad, üres poc üresen marad.
    made[si] += 1;
    const poc = src.poc ? (bumpUnique(src.poc, made[si], usedPocs) ?? '') : '';
    usedPods.add(pod);
    if (poc) usedPocs.add(poc);
    out.push({
      ...src,
      pod,
      poc,
      // A forrássor MINDEN mezője öröklődik (UTCA/HAZSZAM/VAROS/IR_SZAM, ügyfél, tarifák) –
      // csak a POD és a FOGYHELY_AZON az új.
      row: src.row ? withPodPoc(src.row, pod, poc) : undefined,
    });
  }
  return out;
}

// A származtatott sor: a forrássor másolata, de a POD és a Fogyhely_Azon az új érték – a MEGLÉVŐ
// oszlopnév-írásmóddal felülírva (különben két kulcs maradna: pl. FOGYHELY_AZON és Fogyhely_Azon).
function withPodPoc(row: Record<string, string>, pod: string, poc: string): Record<string, string> {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    const kk = k.trim().toLowerCase();
    if (kk === 'pod') out[k] = pod;
    else if (kk === 'fogyhely_azon') out[k] = poc || out[k];
  }
  return out;
}

// A parsolt SZINKRON sorokból a generáláshoz fontos mezők (POD, FOGYHELY_AZON=poc, mérlegkör, eloszto).
// A `row` a TELJES forrássor a feltöltött fájlból – ebből megy a cím, az ügyfél és a tarifa-mezők a
// generált SZINKRON-ba és a párosításba (a származtatott soroknál is, a forrássorból örökölve).
export type SzinkronRowKey = {
  pod: string; poc: string; merlegkor: string; eloszto: string;
  row?: Record<string, string>;
};
export function szinkronKeyRows(rows: Record<string, string>[]): SzinkronRowKey[] {
  return rows
    .map((r) => {
      const get = srcLookup(r);
      return {
        pod: get('POD') ?? '',
        poc: get('Fogyhely_Azon') ?? '',
        merlegkor: get('Merlegkor_Felelos') ?? '',
        eloszto: get('Eloszto') ?? '',
        row: r,
      };
    })
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
  channels: MavirChannel[] = ['A+'], // A+ (fogyasztás) és/vagy A- (termelés) – POD-onként külön <DATA> blokk
): AsyncGenerator<string, void, unknown> {
  const stepMs = 15 * 60_000;
  const perPod = Math.max(0, Math.floor((end.getTime() - from.getTime()) / stepMs));
  const total = Math.max(1, pods.length * perPod * channels.length);
  let buf =
    "<?xml version='1.0' encoding='UTF-8'?>\r\n" +
    '<EDW_XML xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://tempuri.org/MAVIR">\r\n' +
    '    <HEADER>\r\n        <VERSION>1.0</VERSION>\r\n        <GENERATOR>WM_XML_Generator</GENERATOR>\r\n' +
    `        <GENERATED-DATETIME>${isoLocal(generated)}</GENERATED-DATETIME>\r\n    </HEADER>\r\n`;
  let points = 0;
  let lastTick = Date.now();
  for (let i = 0; i < pods.length; i++) {
    const p = pods[i];
    // POD-onként minden kért csatorna külön <DATA> blokk (A+/A-/R+/R-). Az összesítő (sums) az első csatorna.
    for (const channel of channels) {
      const { obis, unit } = MAVIR_CHANNELS[channel];
      buf += '    <DATA>\r\n';
      buf += `        <LOC-KEY>${p}</LOC-KEY>\r\n`;
      buf += `        <CHANNEL-NAME>${channel}</CHANNEL-NAME>\r\n`;
      buf += `        <VALUE-NAME>${obis}</VALUE-NAME>\r\n`;
      buf += `        <VALUE-UNIT>${unit}</VALUE-UNIT>\r\n        <T-FACTOR>1</T-FACTOR>\r\n        <INTERVAL>00:15:00</INTERVAL>\r\n`;
      buf += '        <BLOCK>\r\n';
      buf += `            <START-DATETIME>${isoLocal(from)}</START-DATETIME>\r\n`;
      for (let t = from.getTime(); t < end.getTime(); t += stepMs) {
        const v = (100 + Math.random() * 1400).toFixed(2);
        if (sums && channel === channels[0]) sums[i] = (sums[i] ?? 0) + Number(v);
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
  // Fordított sorrendű megadást (min > max) is elfogadunk – a tartomány a két érték között van.
  const lo = Math.min(spec.valueMin, spec.valueMax);
  const span = Math.abs(spec.valueMax - spec.valueMin);
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

// A MAVIR (rész)fájlnevek – mindegyik ÖNÁLLÓ, szabályos MAVIR név: ..._Eseti_FF_EGYEDI1_<YYYYMMDD>_<HHMMSS>.xml.
// NINCS partXofY infix: azt a MAVIR fájlnév-parser INVALID_FORMAT_CANNOT_PROCESS-szal elutasítja. Az egyediséget
// a generálási időhöz adott rész-index (másodperc) adja, így minden résznek szabályos, de eltérő neve lesz.
export function mavirFileNames(pods: string[], merlegkor: string | undefined, parts: number): string[] {
  const dso = pods.length ? dsoNoFromPod(pods[0]) : 'EHE000000';
  const partner = fileSafePartner(merlegkor || BALANCE_EIC);
  const base = new Date();
  return Array.from({ length: Math.max(1, parts) }, (_, i) => {
    const t = new Date(base.getTime() + i * 1000);
    return `${dso}_${partner}_Eseti_FF_EGYEDI1_${ymd(t)}_${hms(t)}.xml`;
  });
}

// A MAVIR mérést ~0,5 MB-os, ÖNÁLLÓAN érvényes EDW_XML fájlokra bontja (mindegyik <=~0,5 MB), hogy a
// file-processor Kafka-üzenete (serial-ts topic) a ~1 MB limit alatt maradjon. Egy POD+csatorna idősora
// is átnyúlhat több fájlba: a folytatás ott új <DATA> blokk, a részkezdethez igazított START-DATETIME-mel.
// A sums (összesítő) az első csatorna (A+) értékeiből gyűlik. Szinkron – a kis/közepes MAVIR itt épül.
const MAVIR_PART_TARGET_BYTES = 500 * 1024; // ~0,5 MB / fájl
function buildMavirParts(
  pods: string[],
  from: Date,
  end: Date,
  generated: Date,
  channels: MavirChannel[] = ['A+'],
  sums?: number[],
  targetBytes = MAVIR_PART_TARGET_BYTES,
): { content: string; points: number }[] {
  const stepMs = 15 * 60_000;
  const header =
    "<?xml version='1.0' encoding='UTF-8'?>\r\n" +
    '<EDW_XML xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://tempuri.org/MAVIR">\r\n' +
    '    <HEADER>\r\n        <VERSION>1.0</VERSION>\r\n        <GENERATOR>WM_XML_Generator</GENERATOR>\r\n' +
    `        <GENERATED-DATETIME>${isoLocal(generated)}</GENERATED-DATETIME>\r\n    </HEADER>\r\n`;
  const footer = '</EDW_XML>';
  const dataHead = (p: string, ch: MavirChannel, obis: string, unit: string, startMs: number) =>
    '    <DATA>\r\n' +
    `        <LOC-KEY>${p}</LOC-KEY>\r\n` +
    `        <CHANNEL-NAME>${ch}</CHANNEL-NAME>\r\n` +
    `        <VALUE-NAME>${obis}</VALUE-NAME>\r\n` +
    `        <VALUE-UNIT>${unit}</VALUE-UNIT>\r\n        <T-FACTOR>1</T-FACTOR>\r\n        <INTERVAL>00:15:00</INTERVAL>\r\n` +
    '        <BLOCK>\r\n' +
    `            <START-DATETIME>${isoLocal(new Date(startMs))}</START-DATETIME>\r\n`;
  const dataFoot = '        </BLOCK>\r\n    </DATA>\r\n';

  const files: { content: string; points: number }[] = [];
  let buf = header;
  let filePoints = 0;
  const flush = () => {
    if (filePoints > 0) files.push({ content: buf + footer, points: filePoints });
    buf = header;
    filePoints = 0;
  };

  for (let i = 0; i < pods.length; i++) {
    const p = pods[i];
    for (const ch of channels) {
      const { obis, unit } = MAVIR_CHANNELS[ch];
      let blockOpen = false;
      for (let t = from.getTime(); t < end.getTime(); t += stepMs) {
        if (!blockOpen) { buf += dataHead(p, ch, obis, unit, t); blockOpen = true; }
        const v = (100 + Math.random() * 1400).toFixed(2);
        if (sums && ch === channels[0]) sums[i] = (sums[i] ?? 0) + Number(v);
        buf += `            <E>\r\n                <V>${v}</V>\r\n                <F2>W</F2>\r\n            </E>\r\n`;
        filePoints++;
        // Elérte a célméretet → zárjuk a blokkot és a fájlt; a következő intervallum új fájlban új blokkot nyit.
        if (buf.length + dataFoot.length + footer.length >= targetBytes) {
          buf += dataFoot;
          blockOpen = false;
          flush();
        }
      }
      if (blockOpen) buf += dataFoot;
    }
  }
  flush();
  if (!files.length) files.push({ content: header + footer, points: 0 });
  return files;
}

// Inverter gyártói törzsadat – a LAPOS `devices` formátum, amit az
// inverter-controller/receiveMasterDataFromManufacturer (POST /api/v1.1/inverter-brand/master-data) vár.
// Nincs pod/podContracts/dataChannels: az inverter-ESZKÖZT regisztrálja (a POD-ot a serialNumber hordozza).
// A párosítás (pod↔eszköz) külön, RabbitMQ `pod-registry.inverter-pod-data` üzenettel megy.
// A cím a feltöltött SZINKRON forrássorából (srcRows) jön, ha van – különben a beépített teszt-cím.
function buildInverterMasterData(pods: string[], spec: InverterSpec, srcRows?: (SzinkronSource | undefined)[]): string {
  const devices = pods.map((p, idx) => {
    const src = srcRows?.[idx];
    const st = splitStreet(src?.['UTCA'] ?? '');
    return {
    serialNumber: `${p}_INV`,
    address: {
      zipCode: src?.['IR_SZAM'] || '1011',
      city: src?.['VAROS'] || 'Budapest',
      street: st.street || 'Teszt',
      streetType: st.streetType || 'allé',
      streetCode: String(idx + 1),
      building: src?.['HAZSZAM'] || '2',
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
    };
  });
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
// `src` = a feltöltött SZINKRON forrássora (ha van): ebből megy a CÍM a párosításba is, hogy a
// registry-ben ugyanaz a cím szerepeljen, mint a SZINKRON-ban. Nélküle a beépített teszt-cím.
function inverterPairingObj(pod: string, spec: InverterSpec, idx: number, pocOverride?: string, src?: Record<string, string>) {
  const install = spec.installationDate;
  const st = splitStreet(src?.['UTCA'] ?? '');
  return {
    pod,
    // A POC-szám = a SZINKRON FOGYHELY_AZON-ja → ez a POD PocNo-ja a registry-ben. E nélkül (null) a
    // párosítás nem társítja a mérési helyet. Importált SZINKRON-nál a fájl valódi FOGYHELY_AZON-ja (pocOverride),
    // egyébként a számított érték (199700000 + sorszám).
    poc: pocOverride || fogyhelyAzon(idx + 1),
    customerMail: spec.customerMail,
    utilityType: 'electricity',
    address: {
      zipCode: src?.['IR_SZAM'] || '1011',
      city: src?.['VAROS'] || 'Budapest',
      street: st.street || 'Teszt',
      streetType: st.streetType || 'allé',
      streetCode: String(idx + 1),
      building: src?.['HAZSZAM'] || '2',
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
function buildInverterPairing(pod: string, spec: InverterSpec, idx: number, pocOverride?: string, src?: Record<string, string>): string {
  return JSON.stringify({ podContracts: [inverterPairingObj(pod, spec, idx, pocOverride, src)] });
}

// MINDEN POD párosítása egyetlen { podContracts: [ … ] } üzenetben (a „sum" kimenethez) – tömör.
function buildInverterPairingAll(pods: string[], spec: InverterSpec, pocs?: string[], srcRows?: (SzinkronSource | undefined)[]): string {
  return JSON.stringify({ podContracts: pods.map((p, idx) => inverterPairingObj(p, spec, idx, pocs?.[idx], srcRows?.[idx])) });
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
  mavirChannels: MavirChannel[] = ['A+'], // MAVIR mérés csatornái: [A+] vagy [A+, A-] (POD-onként külön blokk)
  // Importált SZINKRON esetén a POD-onkénti FORRÁSSOR: ebből megy a cím/ügyfél/tarifa a generált
  // SZINKRON-ba ÉS a párosítás címébe – így a kimenet a MINTÁT követi, nem a beépített teszt-adatokat.
  srcRows?: (SzinkronSource | undefined)[],
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
    // A fájlnév 3. mezője a KERESKEDŐ EIC-je – a követelmény szerint a [Kereskedo] oszlopnak ezzel
    // EGYEZNIE kell (a [Merlegkor_Felelos] alapértelmezésben szintén ez). A [Ford_Nap] pedig a
    // fájlnév Datum1 (szelekciós dátum) mezője.
    const kereskedo = fileSafePartner(mkf);
    const fordNap = ymdDots(from);
    // Feltöltött SZINKRON-nál a forrássor mezőivel (cím, ügyfél, tarifák), egyébként a beépített mintasorral.
    const lines = [HEADER, ...pods.map((p, k) => {
      const src = srcRows?.[k];
      return src
        ? szinkronRowFromSource(src, p, k + 1, mkf, kereskedo, fordNap, pocs?.[k])
        : szinkronRow(p, k + 1, mkf, kereskedo, fordNap, pocs?.[k]);
    })];
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
    // ~0,5 MB-os, ÖNÁLLÓAN érvényes EDW_XML részekre bontva – így a file-processor Kafka-üzenete
    // (serial-ts topic) a ~1 MB limit alatt marad, és minden rész külön letölthető.
    const parts = buildMavirParts(pods, from, now, now, mavirChannels, sums);
    const n = parts.length;
    // Minden rész ÖNÁLLÓ, SZABÁLYOS MAVIR fájlnevet kap (NEM partXofY: azt a fájlnév-parser elutasítja –
    // dsoId/merlegkör/dátum mezők null-ra jönnének → INVALID_FORMAT_CANNOT_PROCESS); a nevek mp-enként egyediek.
    const names = mavirFileNames(pods, mkf, n);
    parts.forEach((pf, pi) => {
      points += pf.points;
      files.push({
        name: names[pi],
        content: pf.content,
        mime: 'text/xml',
        target: 'sftp',
        hint: n > 1
          ? `MAVIR mérés (${pi + 1}/${n} rész, ~0,5 MB/fájl) – töltsd fel az SFTP-re`
          : 'MAVIR mérés – töltsd fel az SFTP-re',
        meta: `~${Math.round(pf.content.length / 1024)} KB · ${pf.points} pont`,
      });
    });
    onProgress?.(0.9);
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
      content: buildInverterMasterData(pods, invSpec, srcRows),
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
        content: buildInverterPairing(p, invSpec, idx, pocs?.[idx], srcRows?.[idx]),
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
        content: buildInverterPairingAll(pods, invSpec, pocs, srcRows),
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
