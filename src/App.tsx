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
import { getCookie, setCookie } from './lib/cookies';
import { Icon, type IconName } from './Icons';
import './App.css';

const APP_VERSION = 'v1.0.0';

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
    () => (name.trim() ? `Üdv, ${name.trim()}!` : 'POD-ok, mérés és inverter generálása'),
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
        <aside className="sidebar">
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
                <span className="nav-ic"><Icon name={n.icon} size={18} /></span> {n.label}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <button className="ghost block" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
              {theme === 'dark' ? 'Világos téma' : 'Sötét téma'}
            </button>
            <div className="version">{APP_VERSION}</div>
          </div>
        </aside>

        <main className="content">
          {view === 'generate' && (
            <>
              <header className="page-head">
                <h1>ENAP - KEP adatgenerátor</h1>
                <p>{greeting}</p>
              </header>

              <section className="card">
                <h2>Mit generáljunk?</h2>
                <p className="desc">
                  Add meg a POD-ok számát, a DSO-t és a mérés kezdetét, majd pipáld ki, mire van szükséged. A
                  kipipált fájlok mind UGYANARRA a POD-készletre készülnek; a mérés a kezdettől a MOSTANI időig (a
                  géped órája) 15 perces felbontással.
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
                          <button className="primary sm" onClick={() => download(f)}><Icon name="download" size={15} /> Letöltés</button>
                          <a className="ghost sm" href={targetUrl(f.target)} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> {targetLabel(f.target)}</a>
                        </div>
                      </div>
                    ))}
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
