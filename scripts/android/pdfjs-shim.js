// Stands in for renderer/vendor/pdfjs/pdf.min.mjs in the Android bundle: pdf.js 3.11
// (legacy build, runs on the Chrome 92–95 WebView of Android 5), loaded by boot.js as
// classic script before the app.

const lib = window.pdfjsLib;

export const { getDocument, GlobalWorkerOptions } = lib;

// Fonts and character maps are fetched by the page, not inside the worker.
export const docOptions = { useWorkerFetch: false };

/**
 * The worker script is fetched here and started from a blob: requests made inside a
 * worker do not reliably reach MainActivity's shouldInterceptRequest on old WebViews.
 */
export async function setupWorker(vendorUrl) {
  const res = await fetch(new URL('pdf.worker.min.js', vendorUrl).href);
  if (!res.ok) throw new Error(`pdf.js-Worker fehlt (${res.status})`);
  const blob = new Blob([await res.text()], { type: 'application/javascript' });
  GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
}
