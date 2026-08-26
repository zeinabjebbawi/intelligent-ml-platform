import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTheme } from '../theme'
import TopNav from '../components/TopNav'

const shadow = '0 4px 24px rgba(0,0,0,0.10)'
const shadow2 = '0 1px 4px rgba(0,0,0,0.08)'
const btn = (bg, color = 'white', extra = {}) => ({
  padding: '9px 20px', borderRadius: 10, border: 'none',
  background: bg, color, fontWeight: 700, fontSize: 13,
  cursor: 'pointer', transition: 'all 0.2s', ...extra,
})

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSING (client-only — no backend call, mirrors the drawer spec's
// "frontend only, no API call needed" instruction for detection logic)
// ─────────────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return { columns: [], rows: [] }

  const columns = rows[0].map(c => c.trim())
  const dataRows = rows.slice(1).filter(r => r.length === columns.length)
  const parsed = dataRows.map(r => {
    const obj = {}
    columns.forEach((col, i) => {
      const raw = (r[i] ?? '').trim()
      if (raw === '') { obj[col] = null; return }
      const num = Number(raw)
      obj[col] = (raw !== '' && !isNaN(num)) ? num : raw
    })
    return obj
  })
  return { columns, rows: parsed }
}

function analyzeColumns(columns, rows) {
  const info = {}
  columns.forEach(col => {
    const values = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '')
    const missing = rows.length - values.length
    const uniqueSet = new Set(values)
    const isNumeric = values.length > 0 && values.every(v => typeof v === 'number')
    const type = !isNumeric ? 'categorical' : (uniqueSet.size === 2 ? 'binary' : 'numerical')
    info[col] = {
      type, isNumeric, missing,
      missingPct: rows.length ? +(missing / rows.length * 100).toFixed(1) : 0,
      unique: uniqueSet.size,
    }
  })
  return info
}

const TARGET_HINTS = ['target', 'label', 'class', 'outcome', 'diagnosis', 'species', 'medv', 'y']
function suggestTarget(columns, columnsInfo) {
  const hinted = columns.find(c => TARGET_HINTS.some(h => c.toLowerCase().includes(h)))
  if (hinted) return hinted
  // Fallback: prefer the last low-cardinality column (reads like a label);
  // otherwise just the last column — same "some default beats none" logic
  // used elsewhere in this platform (e.g. cleaning_router_v2's method defaults).
  const lowCard = [...columns].reverse().find(c => columnsInfo[c] && columnsInfo[c].unique <= 20)
  return lowCard || columns[columns.length - 1]
}

// Level-2 rule-based estimate (Global Rule 1) derived purely from this page's
// own data (Global Rule 2 — no reaching into Diagnose/Training results).
function computeTaskConfidence(rows, columnsInfo, target) {
  const info = columnsInfo[target]
  if (!info || !rows.length) return { classification: 50, regression: 50 }
  const uniqueRatio = info.unique / rows.length
  if (!info.isNumeric) {
    return {
      classification: 96,
      regression: Math.round(Math.max(2, Math.min(25, uniqueRatio * 40))),
    }
  }
  return {
    classification: Math.round(Math.max(4, Math.min(96, (1 - uniqueRatio) * 100))),
    regression: Math.round(Math.max(4, Math.min(96, uniqueRatio * 140))),
  }
}

// Deliberately smaller than Diagnose's full health score (Global Rule 2:
// this page must not pre-empt that stage) but still needs to react to more
// than just missingness — a dataset with zero missing values but full of
// duplicate rows or extreme outliers isn't actually a clean 100. Three
// lightweight factors, same spirit as Diagnose's fuller formula: completeness,
// duplicate rows, and IQR-based outlier density.
function computeMiniHealth(rows, columns, columnsInfo) {
  if (!rows.length || !columns.length) return 100

  const totalCells = rows.length * columns.length
  const totalMissing = columns.reduce((s, c) => s + (columnsInfo[c]?.missing || 0), 0)
  const missingPct = (totalMissing / totalCells) * 100
  const completeness = 100 - missingPct * 3

  const seen = new Set()
  let dupCount = 0
  rows.forEach(r => {
    const key = JSON.stringify(columns.map(c => r[c]))
    if (seen.has(key)) dupCount++; else seen.add(key)
  })
  const dupScore = 100 - (dupCount / rows.length) * 100 * 3

  const numericCols = columns.filter(c => columnsInfo[c]?.type === 'numerical')
  let totalOutliers = 0
  numericCols.forEach(col => {
    const vals = rows.map(r => r[col]).filter(v => typeof v === 'number').sort((a, b) => a - b)
    if (vals.length < 4) return
    const q = (p) => {
      const pos = (vals.length - 1) * p, base = Math.floor(pos), rest = pos - base
      return vals[base + 1] !== undefined ? vals[base] + rest * (vals[base + 1] - vals[base]) : vals[base]
    }
    const Q1 = q(0.25), Q3 = q(0.75), IQR = Q3 - Q1
    const lower = Q1 - 1.5 * IQR, upper = Q3 + 1.5 * IQR
    totalOutliers += vals.filter(v => v < lower || v > upper).length
  })
  const outlierScore = 100 - Math.min(100, (totalOutliers / (rows.length * (numericCols.length || 1))) * 1000)

  return Math.round(Math.max(0, Math.min(100, completeness * 0.5 + dupScore * 0.25 + outlierScore * 0.25)))
}

function detectTaskType(col, rows) {
  const values = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '')
  const uniqueCount = new Set(values).size
  const sample = values[0]
  const isNumeric = typeof sample === 'number'
  if (!isNumeric) return 'classification'
  if (uniqueCount <= 10) return 'classification'
  return 'regression'
}

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─────────────────────────────────────────────────────────────────────────────
// SEEDED SYNTHETIC REFERENCE DATASETS — generated, not literal copies of the
// real UCI files. Column schemas and row counts match the well-known classic
// datasets (150 iris / 768 diabetes / 506 housing / 569 cancer) so the gallery
// behaves like the real thing, but the actual values are procedurally
// generated with a seeded RNG (reproducible across reloads, same spirit as
// random_state=42 throughout ml-core) rather than embedded literal data.
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gaussianFactory(rng) {
  let spare = null
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v }
    let u, v, s
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v } while (s >= 1 || s === 0)
    const mul = Math.sqrt(-2 * Math.log(s) / s)
    spare = v * mul
    return u * mul
  }
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
const clampRound = (v, d = 1) => +v.toFixed(d)

function genIris() {
  const rng = mulberry32(42), g = gaussianFactory(rng)
  const species = ['setosa', 'versicolor', 'virginica']
  const params = {
    setosa:     { sl: [5.0, 0.35], sw: [3.4, 0.38], pl: [1.5, 0.17], pw: [0.25, 0.10] },
    versicolor: { sl: [5.9, 0.51], sw: [2.8, 0.31], pl: [4.3, 0.47], pw: [1.3, 0.20] },
    virginica:  { sl: [6.6, 0.64], sw: [3.0, 0.32], pl: [5.6, 0.55], pw: [2.0, 0.27] },
  }
  const rows = []
  species.forEach(sp => {
    const p = params[sp]
    for (let i = 0; i < 50; i++) {
      rows.push({
        SepalLength: clampRound(Math.max(4.0, p.sl[0] + g() * p.sl[1])),
        SepalWidth:  clampRound(Math.max(2.0, p.sw[0] + g() * p.sw[1])),
        PetalLength: clampRound(Math.max(1.0, p.pl[0] + g() * p.pl[1])),
        PetalWidth:  clampRound(Math.max(0.1, p.pw[0] + g() * p.pw[1])),
        species: sp,
      })
    }
  })
  return { columns: ['SepalLength', 'SepalWidth', 'PetalLength', 'PetalWidth', 'species'], rows: shuffle(rows, rng) }
}

function genDiabetes() {
  const rng = mulberry32(7), g = gaussianFactory(rng)
  const rows = []
  for (let i = 0; i < 768; i++) {
    const positive = rng() < 0.349
    const shift = positive ? 1 : 0
    rows.push({
      Pregnancies: Math.max(0, Math.round(3 + shift * 1.5 + g() * 2.5)),
      Glucose: Math.max(60, Math.round(110 + shift * 35 + g() * 22)),
      BloodPressure: Math.max(40, Math.round(69 + shift * 3 + g() * 12)),
      SkinThickness: Math.max(0, Math.round(20 + shift * 4 + g() * 10)),
      Insulin: Math.max(0, Math.round(80 + shift * 40 + g() * 90)),
      BMI: clampRound(Math.max(15, 30 + shift * 4 + g() * 6.5)),
      DiabetesPedigreeFunction: clampRound(Math.max(0.08, 0.47 + shift * 0.15 + g() * 0.22), 3),
      Age: Math.max(21, Math.round(31 + shift * 6 + g() * 10)),
      Outcome: positive ? 1 : 0,
    })
  }
  return {
    columns: ['Pregnancies', 'Glucose', 'BloodPressure', 'SkinThickness', 'Insulin', 'BMI', 'DiabetesPedigreeFunction', 'Age', 'Outcome'],
    rows,
  }
}

function genHousing() {
  const rng = mulberry32(13), g = gaussianFactory(rng)
  const rows = []
  for (let i = 0; i < 506; i++) {
    const rm = clampRound(Math.max(3.5, 6.28 + g() * 0.7), 3)
    const lstat = clampRound(Math.max(1, 12.6 + g() * 7), 2)
    const medv = clampRound(Math.max(5, Math.min(50, 22.5 + (rm - 6.28) * 8 - (lstat - 12.6) * 0.6 + g() * 3)), 1)
    rows.push({
      CRIM: clampRound(Math.max(0.006, Math.abs(3.6 + g() * 8)), 4),
      ZN: Math.max(0, Math.round(rng() < 0.6 ? 0 : rng() * 90)),
      INDUS: clampRound(Math.max(0.5, 11 + g() * 6.8), 2),
      CHAS: rng() < 0.07 ? 1 : 0,
      NOX: clampRound(Math.max(0.35, 0.55 + g() * 0.11), 3),
      RM: rm,
      AGE: clampRound(Math.max(2, Math.min(100, 68.6 + g() * 28)), 1),
      DIS: clampRound(Math.max(1, 3.8 + g() * 2.1), 4),
      RAD: Math.max(1, Math.round(9.5 + g() * 8.6)),
      TAX: Math.round(Math.max(180, 408 + g() * 168)),
      PTRATIO: clampRound(Math.max(12, 18.5 + g() * 2.2), 1),
      B: clampRound(Math.max(0, Math.min(396.9, 356.6 + g() * 90)), 2),
      LSTAT: lstat,
      MEDV: medv,
    })
  }
  return {
    columns: ['CRIM', 'ZN', 'INDUS', 'CHAS', 'NOX', 'RM', 'AGE', 'DIS', 'RAD', 'TAX', 'PTRATIO', 'B', 'LSTAT', 'MEDV'],
    rows,
  }
}

function genCancer() {
  const rng = mulberry32(21), g = gaussianFactory(rng)
  const rows = []
  for (let i = 0; i < 569; i++) {
    const malignant = rng() < 0.373
    const shift = malignant ? 1 : 0
    rows.push({
      radius_mean: clampRound(Math.max(6, 12.1 + shift * 5.5 + g() * 2.0), 2),
      texture_mean: clampRound(Math.max(9, 18.9 + shift * 2.5 + g() * 3.8), 2),
      perimeter_mean: clampRound(Math.max(40, 78 + shift * 38 + g() * 14), 2),
      area_mean: Math.round(Math.max(140, 460 + shift * 620 + g() * 210)),
      smoothness_mean: clampRound(Math.max(0.05, 0.096 + shift * 0.006 + g() * 0.012), 4),
      compactness_mean: clampRound(Math.max(0.02, 0.104 + shift * 0.06 + g() * 0.04), 4),
      concavity_mean: clampRound(Math.max(0, 0.089 + shift * 0.11 + g() * 0.06), 4),
      symmetry_mean: clampRound(Math.max(0.1, 0.181 + shift * 0.015 + g() * 0.022), 4),
      diagnosis: malignant ? 'M' : 'B',
    })
  }
  return {
    columns: ['radius_mean', 'texture_mean', 'perimeter_mean', 'area_mean', 'smoothness_mean', 'compactness_mean', 'concavity_mean', 'symmetry_mean', 'diagnosis'],
    rows,
  }
}

// weather.nominal / weather.numeric are the canonical 14-row Quinlan
// "play tennis" teaching dataset (public-domain, used in every ID3/C4.5
// textbook example, bundled with WEKA's sample data) — small and exact
// enough to reproduce verbatim rather than approximate with a generator.
function genWeatherNominal() {
  const columns = ['outlook', 'temperature', 'humidity', 'windy', 'play']
  const data = [
    ['sunny', 'hot', 'high', 'FALSE', 'no'], ['sunny', 'hot', 'high', 'TRUE', 'no'],
    ['overcast', 'hot', 'high', 'FALSE', 'yes'], ['rainy', 'mild', 'high', 'FALSE', 'yes'],
    ['rainy', 'cool', 'normal', 'FALSE', 'yes'], ['rainy', 'cool', 'normal', 'TRUE', 'no'],
    ['overcast', 'cool', 'normal', 'TRUE', 'yes'], ['sunny', 'mild', 'high', 'FALSE', 'no'],
    ['sunny', 'cool', 'normal', 'FALSE', 'yes'], ['rainy', 'mild', 'normal', 'FALSE', 'yes'],
    ['sunny', 'mild', 'normal', 'TRUE', 'yes'], ['overcast', 'mild', 'high', 'TRUE', 'yes'],
    ['overcast', 'hot', 'normal', 'FALSE', 'yes'], ['rainy', 'mild', 'high', 'TRUE', 'no'],
  ]
  return { columns, rows: data.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]]))) }
}
function genWeatherNumeric() {
  const columns = ['outlook', 'temperature', 'humidity', 'windy', 'play']
  const data = [
    ['sunny', 85, 85, 'FALSE', 'no'], ['sunny', 80, 90, 'TRUE', 'no'],
    ['overcast', 83, 86, 'FALSE', 'yes'], ['rainy', 70, 96, 'FALSE', 'yes'],
    ['rainy', 68, 80, 'FALSE', 'yes'], ['rainy', 65, 70, 'TRUE', 'no'],
    ['overcast', 64, 65, 'TRUE', 'yes'], ['sunny', 72, 95, 'FALSE', 'no'],
    ['sunny', 69, 70, 'FALSE', 'yes'], ['rainy', 75, 80, 'FALSE', 'yes'],
    ['sunny', 75, 70, 'TRUE', 'yes'], ['overcast', 72, 90, 'TRUE', 'yes'],
    ['overcast', 81, 75, 'FALSE', 'yes'], ['rainy', 71, 91, 'TRUE', 'no'],
  ]
  return { columns, rows: data.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]]))) }
}

function genGlass() {
  const rng = mulberry32(35), g = gaussianFactory(rng)
  const types = ['1', '2', '3', '5', '6', '7']
  const weights = [0.33, 0.36, 0.08, 0.06, 0.04, 0.13] // realistically imbalanced, like the real dataset
  const rows = []
  for (let i = 0; i < 214; i++) {
    const r = rng()
    let acc = 0, type = types[0]
    for (let k = 0; k < types.length; k++) { acc += weights[k]; if (r < acc) { type = types[k]; break } }
    const shift = type === '7' ? 1 : 0 // headlamp glass tends to run higher Ba
    rows.push({
      RI: clampRound(Math.max(1.51, 1.518 + g() * 0.003), 5),
      Na: clampRound(Math.max(10, 13.4 + g() * 0.8), 2),
      Mg: clampRound(Math.max(0, 2.7 + g() * 1.4), 2),
      Al: clampRound(Math.max(0.3, 1.4 + g() * 0.5), 2),
      Si: clampRound(Math.max(69, 72.6 + g() * 0.8), 2),
      K: clampRound(Math.max(0, 0.5 + g() * 0.3), 2),
      Ca: clampRound(Math.max(5, 8.9 + g() * 1.4), 2),
      Ba: clampRound(Math.max(0, shift * 1.4 + Math.abs(g()) * 0.3), 2),
      Fe: clampRound(Math.max(0, 0.06 + Math.abs(g()) * 0.08), 3),
      Type: type,
    })
  }
  // a handful of exact duplicate measurements, same realism note as sample.csv elsewhere in this project
  rows.push({ ...rows[10] }, { ...rows[40] })
  return { columns: ['RI', 'Na', 'Mg', 'Al', 'Si', 'K', 'Ca', 'Ba', 'Fe', 'Type'], rows }
}

function genCpu() {
  const rng = mulberry32(51), g = gaussianFactory(rng)
  const rows = []
  for (let i = 0; i < 209; i++) {
    const myct = Math.max(17, Math.round(200 + Math.abs(g()) * 250))
    const mmin = Math.max(64, Math.round(2000 + Math.abs(g()) * 12000))
    const mmax = mmin + Math.max(0, Math.round(Math.abs(g()) * 20000))
    const cach = Math.max(0, Math.round(Math.abs(g()) * 128))
    const chmin = Math.max(0, Math.round(Math.abs(g()) * 24))
    const chmax = chmin + Math.max(0, Math.round(Math.abs(g()) * 32))
    // published relative performance — roughly follows memory + cache, inversely follows cycle time
    const prp = Math.max(6, Math.round(mmax / 400 + cach * 1.8 + chmax * 1.2 - myct / 8 + g() * 15))
    rows.push({ MYCT: myct, MMIN: mmin, MMAX: mmax, CACH: cach, CHMIN: chmin, CHMAX: chmax, PRP: prp })
  }
  return { columns: ['MYCT', 'MMIN', 'MMAX', 'CACH', 'CHMIN', 'CHMAX', 'PRP'], rows }
}

function genAirline() {
  const rng = mulberry32(64), g = gaussianFactory(rng)
  const carriers = ['AA', 'DL', 'UA', 'WN', 'BA']
  const rows = []
  for (let i = 0; i < 300; i++) {
    const distance = Math.max(150, Math.round(700 + Math.abs(g()) * 1400))
    const depHour = Math.max(0, Math.min(23, Math.round(13 + g() * 5)))
    const dayOfWeek = 1 + Math.floor(rng() * 7)
    const badWeather = rng() < 0.18
    const delayRisk = (depHour >= 16 && depHour <= 20 ? 0.15 : 0) + (badWeather ? 0.35 : 0) + (dayOfWeek === 5 ? 0.1 : 0)
    const delayed = rng() < 0.12 + delayRisk
    rows.push({
      Airline: carriers[Math.floor(rng() * carriers.length)],
      Distance: distance,
      DepartureHour: depHour,
      DayOfWeek: dayOfWeek,
      WeatherAlert: badWeather ? 'Yes' : 'No',
      Delayed: delayed ? 'Yes' : 'No',
    })
  }
  return { columns: ['Airline', 'Distance', 'DepartureHour', 'DayOfWeek', 'WeatherAlert', 'Delayed'], rows }
}

function genWine() {
  const rng = mulberry32(77), g = gaussianFactory(rng)
  const cultivars = ['1', '2', '3']
  const params = {
    1: { alcohol: [13.7, 0.5], malic: [2.0, 0.7], color: [5.5, 1.2], proline: [1100, 220] },
    2: { alcohol: [12.3, 0.5], malic: [1.9, 1.0], color: [3.1, 0.9], proline: [520, 160] },
    3: { alcohol: [13.2, 0.4], malic: [3.3, 1.1], color: [7.4, 2.3], proline: [630, 150] },
  }
  const counts = { 1: 59, 2: 71, 3: 48 } // matches the real dataset's class sizes
  const rows = []
  Object.keys(counts).forEach(cv => {
    const p = params[cv]
    for (let i = 0; i < counts[cv]; i++) {
      rows.push({
        Alcohol: clampRound(Math.max(11, p.alcohol[0] + g() * p.alcohol[1]), 2),
        MalicAcid: clampRound(Math.max(0.7, p.malic[0] + g() * p.malic[1]), 2),
        Ash: clampRound(Math.max(1.3, 2.3 + g() * 0.27), 2),
        Magnesium: Math.max(70, Math.round(99 + g() * 14)),
        TotalPhenols: clampRound(Math.max(0.9, 2.3 + g() * 0.6), 2),
        Flavanoids: clampRound(Math.max(0.3, 2.0 + g() * 1.0), 2),
        ColorIntensity: clampRound(Math.max(1.2, p.color[0] + g() * p.color[1]), 2),
        Hue: clampRound(Math.max(0.4, 0.96 + g() * 0.23), 2),
        Proline: Math.max(270, Math.round(p.proline[0] + g() * p.proline[1])),
        Cultivar: cv,
      })
    }
  })
  return {
    columns: ['Alcohol', 'MalicAcid', 'Ash', 'Magnesium', 'TotalPhenols', 'Flavanoids', 'ColorIntensity', 'Hue', 'Proline', 'Cultivar'],
    rows: shuffle(rows, rng),
  }
}

const REFERENCE_DATASETS = [
  {
    id: 'iris', filename: 'iris.csv', icon: '🌸',
    title: 'iris.csv',
    description: 'Classic dataset for pattern recognition. Contains measurements of 150 iris flowers.',
    rowsLabel: '150 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: SPECIES',
    generate: genIris,
  },
  {
    id: 'diabetes', filename: 'diabetes.csv', icon: '🩸',
    title: 'diabetes.csv',
    description: 'Pima Indians Diabetes Database. Predict the onset of diabetes based on diagnostic measures.',
    rowsLabel: '768 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: OUTCOME',
    generate: genDiabetes,
  },
  {
    id: 'housing', filename: 'housing.csv', icon: '🏠',
    title: 'housing.csv',
    description: 'Boston House Prices dataset. Predict median value of owner-occupied homes.',
    rowsLabel: '506 ROWS', taskLabel: 'REGRESSION', targetLabel: 'TARGET: MEDV',
    generate: genHousing,
  },
  {
    id: 'cancer', filename: 'cancer.csv', icon: '⚕',
    title: 'cancer.csv',
    description: 'Breast Cancer Wisconsin (Diagnostic) Data Set. Predict whether cancer is benign or malignant.',
    rowsLabel: '569 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: DIAGNOSIS',
    generate: genCancer,
  },
  {
    id: 'weather-nominal', filename: 'weather.nominal.csv', icon: '☁',
    title: 'weather.nominal.csv',
    description: 'Classic Quinlan "play tennis" dataset. Predict whether conditions are good for play, all-categorical.',
    rowsLabel: '14 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: PLAY',
    generate: genWeatherNominal,
  },
  {
    id: 'weather-numeric', filename: 'weather.numeric.csv', icon: '🌦',
    title: 'weather.numeric.csv',
    description: 'Same play-tennis dataset with numeric temperature and humidity instead of categorical bins.',
    rowsLabel: '14 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: PLAY',
    generate: genWeatherNumeric,
  },
  {
    id: 'glass', filename: 'glass.csv', icon: '🔷',
    title: 'glass.csv',
    description: 'Glass Identification dataset. Predict glass type from refractive index and oxide content — forensic classic.',
    rowsLabel: '216 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: TYPE',
    generate: genGlass,
  },
  {
    id: 'cpu', filename: 'cpu.csv', icon: '🖥',
    title: 'cpu.csv',
    description: 'Computer Hardware dataset. Predict published relative CPU performance from cycle time, memory and cache.',
    rowsLabel: '209 ROWS', taskLabel: 'REGRESSION', targetLabel: 'TARGET: PRP',
    generate: genCpu,
  },
  {
    id: 'airline', filename: 'airline.csv', icon: '✈',
    title: 'airline.csv',
    description: 'Flight records with distance, departure time and weather alerts. Predict whether a flight is delayed.',
    rowsLabel: '300 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: DELAYED',
    generate: genAirline,
  },
  {
    id: 'wine', filename: 'wine.csv', icon: '🍷',
    title: 'wine.csv',
    description: 'Wine recognition dataset. Predict the cultivar of a wine from its chemical analysis — 3 classes.',
    rowsLabel: '178 ROWS', taskLabel: 'CLASSIFICATION', targetLabel: 'TARGET: CULTIVAR',
    generate: genWine,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Pill({ label, tone = 'neutral', C, small }) {
  const tones = {
    neutral: { bg: C.chip, color: C.chipText },
    classification: { bg: C.primarySoft, color: C.primary },
    regression: { bg: C.successSoft, color: C.success },
    target: { bg: C.warningSoft, color: '#b45309' },
  }
  const s = tones[tone] || tones.neutral
  return (
    <span style={{
      display: 'inline-block', fontSize: small ? 9 : 10, fontWeight: 800, letterSpacing: 0.4,
      textTransform: 'uppercase', color: s.color, background: s.bg,
      padding: small ? '2px 7px' : '3px 9px', borderRadius: 6,
    }}>
      {label}
    </span>
  )
}

function StatMini({ icon, label, value, C }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 18px', flex: 1,
    }}>
      <span style={{ fontSize: 16, color: C.muted }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>{value}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DROP ZONE
// ─────────────────────────────────────────────────────────────────────────────
function DropZone({ C, dark, onFile, busy }) {
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef(null)

  const handleFiles = (files) => {
    const file = files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) return
    onFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragActive(true) }}
      onDragLeave={() => setDragActive(false)}
      onDrop={e => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragActive ? C.primary : C.border}`,
        borderRadius: 16, background: dragActive ? C.primarySoft : C.card,
        padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
        transition: 'all 0.2s', minHeight: 220, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)} />
      <div style={{ fontSize: 40, marginBottom: 14, color: C.muted }}>⬆</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 6 }}>
        {busy ? 'Reading file…' : 'Drag & Drop Dataset'}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Supports .csv files up to 500MB</div>
      <button onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
        style={btn(C.success, 'white', { padding: '10px 22px', fontSize: 12 })}>
        BROWSE FILES
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE DATASET GALLERY — scrolls 2 cards at a time
// ─────────────────────────────────────────────────────────────────────────────
function ReferenceDatasetCard({ ds, C, active, onClick }) {
  return (
    <div onClick={onClick}
      style={{
        background: C.card, border: `1.5px solid ${active ? C.primary : C.border}`,
        borderRadius: 14, padding: '16px 18px', cursor: 'pointer', height: '100%',
        boxShadow: active ? `0 0 0 3px ${C.primarySoft}` : shadow2, transition: 'all 0.15s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{ds.icon}</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{ds.title}</span>
      </div>
      <p style={{
        fontSize: 12, color: C.muted, lineHeight: 1.5, margin: '0 0 12px', height: 34,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {ds.description}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Pill label={ds.rowsLabel} tone="neutral" C={C} small />
        <Pill label={ds.taskLabel} tone={ds.taskLabel === 'REGRESSION' ? 'regression' : 'classification'} C={C} small />
        <Pill label={ds.targetLabel} tone="neutral" C={C} small />
      </div>
    </div>
  )
}

// Fixed card row height so the grid below always shows exactly 2 rows (4
// cards) before scrolling, regardless of how many reference datasets exist —
// only vertical scrolling reveals more, the visible shape never changes.
const GALLERY_CARD_H = 142
const GALLERY_ROW_GAP = 16

function ReferenceGallery({ C, selectedId, onSelect }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 10 }}>
        REFERENCE DATASETS
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: GALLERY_CARD_H, gap: GALLERY_ROW_GAP,
        maxHeight: GALLERY_CARD_H * 2 + GALLERY_ROW_GAP + 6, overflowY: 'auto', paddingRight: 4,
      }}>
        {REFERENCE_DATASETS.map(ds => (
          <ReferenceDatasetCard key={ds.id} ds={ds} C={C} active={selectedId === ds.id} onClick={() => onSelect(ds)} />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN CHIPS — suggested target gets a visible ring, per the mock
// ─────────────────────────────────────────────────────────────────────────────
function ColumnChips({ columns, columnsInfo, suggestedTarget, C }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 10 }}>COLUMNS</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {columns.map(col => {
          const isTarget = col === suggestedTarget
          return (
            <span key={col} title={isTarget ? 'Suggested target column' : columnsInfo[col]?.type}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                color: isTarget ? C.primary : C.text,
                background: isTarget ? C.primarySoft : C.chip,
                border: isTarget ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
              }}>
              {isTarget && <span style={{ fontSize: 10 }}>◎</span>}
              {col}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM TYPE CONFIDENCE BARS — Level 2 rule-based estimate, disclosed as such
// ─────────────────────────────────────────────────────────────────────────────
function ConfidenceBar({ label, pct, color, C }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color }}>{pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: C.light, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 5, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function ProblemTypeWidget({ confidence, C }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 12 }}>PROBLEM TYPE</div>
      <ConfidenceBar label="Classification" pct={confidence.classification} color={C.primary} C={C} />
      <ConfidenceBar label="Regression" pct={confidence.regression} color={C.success} C={C} />
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
        Level 2 (rule-based): estimated from the target column's data type and cardinality — not a trained prediction.
      </div>
    </div>
  )
}

function MiniHealthBadge({ pct, C }) {
  const color = pct >= 90 ? C.success : pct >= 70 ? C.warning : C.danger
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', height: '100%',
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 12, fontWeight: 900, color,
        background: `${color}18`, border: `2px solid ${color}`, flexShrink: 0,
      }}>
        {pct}
      </span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted }}>DATA HEALTH</div>
        <div style={{ fontSize: 11, color: C.muted }}>Full breakdown on the Diagnose page →</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW TABLE — max 15 rows, horizontally scrollable, target column marked
// ─────────────────────────────────────────────────────────────────────────────
function PreviewTable({ columns, rows, suggestedTarget, C }) {
  const shown = rows.slice(0, 15)
  const thStyle = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5,
    background: C.light, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  }
  const tdStyle = { padding: '9px 14px', color: C.text, whiteSpace: 'nowrap' }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 10 }}>
        DATA PREVIEW (TOP {shown.length} ROWS)
      </div>
      <div style={{
        maxHeight: 420, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 12,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {columns.map(col => {
                const isTarget = col === suggestedTarget
                return (
                  // Sticky positioning now lives on each <th> directly
                  // (matching the pattern already proven elsewhere in this
                  // app — Encoding.jsx/Sampling.jsx/FeatureSelection.jsx all
                  // do this per-cell rather than on <thead> as a whole,
                  // which is less consistently supported). The real bug
                  // this closes: the target column's header used
                  // C.primarySoft — a translucent rgba(...,0.10) tint, not
                  // an opaque color — as its background. Every OTHER
                  // column's opaque C.light header was already fine; only
                  // the (visually most important) target column let
                  // scrolling row data show through its own sticky header.
                  // Opaque C.light for every header now; the target column
                  // still reads as distinct via its primary text color and
                  // "(Target)" label, same as the data rows below already do.
                  <th key={col} style={{
                    ...thStyle,
                    color: isTarget ? C.primary : C.muted,
                    position: 'sticky', top: 0, zIndex: 1,
                  }}>
                    {col}{isTarget && ' (Target)'}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                {columns.map(col => (
                  <td key={col} style={{
                    ...tdStyle,
                    fontWeight: col === suggestedTarget ? 700 : 400,
                    color: col === suggestedTarget ? C.primary : C.text,
                  }}>
                    {row[col] === null || row[col] === undefined ? '—' : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASET SETUP DRAWER
// ─────────────────────────────────────────────────────────────────────────────
function StepIndicator({ step, C }) {
  const steps = [1, 2, 3]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
      {steps.map((n, i) => {
        const done = n < step, active = n === step
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'initial' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0,
              background: done ? C.success : active ? C.primary : C.light,
              color: done || active ? 'white' : C.muted,
              border: done || active ? 'none' : `1.5px solid ${C.border}`,
            }}>
              {done ? '✓' : n}
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: n < step ? C.success : C.border, margin: '0 6px' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ChoiceCard({ icon, title, subtitle, tag, selected, onClick, C }) {
  return (
    <div onClick={onClick} className="prism-choice-card"
      style={{
        position: 'relative', border: `1.5px solid ${selected ? C.primary : C.border}`,
        background: selected ? C.primarySoft : C.card, borderRadius: 14,
        padding: '18px 20px', cursor: 'pointer', transition: 'all 0.15s',
        boxShadow: selected ? `0 0 0 3px ${C.primary}22` : shadow2,
      }}>
      {selected && (
        <span style={{
          position: 'absolute', top: 14, right: 14, width: 22, height: 22, borderRadius: '50%',
          background: C.primary, color: 'white', fontSize: 12, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✓</span>
      )}
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{subtitle}</div>
      <Pill label={tag} tone={tag.includes('Unsupervised') ? 'regression' : 'classification'} C={C} />
    </div>
  )
}

function TaskPill({ task, C }) {
  const map = {
    classification: { label: 'Classification', bg: C.primarySoft, color: C.primary },
    regression: { label: 'Regression', bg: C.successSoft, color: C.success },
    clustering: { label: 'Clustering', bg: C.warningSoft, color: '#b45309' },
  }
  const s = map[task] || map.classification
  return (
    <span style={{ fontSize: 12, fontWeight: 800, color: s.color, background: s.bg, padding: '4px 12px', borderRadius: 20 }}>
      {s.label}
    </span>
  )
}

function DatasetSetupDrawer({
  C, dark, open, dataset, onClose,
  setupStep, setSetupStep,
  isLabeled, setIsLabeled,
  selectedTarget, setSelectedTarget,
  detectedTask, setDetectedTask,
  taskOverride, setTaskOverride,
  onConfirm,
}) {
  const finalTask = taskOverride || detectedTask

  useEffect(() => {
    if (!open) return
    // Reset step transition animation key handled by React key below.
  }, [setupStep, open])

  if (!dataset) return null

  const columns = dataset.columns
  const columnsInfo = dataset.columnsInfo
  const rows = dataset.rows

  const pickTarget = (col) => {
    setSelectedTarget(col)
    const t = detectTaskType(col, rows)
    setDetectedTask(t)
    setTaskOverride(null)
  }

  const targetUniqueValues = selectedTarget
    ? [...new Set(rows.map(r => r[selectedTarget]).filter(v => v !== null && v !== undefined))]
    : []

  const canGoNext =
    (setupStep === 1 && isLabeled !== null) ||
    (setupStep === 2 && (isLabeled ? !!selectedTarget : true)) ||
    false

  const goNext = () => setSetupStep(s => Math.min(3, s + 1))
  const goBack = () => setSetupStep(s => Math.max(1, s - 1))

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: '50%', minWidth: 420, height: '100vh',
      background: C.card, borderLeft: `1px solid ${C.border}`,
      boxShadow: '-8px 0 30px rgba(0,0,0,0.16)', zIndex: 500,
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes stepIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        /* Hover polish to match the card feel already established in
           Encoding.jsx/FeatureEngineering.jsx — purely visual (CSS-only,
           no state), doesn't touch any selection logic below. */
        .prism-choice-card:hover { border-color: ${C.primary} !important; transform: translateY(-1px); }
        .prism-target-row:hover { background: ${C.faint} !important; }
      `}</style>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 28px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>Dataset Setup</div>
        <button onClick={onClose} style={{
          background: C.light, border: 'none', borderRadius: 8, width: 30, height: 30,
          cursor: 'pointer', color: C.muted, fontSize: 14,
        }}>✕</button>
      </div>

      <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>
        <StepIndicator step={setupStep} C={C} />

        <div key={setupStep} style={{ animation: 'stepIn 0.25s ease-out' }}>
          {/* ── STEP 1 ── */}
          {setupStep === 1 && (
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 900, color: C.text, marginBottom: 4 }}>Tell us about your data</h2>
              <p style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
                This determines which machine learning workflows we'll show you.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ChoiceCard icon="🎯" title="Yes, I have a target column"
                  subtitle="I want the model to predict a specific column."
                  tag="Supervised Learning" selected={isLabeled === true}
                  onClick={() => setIsLabeled(true)} C={C} />
                <ChoiceCard icon="🔍" title="No, I want to discover patterns"
                  subtitle="I don't have a column to predict. Find groups in my data."
                  tag="Unsupervised · Clustering" selected={isLabeled === false}
                  onClick={() => setIsLabeled(false)} C={C} />
              </div>
            </div>
          )}

          {/* ── STEP 2A: target selector ── */}
          {setupStep === 2 && isLabeled && (
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 900, color: C.text, marginBottom: 4 }}>
                Which column should the model predict?
              </h2>
              <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
                Choose a column — we'll detect the task type automatically.
              </p>

              <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${C.border}`,
                borderRadius: 12, boxShadow: shadow2 }}>
                {columns.map(col => {
                  const info = columnsInfo[col]
                  const selected = selectedTarget === col
                  return (
                    <div key={col} onClick={() => pickTarget(col)} className="prism-target-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', cursor: 'pointer',
                        background: selected ? C.primarySoft : 'transparent',
                        borderLeft: selected ? `3px solid ${C.primary}` : '3px solid transparent',
                        borderBottom: `1px solid ${C.border}`, transition: 'background 0.1s',
                      }}>
                      <span style={{ fontSize: 14, color: selected ? C.primary : C.muted }}>{selected ? '●' : '○'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{col}</div>
                      </div>
                      <Pill label={info.type === 'numerical' ? 'Numeric' : info.type === 'binary' ? 'Binary' : 'Categorical'}
                        tone="neutral" C={C} small />
                      <span style={{ fontSize: 11, color: C.muted, minWidth: 58, textAlign: 'right' }}>
                        {info.unique} unique
                      </span>
                    </div>
                  )
                })}
              </div>

              {selectedTarget && (
                <div style={{ background: C.primarySoft, border: `1px solid ${C.primary}33`,
                  borderRadius: 12, padding: '14px 18px', marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Detected task:</span>
                    <TaskPill task={finalTask} C={C} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {columnsInfo[selectedTarget].isNumeric ? 'Numeric' : 'Categorical'} · {columnsInfo[selectedTarget].unique} unique value{columnsInfo[selectedTarget].unique !== 1 ? 's' : ''} → {detectedTask === 'classification' ? 'Classification' : 'Regression'}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    {['classification', 'regression'].map(t => {
                      const active = finalTask === t
                      return (
                        <button key={t} onClick={() => setTaskOverride(t)}
                          style={{
                            padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            background: active ? C.primary : C.card, color: active ? 'white' : C.text,
                            border: active ? 'none' : `1.5px solid ${C.border}`,
                          }}>
                          {t === 'classification' ? 'Classification' : 'Regression'}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8 }}>
                    Auto-detected based on column type and unique values. You can override it above.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2B: clustering confirmation ── */}
          {setupStep === 2 && isLabeled === false && (
            <div>
              <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                <h2 style={{ fontSize: 18, fontWeight: 900, color: C.text, marginBottom: 8 }}>
                  Unsupervised Learning — Clustering
                </h2>
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, maxWidth: 380, margin: '0 auto' }}>
                  No target column needed. We'll use K-Means Clustering to discover natural groups in your data.
                  You'll choose the number of clusters during training.
                </p>
              </div>
              <div style={{
                background: C.primarySoft, border: `1px solid ${C.primary}33`, borderRadius: 12,
                padding: '12px 16px', fontSize: 12.5, color: C.text, lineHeight: 1.5,
              }}>
                ℹ All numeric columns will be used as features. Categorical columns will be encoded automatically.
              </div>
            </div>
          )}

          {/* ── STEP 3: confirm ── */}
          {setupStep === 3 && (
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 900, color: C.text, marginBottom: 4 }}>Ready to start</h2>
              <p style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>
                Here's what we detected about your dataset.
              </p>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: '6px 20px', boxShadow: shadow2 }}>
                {[
                  ['Dataset name', dataset.filename],
                  ['Rows × Columns', `${dataset.rowCount} rows · ${dataset.columnCount} columns`],
                  ['Learning type', <span key="lt"><Pill label={isLabeled ? 'Supervised' : 'Unsupervised'} tone={isLabeled ? 'classification' : 'regression'} C={C} /></span>],
                  ['Task', <TaskPill key="tp" task={isLabeled ? finalTask : 'clustering'} C={C} />],
                  ...(isLabeled ? [['Target column', selectedTarget]] : []),
                  ...(isLabeled && finalTask === 'classification' ? [[
                    'Task classes',
                    `${targetUniqueValues.length} class${targetUniqueValues.length !== 1 ? 'es' : ''}: ${targetUniqueValues.slice(0, 8).join(', ')}${targetUniqueValues.length > 8 ? `, +${targetUniqueValues.length - 8} more` : ''}`,
                  ]] : []),
                ].map(([label, value], i, arr) => (
                  <div key={label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', fontSize: 13,
                    borderBottom: i < arr.length - 1 ? `1px solid ${C.light}` : 'none',
                  }}>
                    <span style={{ color: C.muted, fontWeight: 600 }}>{label}</span>
                    <span style={{ color: C.text, fontWeight: 700, textAlign: 'right' }}>{value}</span>
                  </div>
                ))}
              </div>

              <button onClick={onConfirm}
                style={{
                  width: '100%', marginTop: 22, background: C.primary, color: 'white', fontWeight: 800,
                  padding: 14, borderRadius: 12, fontSize: 15, border: 'none', cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(99,102,241,0.35)',
                }}>
                Confirm & Start Diagnosis →
              </button>
            </div>
          )}
        </div>
      </div>

      {setupStep < 3 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', padding: '16px 28px',
          borderTop: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <button onClick={goBack} disabled={setupStep === 1}
            style={btn(C.light, C.muted, { opacity: setupStep === 1 ? 0.4 : 1, cursor: setupStep === 1 ? 'default' : 'pointer' })}>
            ← Back
          </button>
          <button onClick={goNext} disabled={!canGoNext}
            style={btn(C.primary, 'white', { opacity: canGoNext ? 1 : 0.4, cursor: canGoNext ? 'pointer' : 'default', padding: '10px 26px' })}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN UPLOAD PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function UploadPage({ projectData, onNext, onUpdateData, active, onNavigate, furthestOrder }) {
  const { dark, C } = useTheme()

  const [dataset, setDataset] = useState(null)   // unified shape, see buildDataset()
  // The actual File/Blob backing `dataset`, kept only so handleConfirm can
  // hand it to App.jsx for a real Django upload — never read for parsing
  // (parsing already happened client-side into `dataset`).
  const [rawFile, setRawFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [setupStep, setSetupStep] = useState(1)
  const [isLabeled, setIsLabeled] = useState(null)
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [detectedTask, setDetectedTask] = useState(null)
  const [taskOverride, setTaskOverride] = useState(null)

  const buildDataset = useCallback((source, filename, sizeBytes, columns, rows) => {
    const columnsInfo = analyzeColumns(columns, rows)
    const suggestedTarget = suggestTarget(columns, columnsInfo)
    return {
      source, filename, sizeLabel: formatBytes(sizeBytes),
      rowCount: rows.length, columnCount: columns.length,
      columns, columnsInfo, rows, suggestedTarget,
      confidence: computeTaskConfidence(rows, columnsInfo, suggestedTarget),
      health: computeMiniHealth(rows, columns, columnsInfo),
    }
  }, [])

  const resetDrawerState = () => {
    setSetupStep(1); setIsLabeled(null); setSelectedTarget(null)
    setDetectedTask(null); setTaskOverride(null)
  }

  const handleFile = async (file) => {
    setBusy(true); setError(''); setDrawerOpen(false); resetDrawerState()
    try {
      const text = await file.text()
      const { columns, rows } = parseCSV(text)
      if (!columns.length || !rows.length) throw new Error('Could not read any rows from this file.')
      setDataset(buildDataset('upload', file.name, file.size, columns, rows))
      setRawFile(file)
    } catch (e) {
      setError(e.message || 'Failed to read this CSV file.')
    } finally {
      setBusy(false)
    }
  }

  const handleReferenceSelect = (ds) => {
    setBusy(true); setError(''); setDrawerOpen(false); resetDrawerState()
    // Synchronous generation, but keep the same async-shaped flow as a real upload.
    setTimeout(() => {
      try {
        const { columns, rows } = ds.generate()
        const csvText = columns.join(',') + '\n' + rows.map(r => columns.map(c => r[c]).join(',')).join('\n')
        const csvBytes = new Blob([csvText]).size
        setDataset(buildDataset('reference', ds.filename, csvBytes, columns, rows))
        setRawFile(new File([csvText], ds.filename, { type: 'text/csv' }))
      } catch (e) {
        setError('Failed to load reference dataset.')
      } finally {
        setBusy(false)
      }
    }, 0)
  }

  const openDrawer = () => {
    resetDrawerState()
    setDrawerOpen(true)
  }

  const handleConfirm = () => {
    onUpdateData?.({
      isLabeled: !!isLabeled,
      targetColumn: isLabeled ? selectedTarget : null,
      taskType: isLabeled ? (taskOverride || detectedTask) : 'clustering',
      learningType: isLabeled ? 'supervised' : 'unsupervised',
      datasetFilename: dataset?.filename,
      rowCount: dataset?.rowCount,
      columnCount: dataset?.columnCount,
      // The actual data, so Diagnose.jsx can open directly on what was just
      // confirmed here instead of asking the user to load the same CSV twice.
      columns: dataset?.columns,
      rows: dataset?.rows,
      // Real file/blob so App.jsx can persist it through Django's upload
      // endpoint, giving the whole downstream pipeline (Cleaning/Encoding/
      // FeatureEngineering) a real version-1 file_path to chain off of.
      rawFile,
    })
    onNext?.('diagnose', {})
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.bg,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      transition: 'background 0.2s',
    }}>
      <TopNav active={active || 'upload'} onNavigate={onNavigate} furthestOrder={furthestOrder} />
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 32px 64px' }}>

        {/* Two-column region: left content dims when drawer is open */}
        <div style={{
          opacity: drawerOpen ? 0.6 : 1, transition: 'opacity 0.3s ease',
          marginRight: drawerOpen ? '52%' : 0,
          transitionProperty: 'opacity, margin-right',
          transitionDuration: '0.3s, 0.35s',
        }}>
          <h1 style={{ fontSize: 30, fontWeight: 900, color: C.text, marginBottom: 8 }}>Data Ingestion</h1>
          <p style={{ fontSize: 14, color: C.muted, maxWidth: 620, lineHeight: 1.6, marginBottom: 28 }}>
            Upload a CSV file to begin the transformation process, or select a pre-configured dataset from the gallery below.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 24, marginBottom: 28, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: C.muted, marginBottom: 10 }}>SOURCE INPUT</div>
              <DropZone C={C} dark={dark} onFile={handleFile} busy={busy && dataset?.source !== 'reference'} />
            </div>
            <ReferenceGallery C={C} selectedId={dataset?.source === 'reference' ? REFERENCE_DATASETS.find(d => d.filename === dataset.filename)?.id : null}
              onSelect={handleReferenceSelect} />
          </div>

          {error && (
            <div style={{
              background: C.dangerSoft, border: `1px solid ${C.danger}`, borderRadius: 10,
              padding: '12px 16px', color: C.danger, fontSize: 13, marginBottom: 20,
            }}>⚠ {error}</div>
          )}

          {busy && !dataset && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: C.muted, fontSize: 13 }}>⏳ Loading dataset…</div>
          )}

          {dataset && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: C.primarySoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
                }}>▤</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{dataset.filename}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>
                    {dataset.rowCount.toLocaleString()} ROWS · {dataset.columnCount} COLUMNS · {dataset.sizeLabel}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                <StatMini icon="▦" label="Rows" value={dataset.rowCount.toLocaleString()} C={C} />
                <StatMini icon="▥" label="Columns" value={dataset.columnCount} C={C} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <ColumnChips columns={dataset.columns} columnsInfo={dataset.columnsInfo}
                  suggestedTarget={dataset.suggestedTarget} C={C} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, marginBottom: 24, alignItems: 'stretch' }}>
                <ProblemTypeWidget confidence={dataset.confidence} C={C} />
                <MiniHealthBadge pct={dataset.health} C={C} />
              </div>

              <div style={{ marginBottom: 24 }}>
                <PreviewTable columns={dataset.columns} rows={dataset.rows}
                  suggestedTarget={dataset.suggestedTarget} C={C} />
              </div>

              <button onClick={openDrawer}
                style={{
                  width: '100%', background: C.primary, color: 'white', fontWeight: 800,
                  padding: 14, borderRadius: 12, fontSize: 15, border: 'none', cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(99,102,241,0.35)',
                }}>
                Use This Dataset →
              </button>
            </div>
          )}
        </div>
      </div>

      <DatasetSetupDrawer
        C={C} dark={dark} open={drawerOpen} dataset={dataset} onClose={() => setDrawerOpen(false)}
        setupStep={setupStep} setSetupStep={setSetupStep}
        isLabeled={isLabeled} setIsLabeled={setIsLabeled}
        selectedTarget={selectedTarget} setSelectedTarget={setSelectedTarget}
        detectedTask={detectedTask} setDetectedTask={setDetectedTask}
        taskOverride={taskOverride} setTaskOverride={setTaskOverride}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
