// First script in the Android WebView. Deliberately old JavaScript (ES5), so it also runs
// where the app cannot: checks the WebView version, shows errors during start, then loads
// pdf.js and the app bundle.
(function () {
  'use strict';

  var MIN_CHROME = 92;
  var match = /Chrome\/(\d+)/.exec(navigator.userAgent);
  var chrome = match ? parseInt(match[1], 10) : 0;

  function panel(title, lines) {
    var box = document.getElementById('boot-panel');
    if (!box) {
      box = document.createElement('div');
      box.id = 'boot-panel';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;max-height:60%;overflow:auto;'
        + 'background:#2b1d1d;color:#fff;font:15px/1.45 sans-serif;padding:16px 20px;border-top:3px solid #e5484d';
      document.body.appendChild(box);
    }
    var h = document.createElement('strong');
    h.textContent = title;
    h.style.cssText = 'display:block;font-size:17px;margin:4px 0 6px';
    box.appendChild(h);
    for (var i = 0; i < lines.length; i++) {
      var p = document.createElement('div');
      p.textContent = lines[i];
      p.style.margin = '2px 0';
      box.appendChild(p);
    }
  }

  function started() {
    return document.body && document.body.className.indexOf('ready') >= 0;
  }

  if (chrome < MIN_CHROME) {
    document.addEventListener('DOMContentLoaded', function () {
      document.getElementById('app').innerHTML = '';
      panel('Android System WebView ist zu alt', [
        'Notenpult braucht die Version ' + MIN_CHROME + ' oder neuer, hier ist ' + (chrome || 'eine unbekannte') + ' installiert.',
        'So geht es: Play Store öffnen, nach „Android System WebView“ suchen und „Aktualisieren“ tippen '
          + '(unter Android 5 gibt es dort Version 95). Danach Notenpult neu starten.',
        'Deine Daten gehen dabei nicht verloren.',
      ]);
      document.getElementById('boot-panel').style.top = '0';
    });
    return;
  }

  // Errors during start appear on screen (a photo of it helps with fixing); later ones only in the log.
  window.addEventListener('error', function (e) {
    if (started()) return;
    panel('Fehler beim Start', [String(e.message) + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (started()) return;
    var r = e.reason;
    panel('Fehler beim Start', [String(r && r.stack ? r.stack : r).slice(0, 600)]);
  });

  function load(src, next) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = next;
    s.onerror = function () {
      panel('Fehler beim Start', ['Datei fehlt: ' + src]);
    };
    document.head.appendChild(s);
  }

  load('vendor/pdfjs/pdf.min.js', function () {
    load('js/app.js', function () {});
  });
})();
