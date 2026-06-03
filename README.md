# ENAP - KEP adatgenerátor (web)

React + Vite + TypeScript webapp, ami a böngészőben generálja a beküldendő fájlokat:

- **SZINKRON törzsadat** (pipe-elválasztott CSV) → SFTP
- **MAVIR mérés** (EDW_XML, `WM_XML_Generator` formátum) → SFTP
- **Inverter hozzárendelés** (inverter-brand/master-data JSON, `serialNumber = POD + _INV`) → Swagger UI

Egy közös felület: megadod a **POD-ok számát**, a **DSO-t** és a **mérés kezdetét**, kipipálod a kívánt
kimeneteket, és minden **ugyanarra a POD-készletre** készül. A mérés a kezdettől a **mostani időig**
(a géped órája) 15 perces felbontással. A POD-prefix a DSO-ból jön (pl. `EHE000120 → HU000120…`).

> A generálás **teljesen a böngészőben** fut – semmilyen adat nem kerül szerverre. A fájlokat letöltöd,
> majd te töltöd fel az SFTP-re / illeszted a Swagger request body-ba (a felületek linkjei beépítve,
> a Beállításoknál szerkeszthetők).

## Fejlesztés

```bash
npm install
npm run dev      # fejlesztői szerver (http://localhost:5173)
npm run build    # éles build a dist/ mappába
npm run preview  # az éles build kiszolgálása
```

## Telepítés Vercelre

**A) Git + Vercel (ajánlott):**
1. Tölts fel egy Git-repót (GitHub/GitLab/Bitbucket) ezzel a tartalommal.
2. A Vercelen *New Project* → importáld a repót. A Vercel automatikusan felismeri (Vite):
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. Deploy. Minden `git push` után automatikusan újra-deployol.

**B) Vercel CLI:**
```bash
npm i -g vercel
vercel            # első alkalommal bejelentkezés + projekt létrehozás
vercel --prod     # éles deploy
```

A `vercel.json` már be van állítva (Vite, `dist`).

## Felépítés

- `src/lib/generators.ts` – a generátorok (SZINKRON CSV, MAVIR XML, inverter JSON), DSO- és gyártólisták.
- `src/App.tsx` – a felület (közös panel, legördülők, dátumválasztó, checkboxok, eredmény-letöltés, téma).
- `src/App.css` – témázható (világos/sötét) stílus.
