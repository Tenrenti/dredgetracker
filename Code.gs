/**
 * Dredging Equipment Dashboard — server side
 *
 * Optimised build:
 *  - one round trip (data + icons together) instead of two
 *  - payload trimmed to the fields the dashboard actually reads
 *  - spreadsheet opened once, not twice
 *  - result cached for 1 hour, gzipped and chunked; Refresh button bypasses it
 *  - also answers as a JSON API for the GitHub Pages copy of the dashboard
 *    (see doGet / doPost below). After pasting this file: Deploy ->
 *    Manage deployments -> edit -> Version: New version -> Deploy.
 */
const CONFIG = {
  SPREADSHEET_ID: '1P8cHoKEe2Hr5fCvkHOK7H8wjx3Mh5KAAm0xfTDpYGYY',
  SHEET_NAME: 'Sheet1',
  REFERENCE_SHEET: 'ReferenceValues',
  HEADER_ROW: 1,
  EXCLUDE_TYPE_KEYWORD: 'ancillary',
  CACHE_SECONDS: 3600,
  CACHE_VERSION: 'v3',
  // Used ONLY when the header text below cannot be found in row 1.
  FALLBACK_COLUMNS: { projectName: 13, location: 14, statusEnd: 56 }
};
/**
 * Header text -> internal key. Matching ignores case and extra spaces.
 * Only headers the dashboard actually uses are listed. Adding a column back
 * is a one-line change here plus one line in the record below.
 *
 * Note: statusEnd reads column BD (overall status for the month) — that is the
 * value the map pin colour and every status table is based on.
 */
const HEADERS = {
  'REGION': 'region',
  'DPCN': 'dpcn',
  'MONTH': 'month',
  '# MONTH': 'monthNum',
  'EQUIPMENT TYPE': 'equipmentType',
  'PROJECT NAME': 'projectName',
  'LOCATION': 'location',
  'LATITUDE': 'lat',
  'LONGITUDE': 'lng',
  'DREDGE MASTER / OIC': 'dredgeMaster',
  'A.1': 'a1', 'A.2': 'a2', 'A.3': 'a3',
  'B': 'b',
  'C.1.1': 'c11', 'C.1.2': 'c12', 'C.2.1': 'c21',
  'C.2.2': 'c22', 'C.3': 'c3', 'C.4': 'c4',
  'D': 'd',
  'CALENDAR DAYS': 'calendarDays',
  'STATUS (OVERALL STATUS FOR THE MONTH)': 'statusEnd',
  'REMARKS': 'remarks',
  'ISLAND': 'island'
};
/**
 * Headers that are nice to have but not required. When one of these is absent
 * from row 1 the dashboard still works (a fallback is derived elsewhere), so
 * no warning banner is raised.
 *
 * '# MONTH' is only a backup source for the month number — MONTH itself is
 * already parsed for that — so its absence is not worth reporting.
 */
const OPTIONAL_HEADERS = ['# MONTH'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                     'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ICON_FILES = {
  amphibious: '15k0h94v4pxlGj6tbIs5xzl50WCJDFdyS',
  mpad:       '1l_g4u9TFVtS3cULc2ALMb3NWi6pdSXSD',
  csd:        '1387__BFjNeGZ7CYLkMroXF9YfqMANptV',
  skimmer:    '1IicXDMvT_bfZ_FD0AdDZHPQaSKqjKpBE',
  tug:        '18iACdX2v6lkah-kFkBW-w7de9g73mp_B',
  supportLbe: '1fMeEi0cIOeJEoQDcnO-3wPbRAYqIjxuP',
  mainLbe:    '1s1-iFOxE2E8uouU1lJEssuR9Sc-blfRW',
  bob:        '1r4zM7E92oQlHBdn9fqi5u6tuo5qwx5zb'
};
const ICON_RULES = [
  { key: 'supportLbe', keywords: ['support', 'lbe'] },
  { key: 'mainLbe',    keywords: ['main', 'dredger', 'lbe'] },
  { key: 'bob',        keywords: ['bob'] },
  { key: 'bob',        keywords: ['backhoe', 'barge'] },
  { key: 'amphibious', keywords: ['amphibious'] },
  { key: 'amphibious', keywords: ['ae'] },
  { key: 'mpad',       keywords: ['mpad'] },
  { key: 'mpad',       keywords: ['multi', 'purpose'] },
  { key: 'csd',        keywords: ['csd'] },
  { key: 'csd',        keywords: ['cutter', 'suction'] },
  { key: 'skimmer',    keywords: ['skimmer'] },
  { key: 'skimmer',    keywords: ['ts'] },
  { key: 'tug',        keywords: ['tug'] },
  { key: 'tug',        keywords: ['support', 'vessel'] }
];
/* ---------------------------------------------------------------- entry points */
/**
 * Two ways in:
 *  - .../exec?action=bootstrap   -> JSON data for the GitHub Pages dashboard
 *  - .../exec (no action)        -> the original Apps Script page, unchanged,
 *                                   so the old link keeps working.
 */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action) return apiResponse_(function () { return handleApi_(action, e.parameter); });
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Dredger Status Map')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/** Used by the GitHub page for export images (the list of image links is sent in the body). */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return apiResponse_(function () { return handleApi_(body.action, body); });
}
/* Only these two actions are reachable from outside. */
function handleApi_(action, params) {
  params = params || {};
  if (action === 'bootstrap') {
    const force = params.force === true || params.force === '1' || params.force === 'true';
    return getBootstrap(force);
  }
  if (action === 'exportImages') {
    // getDashboardExportImages (ExportImages.gs) only serves images that are
    // already configured for this dashboard, so it is safe to expose.
    return getDashboardExportImages(Array.isArray(params.urls) ? params.urls : []);
  }
  throw new Error('Unknown request: ' + action);
}
function apiResponse_(work) {
  let out;
  try { out = { ok: true, result: work() }; }
  catch (err) { out = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
/** Kept so Index.html can pull in extra HTML files if you ever need to. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
/**
 * The single call the dashboard makes on load.
 * forceRefresh = true skips the cache (used by the Refresh button).
 */
function getBootstrap(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = readCache_(cache);
    if (cached) return cached;
  }
  const payload = buildPayload_();
  writeCache_(cache, payload);
  return payload;
}
/* ---------------------------------------------------------------- payload */
function buildPayload_() {
  const ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  const warnings = [];
  const base = {
    icons: buildIconUrls_(),
    rules: ICON_RULES,
    dredgeMasters: getDredgeMasters_(ss),
    generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy, h:mm a'),
    fromCache: false
  };
  if (values.length <= CONFIG.HEADER_ROW) {
    base.equipment = []; base.regions = []; base.types = [];
    base.warnings = ['No data rows found.'];
    return base;
  }
  const headerRow = values[CONFIG.HEADER_ROW - 1];
  const idx = mapHeaders_(headerRow);
  // Dredge master header can be worded a few ways — look harder before giving up.
  if (idx.dredgeMaster === undefined) {
    headerRow.some(function (cell, columnIndex) {
      const header = normHeader_(cell);
      if (header.indexOf('DREDGE MASTER') > -1 || header === 'OIC' ||
          header.indexOf('OFFICER IN CHARGE') > -1) {
        idx.dredgeMaster = columnIndex;
        return true;
      }
      return false;
    });
  }
  // Fall back to fixed column numbers only where the header text was not found.
  Object.keys(CONFIG.FALLBACK_COLUMNS).forEach(function (key) {
    if (idx[key] !== undefined) return;
    const column = CONFIG.FALLBACK_COLUMNS[key];
    if (headerRow.length >= column) {
      idx[key] = column - 1;
      warnings.push('Header for "' + key + '" not found — using column ' + column + '.');
    }
  });
  Object.keys(HEADERS).forEach(function (h) {
    if (OPTIONAL_HEADERS.indexOf(h) > -1) return;
    if (idx[HEADERS[h]] === undefined) warnings.push('Header not found: ' + h);
  });
  const get = function (row, key) {
    const i = idx[key];
    return i === undefined ? '' : row[i];
  };
  const byDpcn = {};
  let skippedAncillary = 0;
  for (let r = CONFIG.HEADER_ROW; r < values.length; r++) {
    const row = values[r];
    const dpcn = String(get(row, 'dpcn')).trim();
    if (!dpcn) continue;
    const type = String(get(row, 'equipmentType')).trim();
    if (type.toLowerCase().indexOf(CONFIG.EXCLUDE_TYPE_KEYWORD) !== -1) {
      skippedAncillary++;
      continue;
    }
    const statusEnd = str_(get(row, 'statusEnd'));
    // Only the fields the dashboard reads.
    const rec = {
      rowIndex: r + 1,
      month: monthLabel_(get(row, 'month')),
      monthNum: monthNumber_(get(row, 'month'), get(row, 'monthNum'), r),
      projectName: str_(get(row, 'projectName')),
      location: str_(get(row, 'location')),
      lat: parseCoord_(get(row, 'lat'), 'lat'),
      lng: parseCoord_(get(row, 'lng'), 'lng'),
      dredgeMaster: str_(get(row, 'dredgeMaster')),
      statusEnd: statusEnd,
      remarks: str_(get(row, 'remarks')),
      calendarDays: num_(get(row, 'calendarDays')),
      days: {
        idle: num_(get(row, 'a1')) + num_(get(row, 'a2')) + num_(get(row, 'a3')),
        operating: num_(get(row, 'b')),
        repair: num_(get(row, 'c11')) + num_(get(row, 'c12')) + num_(get(row, 'c21')) +
                num_(get(row, 'c22')) + num_(get(row, 'c3')) + num_(get(row, 'c4')),
        disposal: num_(get(row, 'd'))
      },
      moved: false,
      // carried only to group the rows; stripped again below
      _region: str_(get(row, 'region')),
      _type: type,
      _island: str_(get(row, 'island')),
      _code: statusCode_(statusEnd)
    };
    if (!byDpcn[dpcn]) byDpcn[dpcn] = [];
    byDpcn[dpcn].push(rec);
  }
  const equipment = Object.keys(byDpcn).map(function (dpcn) {
    const allHistory = byDpcn[dpcn].sort(function (a, b) { return a.rowIndex - b.rowIndex; });
    // Flag months where the position changed.
    let prev = null;
    allHistory.forEach(function (h) {
      if (h.lat === null || h.lng === null) return;
      if (prev && (Math.abs(h.lat - prev.lat) > 0.0001 || Math.abs(h.lng - prev.lng) > 0.0001)) {
        h.moved = true;
      }
      prev = h;
    });
    // Last month holding usable coordinates decides where the pin sits.
    let pin = null;
    for (let i = allHistory.length - 1; i >= 0; i--) {
      if (allHistory[i].lat !== null && allHistory[i].lng !== null) { pin = allHistory[i]; break; }
    }
    const reported = allHistory.filter(function (h) { return !!h._code; });
    const history = reported.length ? reported : allHistory;
    const last = history[history.length - 1];
    const out = {
      dpcn: dpcn,
      region: last._region,
      equipmentType: last._type,
      island: last._island,
      li: history.length - 1,          // index of the latest record within history
      history: history,
      pin: pin ? { lat: pin.lat, lng: pin.lng, month: pin.month, location: pin.location } : null
    };
    history.forEach(function (h) {
      delete h._region; delete h._type; delete h._island; delete h._code;
    });
    return out;
  });
  const uniq = function (arr) {
    return arr.filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort();
  };
  if (skippedAncillary) warnings.push(skippedAncillary + ' ancillary rows excluded.');
  base.equipment = equipment;
  base.regions = uniq(equipment.map(function (e) { return e.region; }));
  base.types = uniq(equipment.map(function (e) { return e.equipmentType; }));
  base.warnings = warnings;
  return base;
}
function buildIconUrls_() {
  const icons = {};
  Object.keys(ICON_FILES).forEach(function (key) {
    icons[key] = 'https://drive.google.com/thumbnail?id=' + ICON_FILES[key] + '&sz=w256';
  });
  return icons;
}
function getDredgeMasters_(ss) {
  const map = {};
  const sheet = ss.getSheetByName(CONFIG.REFERENCE_SHEET);
  if (!sheet) return map;
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return map;
  const headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const nameIdx = headers.indexOf('name');
  const picIdx = headers.indexOf('picture link');
  if (nameIdx === -1 || picIdx === -1) return map;
  for (let i = 1; i < values.length; i++) {
    const name = String(values[i][nameIdx]).trim().toLowerCase();
    let link = String(values[i][picIdx]).trim();
    const match = link.match(/([-\w]{25,})/);
    if (match && link.indexOf('drive.google.com') > -1) {
      link = 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w256';
    }
    if (name) map[name] = link;
  }
  return map;
}
/* ---------------------------------------------------------------- cache */
/* Values are gzipped, base64'd, then split across keys because one cache
   entry cannot exceed 100KB. A missing chunk is treated as a cache miss. */
function cacheKey_(suffix) {
  return 'dash_' + CONFIG.CACHE_VERSION + '_' + suffix;
}
function readCache_(cache) {
  try {
    const meta = cache.get(cacheKey_('meta'));
    if (!meta) return null;
    const count = Number(meta);
    if (!count) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(cacheKey_(i));
    const parts = cache.getAll(keys);
    let joined = '';
    for (let i = 0; i < count; i++) {
      const part = parts[cacheKey_(i)];
      if (!part) return null;
      joined += part;
    }
    const blob = Utilities.newBlob(Utilities.base64Decode(joined), 'application/x-gzip', 'd.gz');
    const data = JSON.parse(Utilities.ungzip(blob).getDataAsString());
    data.fromCache = true;
    return data;
  } catch (e) {
    return null;
  }
}
function writeCache_(cache, payload) {
  try {
    const gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(payload), 'application/json'));
    const encoded = Utilities.base64Encode(gz.getBytes());
    const CHUNK = 90000;
    const count = Math.ceil(encoded.length / CHUNK);
    if (count > 40) return;   // unusually large — skip caching rather than thrash
    const map = {};
    for (let i = 0; i < count; i++) map[cacheKey_(i)] = encoded.substr(i * CHUNK, CHUNK);
    map[cacheKey_('meta')] = String(count);
    cache.putAll(map, CONFIG.CACHE_SECONDS);
  } catch (e) {
    // Caching is best-effort; a failure here must never break the dashboard.
  }
}
/** Run manually from the editor if you ever need to force everyone onto fresh data. */
function clearDashboardCache() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(cacheKey_('meta'));
  const keys = [cacheKey_('meta')];
  const count = Number(meta || 0);
  for (let i = 0; i < count; i++) keys.push(cacheKey_(i));
  cache.removeAll(keys);
}
/* ---------------------------------------------------------------- helpers */
function normHeader_(s) {
  return String(s).replace(/\s+/g, ' ').trim().toUpperCase();
}
function mapHeaders_(headerRow) {
  const lookup = {};
  Object.keys(HEADERS).forEach(function (h) { lookup[normHeader_(h)] = HEADERS[h]; });
  const idx = {};
  headerRow.forEach(function (cell, i) {
    const key = lookup[normHeader_(cell)];
    if (key && idx[key] === undefined) idx[key] = i;
  });
  return idx;
}
function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function statusCode_(v) {
  const s = str_(v).toUpperCase();
  if (!s) return '';
  const first = s.charAt(0);
  return ['A', 'B', 'C', 'D'].indexOf(first) > -1 ? first : '';
}
function parseCoord_(v, kind) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return inRange_(v, kind);
  const s = String(v).trim();
  if (!s) return null;
  const plainText = s.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(plainText)) return inRange_(Number(plainText), kind);
  const dms = s.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\s*([NSEW])?/i);
  if (dms) {
    let dec = Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600;
    if (dms[4] && /[SW]/i.test(dms[4])) dec = -dec;
    return inRange_(dec, kind);
  }
  const loose = Number(s.replace(/[^0-9.\-]/g, ''));
  return isNaN(loose) ? null : inRange_(loose, kind);
}
function inRange_(n, kind) {
  if (isNaN(n) || n === 0) return null;
  if (kind === 'lat' && (n < -90 || n > 90)) return null;
  if (kind === 'lng' && (n < -180 || n > 180)) return null;
  return n;
}
function monthLabel_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MMMM yyyy');
  }
  return str_(v);
}
function monthNumber_(monthCell, monthNumCell, rowOrder) {
  if (monthCell instanceof Date) return monthCell.getMonth() + 1;
  const s = normHeader_(monthCell);
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (s.indexOf(MONTH_NAMES[i]) === 0 || s.indexOf(' ' + MONTH_NAMES[i]) !== -1) return i + 1;
  }
  const n = num_(monthNumCell);
  if (n >= 1 && n <= 12) return n;
  const m = num_(monthCell);
  if (m >= 1 && m <= 12) return m;
  return 100 + rowOrder;
}
/* ================= EXPORT ICON SUPPORT =================
   Browsers refuse to copy a cross-origin image into a canvas the page
   generates, so Drive-hosted icons come out blank in PDF/PNG exports.
   Fetching them here and handing them back as data URIs makes them
   same-origin from the browser's point of view, so they always render.
*/
const L1_L2_FILE_ID = '1sSHDQYvuH3qpZbtJ1a3zgPdiDQ0lehEw';
const ICON_CACHE_KEY = 'icondata_v1';
/** Called by the dashboard the first time an export is run. */
function getIconDataUris() {
  const cache = CacheService.getScriptCache();
  const cached = readChunked_(cache, ICON_CACHE_KEY);
  if (cached) return cached;
  const out = {};
  Object.keys(ICON_FILES).forEach(function (key) {
    out[key] = fetchAsDataUri_(ICON_FILES[key]);
  });
  out.l1l2 = fetchAsDataUri_(L1_L2_FILE_ID);
  writeChunked_(cache, ICON_CACHE_KEY, out);
  return out;
}
/** w128 is plenty — pins draw at roughly 38-60px. Returns null on failure. */
function fetchAsDataUri_(fileId) {
  try {
    const url = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w128';
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    const blob = res.getBlob();
    const type = blob.getContentType() || 'image/png';
    if (type.indexOf('image/') !== 0) return null;   // Drive returned an HTML error page
    return 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return null;
  }
}
/* Generic chunked cache — separate from the dashboard payload cache so the
   two never collide. One cache entry cannot exceed 100KB. */
function readChunked_(cache, prefix) {
  try {
    const meta = cache.get(prefix + '_meta');
    if (!meta) return null;
    const count = Number(meta);
    if (!count) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(prefix + '_' + i);
    const parts = cache.getAll(keys);
    let joined = '';
    for (let i = 0; i < count; i++) {
      const part = parts[prefix + '_' + i];
      if (!part) return null;
      joined += part;
    }
    return JSON.parse(joined);
  } catch (e) {
    return null;
  }
}
function writeChunked_(cache, prefix, value) {
  try {
    const text = JSON.stringify(value);
    const CHUNK = 90000;
    const count = Math.ceil(text.length / CHUNK);
    if (count > 40) return;
    const map = {};
    for (let i = 0; i < count; i++) map[prefix + '_' + i] = text.substr(i * CHUNK, CHUNK);
    map[prefix + '_meta'] = String(count);
    cache.putAll(map, 21600);   // 6 hours; icons rarely change
  } catch (e) {
    // best effort only
  }
}
/* ================= IMAGE EXPORT BYPASS =================
   Converts Google Drive image URLs (like Dredge Master photos)
   into raw Base64 data so html2canvas can screenshot them without CORS errors.

   Security: this used to fetch ANY address it was given, and anyone who
   opens the web app can call it. It now goes through the same allow-list as
   getDashboardExportImages (ExportImages.gs): only the equipment icons and
   the photos listed in the ReferenceValues sheet are fetched.
*/
function getBase64Images(urls) {
  const list = Array.isArray(urls) ? urls.slice(0, 64) : [];
  return getDashboardExportImages(list).images;
}
