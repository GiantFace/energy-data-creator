import { useEffect, useMemo, useState } from 'react';
import logo from './assets/logo.webp';
import DotField from './DotField';
import {
  BRANDS,
  DSOS,
  generateBundle,
  type GeneratedFile,
  type InverterSpec,
} from './lib/generators';
import './App.css';

const DEFAULT_SFTP = 'https://sftp.uat.enap.oci/web/client/files';
const DEFAULT_SWAGGER =
  'https://device-data-receiver.uat.enap.oci/swagger/swagger-ui/index.html#/dso-controller/congestMasterData';

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return toInput(d); };
const today = () => toInput(new Date());

function download(file: GeneratedFile) {
  const blob = new Blob([file.content], { type: file.mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useStored(key: string, initial: string) {
  const [v, setV] = useState(() => localStorage.getItem(key) ?? initial);
  useEffect(() => { localStorage.setItem(key, v); }, [key, v]);
  return [v, setV] as const;
}

export default function App() {
  const [theme, setTheme] = useStored('theme', 'light');
  const [name, setName] = useStored('name', '');
  const [sftpUrl, setSftpUrl] = useStored('sftpUrl', DEFAULT_SFTP);
  const [swaggerUrl, setSwaggerUrl] = useStored('swaggerUrl', DEFAULT_SWAGGER);

  const [count, setCount] = useState('5');
  const [dso, setDso] = useState('EHE000210');
  const [from, setFrom] = useState(yesterday());
  const [szinkron, setSzinkron] = useState(true);
  const [meres, setMeres] = useState(true);
  const [inverter, setInverter] = useState(false);

  const [brand, setBrand] = useState('BYD');
  const [model, setModel] = useState('Power-Box SH3K');
  const [power, setPower] = useState('3000');
  const [vmin, setVmin] = useState('100');
  const [vmax, setVmax] = useState('380');
  const [invDate, setInvDate] = useState(today());

  const [files, setFiles] = useState<GeneratedFile[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const greeting = useMemo(
    () => (name.trim() ? `Üdv, ${name.trim()}! 👋` : 'POD-ok, mérés és inverter generálása'),
    [name],
  );

  function onGenerate() {
    setError('');
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n < 1) { setError('Adj meg egy pozitív POD-darabszámot.'); return; }
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
    const res = generateBundle(n, dso, fromDate, { szinkron, meres, inverter }, spec);
    setFiles(res.files);
  }

  const targetLabel = (t: string) => (t === 'swagger' ? 'Swagger UI' : 'SFTP web kliens');
  const targetUrl = (t: string) => (t === 'swagger' ? swaggerUrl : sftpUrl);

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
      <div className="app">
        <header className="topbar">
        <img className="logo" src={logo} alt="FEAK" />
        <div className="titles">
          <h1>ENAP - KEP adatgenerátor</h1>
          <p>{greeting}</p>
        </div>
        <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀  Világos' : '🌙  Sötét'}
        </button>
      </header>

      <main className="content">
        <section className="card">
          <h2>Mit generáljunk?</h2>
          <p className="desc">
            Add meg a POD-ok számát, a DSO-t és a mérés kezdetét, majd pipáld ki, mire van szükséged. A kipipált
            fájlok mind UGYANARRA a POD-készletre készülnek; a mérés a kezdettől a MOSTANI időig (a géped órája) 15
            perces felbontással.
          </p>

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
              <span>Mérés kezdete</span>
              <input type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} />
            </label>
          </div>
          <p className="hint">Eddig: a mérés vége mindig a mostani idő (automatikus).</p>

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
            <p className="desc">A pod-registry-db DeviceTypes táblából. A serialNumber = POD + _INV.</p>
            <div className="grid3">
              <label>
                <span>Gyártó (brand)</span>
                <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                  {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <label><span>Modell</span><input value={model} onChange={(e) => setModel(e.target.value)} /></label>
              <label><span>Telepítés dátuma</span><input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></label>
              <label><span>nominalPower</span><input type="number" value={power} onChange={(e) => setPower(e.target.value)} /></label>
              <label><span>acVoltageMin</span><input type="number" value={vmin} onChange={(e) => setVmin(e.target.value)} /></label>
              <label><span>acVoltageMax</span><input type="number" value={vmax} onChange={(e) => setVmax(e.target.value)} /></label>
            </div>
          </section>
        )}

        {files && files.length > 0 && (
          <section className="card">
            <h2>Generált fájlok</h2>
            <p className="desc">A bal oldalon a fájl (töltsd le), a jobb oldalon a felület, ahova be kell tölteni.</p>
            <div className="results">
              {files.map((f) => (
                <div className="result-row" key={f.name}>
                  <div className="rfile">
                    <div className="rname">{f.name}</div>
                    <div className="rhint">{f.hint} · {f.meta}</div>
                  </div>
                  <div className="ractions">
                    <button className="primary sm" onClick={() => download(f)}>⬇ Letöltés</button>
                    <a className="ghost sm" href={targetUrl(f.target)} target="_blank" rel="noreferrer">↗ {targetLabel(f.target)}</a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card">
          <h2>Beállítások</h2>
          <div className="grid2">
            <label><span>Megszólítás (név)</span><input value={name} placeholder="pl. Ferenc" onChange={(e) => setName(e.target.value)} /></label>
            <span />
            <label><span>SFTP web kliens (SZINKRON / MAVIR)</span><input value={sftpUrl} onChange={(e) => setSftpUrl(e.target.value)} /></label>
            <label><span>Swagger UI (inverter)</span><input value={swaggerUrl} onChange={(e) => setSwaggerUrl(e.target.value)} /></label>
          </div>
        </section>

        <footer className="foot">
          A generálás teljesen a böngésződben fut – semmi nem kerül szerverre. A fájlokat te töltöd fel az SFTP-re,
          illetve illeszted a Swagger UI-ba.
        </footer>
      </main>
      </div>
    </>
  );
}
