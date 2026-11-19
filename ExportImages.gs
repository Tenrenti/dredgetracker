/**
 * Replace ExportImages.gs with this file. Keep the existing Code.gs.
 * Revision 3: Drive reads have a public-thumbnail fallback; actual errors
 * are returned to the caller. No sharing settings are changed.
 * Only assets already configured for this dashboard can be exported.
 */
function getDashboardExportImages(urls) {
  if (!Array.isArray(urls) || urls.length > 64) {
    throw new Error('Invalid export image request.');
  }
  const requested = Array.from(new Set(urls.filter(function (url) {
    return typeof url === 'string' && url.length <= 2048 && /^https:\/\//i.test(url);
  })));
  const allowedIds = Object.create(null);
  Object.keys(ICON_FILES).forEach(function (key) { allowedIds[ICON_FILES[key]] = true; });
  allowedIds[L1_L2_FILE_ID] = true;

  // Read the reference sheet only when the request contains an asset other
  // than the known equipment icons (for example a dredge-master photograph).
  const extra = requested.some(function (url) {
    const id = dashboardExportDriveId_(url);
    return !id || !allowedIds[id];
  });
  const allowedUrls = Object.create(null);
  if (extra) {
    const ss = CONFIG.SPREADSHEET_ID
      ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
      : SpreadsheetApp.getActive();
    const references = getDredgeMasters_(ss);
    Object.keys(references).forEach(function (name) {
      const url = references[name];
      if (!url) return;
      allowedUrls[url] = true;
      const id = dashboardExportDriveId_(url);
      if (id) allowedIds[id] = true;
    });
  }

  const images = {}, failures = [], local = Object.create(null);
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (ignored) {}
  let totalBytes = 0;
  requested.forEach(function (url) {
    try {
      const id = dashboardExportDriveId_(url);
      if (!(id && allowedIds[id]) && !allowedUrls[url]) {
        throw new Error('Image is not configured for this dashboard.');
      }
      const identity = id || url;
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, identity);
      const cacheKey = 'dashboard_export_image_v3_' + Utilities.base64EncodeWebSafe(digest);
      let data = local[identity];
      if (!data && cache) {
        try { data = cache.get(cacheKey); } catch (ignored) {}
      }
      if (!data) {
        // The allow-list above is checked BEFORE either retrieval method.
        data = id ? dashboardExportDriveImage_(id) : dashboardExportFetchImage_(url);
        if (cache && data.length < 90000) {
          try { cache.put(cacheKey, data, 21600); } catch (ignored) {}
        }
      }
      totalBytes += data.length;
      if (totalBytes > 16000000) throw new Error('Combined export images are too large.');
      local[identity] = data;
      images[url] = data;
    } catch (error) {
      console.warn('Dashboard export image: ' + String(error && error.message || error));
      const iconKey = Object.keys(ICON_FILES).filter(function (key) {
        return ICON_FILES[key] === dashboardExportDriveId_(url);
      })[0];
      failures.push({url: url, label: iconKey || 'Reference image', message: String(error && error.message || error)});
    }
  });
  return {images: images, failures: failures};
}

function dashboardExportDriveImage_(id) {
  const reasons = [];
  try {
    const file = DriveApp.getFileById(id);
    // Decode the bytes, not just the MIME label. Uploaded PNGs sometimes
    // carry a generic application/octet-stream label in Drive.
    if (file.getSize() <= 1572864) {
      try { return dashboardExportDataUri_(file.getBlob()); }
      catch (error) { reasons.push('Original: ' + String(error && error.message || error)); }
    }
    try { return dashboardExportDataUri_(file.getThumbnail()); }
    catch (error) { reasons.push('Drive thumbnail: ' + String(error && error.message || error)); }
  } catch (error) {
    reasons.push('Drive: ' + String(error && error.message || error));
  }
  try {
    // This is the same thumbnail endpoint used on screen. Publicly viewable
    // icons can still work here when the authenticated Drive method fails.
    // Private files continue to require the deploying account's Drive access.
    return dashboardExportFetchImage_('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w256');
  } catch (error) {
    reasons.push('Public thumbnail: ' + String(error && error.message || error));
  }
  throw new Error(reasons.join(' | '));
}

function dashboardExportFetchImage_(url) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true, timeoutSeconds: 10
  });
  const code = response.getResponseCode();
  if (code !== 200) throw new Error('Image host returned HTTP ' + code + '.');
  return dashboardExportDataUri_(response.getBlob());
}

function dashboardExportDataUri_(blob) {
  if (!blob) throw new Error('No image data was returned.');
  const bytes = blob.getBytes();
  if (!bytes.length) throw new Error('The image was empty.');
  if (bytes.length > 3145728) throw new Error('Image is too large for export (maximum 3 MB).');
  const head = bytes.slice(0, 12).map(function (b) { return b & 255; });
  function starts(signature) {
    return signature.every(function (b, i) { return head[i] === b; });
  }
  let type = '';
  if (starts([137,80,78,71,13,10,26,10])) type = 'image/png';
  else if (starts([255,216,255])) type = 'image/jpeg';
  else if (starts([71,73,70,56,55,97]) || starts([71,73,70,56,57,97])) type = 'image/gif';
  else if (starts([82,73,70,70]) && head[8] === 87 && head[9] === 69 && head[10] === 66 && head[11] === 80) type = 'image/webp';
  if (!type) throw new Error('The response was not a PNG, JPEG, GIF, or WebP image (reported type: ' + String(blob.getContentType() || 'unknown') + ').');
  return 'data:' + type + ';base64,' + Utilities.base64Encode(bytes);
}

/** Run from the editor to authorize and diagnose the actual configured icons.
 * Logs a small report without image bytes. Nothing is changed in Drive.
 */
function testDashboardExportImages() {
  const keys = Object.keys(ICON_FILES);
  const urls = keys.map(function (key) {
    return 'https://drive.google.com/thumbnail?id=' + ICON_FILES[key] + '&sz=w256';
  });
  const result = getDashboardExportImages(urls);
  const report = keys.map(function (key, i) {
    const failure = result.failures.filter(function (item) { return item.url === urls[i]; })[0];
    return {icon: key, loaded: !!result.images[urls[i]], error: failure ? failure.message : ''};
  });
  console.log(JSON.stringify(report, null, 2));
  if (result.failures.length) throw new Error(result.failures.length + ' icon(s) failed. See the per-icon errors in the execution log.');
  return report;
}

function dashboardExportDriveId_(url) {
  const value = String(url || '');
  if (!/^https:\/\/(?:drive\.google\.com|lh3\.googleusercontent\.com)\//i.test(value)) return '';
  const match = value.match(/[?&]id=([\w-]{20,})/) || value.match(/\/(?:file\/)?d\/([\w-]{20,})/);
  return match ? match[1] : '';
}
