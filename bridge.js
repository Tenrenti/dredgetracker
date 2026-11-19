/*
 * Dredger Status Map — Apps Script bridge for GitHub Pages.
 *
 * The dashboard was written for Apps Script, where the page talks to the
 * server through google.script.run, google.script.url and
 * google.script.history. On GitHub Pages those do not exist, so this file
 * provides stand-ins with the same names:
 *
 *   google.script.run.getBootstrap(force)          -> GET  API_URL?action=bootstrap
 *   google.script.run.getDashboardExportImages(u)  -> POST API_URL {action:'exportImages'}
 *   google.script.run.getBase64Images(u)           -> same as above (allow-listed images only)
 *   google.script.url.getLocation(cb)              -> reads the address bar
 *   google.script.history.push / replace           -> real browser history, so
 *                                                     share links like
 *                                                     .../#/regionIII/ae keep working
 *
 * The rest of the dashboard code is unchanged.
 * When the same page is opened inside Apps Script, this file does nothing.
 */
(function () {
  'use strict';
  if (window.google && window.google.script) return;   // running inside Apps Script

  var config = window.DASHBOARD_CONFIG || {};
  var API = String(config.API_URL || '').trim();

  function apiReady() {
    return /^https:\/\/script\.google(usercontent)?\.com\/.+/i.test(API);
  }

  function call(action, payload) {
    if (!apiReady()) {
      return Promise.reject(new Error('The data link is not set yet. Open config.js on GitHub and paste your Apps Script web app URL (the one ending in /exec).'));
    }
    var request;
    if (action === 'bootstrap') {
      var url = API + (API.indexOf('?') > -1 ? '&' : '?') + 'action=bootstrap&force=' + (payload.force ? '1' : '0') + '&_=' + Date.now();
      request = fetch(url, {method: 'GET', redirect: 'follow', cache: 'no-store'});
    } else {
      // text/plain keeps this a "simple" request, so the browser does not send
      // a CORS pre-flight that Apps Script cannot answer.
      var body = {action: action};
      Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
      request = fetch(API, {
        method: 'POST', redirect: 'follow', cache: 'no-store',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify(body)
      });
    }
    return request.then(function (response) {
      if (!response.ok) throw new Error('The server answered with HTTP ' + response.status + '.');
      return response.text();
    }, function () {
      throw new Error('Could not reach the Apps Script server. Check your internet connection, and that the web app is deployed with access set to "Anyone".');
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); }
      catch (e) {
        throw new Error('The server did not send dashboard data. Make sure the updated Code.gs is saved, deployed as a NEW version, and that config.js has the /exec link.');
      }
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'The server reported an error.');
      return data.result;
    });
  }

  /* ---- google.script.run stand-in ------------------------------------- */
  function Runner(success, failure) { this._success = success || null; this._failure = failure || null; }
  Runner.prototype.withSuccessHandler = function (fn) { return new Runner(fn, this._failure); };
  Runner.prototype.withFailureHandler = function (fn) { return new Runner(this._success, fn); };
  Runner.prototype.withUserObject = function () { return this; };
  function settle(runner, promise) {
    promise.then(function (value) {
      // setTimeout lets a mistake inside the handler show as a normal error
      // instead of being mistaken for a server failure.
      setTimeout(function () { if (runner._success) runner._success(value); }, 0);
    }, function (error) {
      setTimeout(function () {
        if (runner._failure) runner._failure(error);
        else console.error('[bridge]', error);
      }, 0);
    });
  }
  Runner.prototype.getBootstrap = function (force) {
    settle(this, call('bootstrap', {force: !!force}));
  };
  Runner.prototype.getDashboardExportImages = function (urls) {
    settle(this, call('exportImages', {urls: urls || []}));
  };
  Runner.prototype.getBase64Images = function (urls) {
    settle(this, call('exportImages', {urls: urls || []}).then(function (result) {
      return (result && result.images) || {};
    }));
  };

  /* ---- google.script.url / google.script.history stand-ins ------------ */
  function currentLocation() {
    var parameter = {}, parameters = {};
    new URLSearchParams(window.location.search).forEach(function (value, key) {
      if (!(key in parameter)) parameter[key] = value;
      (parameters[key] = parameters[key] || []).push(value);
    });
    return {hash: window.location.hash.replace(/^#/, ''), parameter: parameter, parameters: parameters};
  }
  function addressFor(hash) {
    var h = String(hash || '').replace(/^#/, '');
    return window.location.pathname + window.location.search + (h ? '#' + h : '');
  }
  var changeHandler = null;
  window.addEventListener('popstate', function (event) {
    if (changeHandler) changeHandler({state: event.state, location: currentLocation()});
  });

  window.google = window.google || {};
  window.google.script = {
    run: new Runner(),
    url: {
      getLocation: function (callback) {
        var loc = currentLocation();
        setTimeout(function () { callback(loc); }, 0);
      }
    },
    history: {
      push: function (state, params, hash) { try { window.history.pushState(state, '', addressFor(hash)); } catch (e) {} },
      replace: function (state, params, hash) { try { window.history.replaceState(state, '', addressFor(hash)); } catch (e) {} },
      setChangeHandler: function (fn) { changeHandler = typeof fn === 'function' ? fn : null; }
    },
    host: { close: function () {}, setHeight: function () {}, setWidth: function () {} }
  };
  window.google.script.__githubBridge = true;
})();
