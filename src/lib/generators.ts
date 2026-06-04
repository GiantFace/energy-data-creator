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
  content: string;
  mime: string;
  target: 'sftp' | 'swagger';
  hint: string;
  meta: string;
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

// 33 karakteres szintetikus POD; az előtag a DSO-ból jön (EHE000120 -> HU000120…).
function pod(i: number, dso: string): string {
  const num = dso.toUpperCase().startsWith('EHE') ? dso.slice(3) : dso;
  const s = 'HU' + num + 'SYN' + String(i).padStart(5, '0');
  return (s + '0'.repeat(33)).slice(0, 33);
}

// Az inverter (HMKE) eszköz fix adatcsatornái a master-data formátumhoz.
const INVERTER_CHANNELS: { obisCode: string; dataChannelName: string; unit: string }[] = [
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

function szinkronRow(i: number, dso: string): string {
  const p = pod(i, dso);
  const fogyhely = String(199700000 + i);
  return [
    '2024.09.01', '2040.12.31', dso, TRADER, BALANCE_EIC, p, fogyhely,
    '0.0', 'IDOS', '2026.05.01', '10.01', '10.01', 'Teszt', `Ugyfel${i}`, 'Teszt utca', String(i),
    'Budapest', '1011', 'K', 'KOF', 'VIZUGY', 'KOF_A_KIF_T', '60,0000000', '1',
    '2023.01.09', '2021.03.01', '1+0', 'HMKE-02', '001', '1.0', '2025.08.01', '2025.08.01',
  ].join('|');
}

function buildMavirXml(pods: string[], from: Date, end: Date, generated: Date): { xml: string; points: number } {
  let sb = "<?xml version='1.0' encoding='UTF-8'?>\r\n";
  sb += '<EDW_XML xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://tempuri.org/MAVIR">\r\n';
  sb += '    <HEADER>\r\n        <VERSION>1.0</VERSION>\r\n        <GENERATOR>WM_XML_Generator</GENERATOR>\r\n';
  sb += `        <GENERATED-DATETIME>${isoLocal(generated)}</GENERATED-DATETIME>\r\n    </HEADER>\r\n`;
  let points = 0;
  for (const p of pods) {
    sb += '    <DATA>\r\n';
    sb += `        <LOC-KEY>${p}</LOC-KEY>\r\n`;
    sb += '        <CHANNEL-NAME>A+</CHANNEL-NAME>\r\n';
    sb += `        <VALUE-NAME>${MEAS_OBIS}</VALUE-NAME>\r\n`;
    sb += '        <VALUE-UNIT>kwh</VALUE-UNIT>\r\n        <T-FACTOR>1</T-FACTOR>\r\n        <INTERVAL>00:15:00</INTERVAL>\r\n';
    sb += '        <BLOCK>\r\n';
    sb += `            <START-DATETIME>${isoLocal(from)}</START-DATETIME>\r\n`;
    for (let t = from.getTime(); t < end.getTime(); t += 15 * 60_000) {
      const v = (100 + Math.random() * 1400).toFixed(2);
      sb += `            <E>\r\n                <V>${v}</V>\r\n                <F2>W</F2>\r\n            </E>\r\n`;
      points++;
    }
    sb += '        </BLOCK>\r\n    </DATA>\r\n';
  }
  sb += '</EDW_XML>';
  return { xml: sb, points };
}

// Inverter párosítás – a master-data (podContracts) formátum, amit a dso-controller elfogad.
// A POD-hoz egy 'meter' funkciójú eszköz az inverter brand/model/teljesítmény adataival és
// a 10 fix HMKE adatcsatornával.
function buildInverterJson(pods: string[], dso: string, spec: InverterSpec): string {
  const install = spec.installationDate;
  const podContracts = pods.map((p, idx) => ({
    pod: p,
    utilityType: 'electricity',
    dsoNo: dso,
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
          function: 'meter',
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

// Közös generálás: a kipipált kimenetek, mind ugyanarra a POD-készletre.
export function generateBundle(
  count: number,
  dso: string,
  from: Date,
  outputs: Outputs,
  invSpec: InverterSpec,
): BundleResult {
  count = Math.max(1, Math.floor(count));
  let { szinkron, meres, inverter } = outputs;
  if (!szinkron && !meres && !inverter) { szinkron = true; meres = true; }

  const now = new Date();
  if (from.getTime() >= now.getTime()) from = new Date(now.getTime() - 24 * 3600_000);

  const pods = Array.from({ length: count }, (_, k) => pod(k + 1, dso));
  const files: GeneratedFile[] = [];
  let points = 0;
  let invDevices = 0;

  // Közös, egyedi időbélyeg az egész generáláshoz (minden fájl neve ezzel egyedi).
  const suffix = uniqueSuffix(now);

  if (szinkron) {
    const lines = [HEADER, ...Array.from({ length: count }, (_, k) => szinkronRow(k + 1, dso))];
    files.push({
      name: `Szinkron_${dso}_${TRADER}_${suffix}.csv`,
      content: lines.join('\r\n') + '\r\n',
      mime: 'text/csv',
      target: 'sftp',
      hint: 'SZINKRON törzsadat – töltsd fel az SFTP-re',
      meta: `${count} POD`,
    });
  }

  if (meres) {
    const { xml, points: pts } = buildMavirXml(pods, from, now, now);
    points = pts;
    files.push({
      name: `${dso}_${TRADER}_Eseti_FF_EGYEDI1_${suffix}.xml`,
      content: xml,
      mime: 'text/xml',
      target: 'sftp',
      hint: 'MAVIR mérés – töltsd fel az SFTP-re',
      meta: `${count} POD, ${pts} pont`,
    });
  }

  if (inverter) {
    invDevices = count;
    files.push({
      name: `inverter_master-data_${suffix}.json`,
      content: buildInverterJson(pods, dso, invSpec),
      mime: 'application/json',
      target: 'swagger',
      hint: 'Inverter párosítás – másold a Swagger (congestMasterData) request body-ba',
      meta: `${count} POD, ${INVERTER_CHANNELS.length} HMKE csatorna`,
    });
  }

  return { pods: count, points, invDevices, files };
}
