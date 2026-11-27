// Stands in for renderer/vendor/pdfjs/pdf.min.mjs in the Android bundle: pdf.js 3.11
// (legacy build, runs on the Chrome 92–95 WebView of Android 5), loaded by boot.js as
// classic script alongside the app – usually it is there before the first PDF is opened.

const loaded = new Promise((resolve) => {
  if (window.pdfjsLib) resolve(window.pdfjsLib);
  else window.__npPdfjsLoaded = () => resolve(window.pdfjsLib);
});

/** Like pdf.js getDocument(); the document loads once pdf.js is there. */
export function getDocument(options) {
  return { promise: loaded.then((lib) => lib.getDocument(options).promise) };
}

// Fonts and character maps are fetched by the page, not inside the worker.
export const docOptions = { useWorkerFetch: false };

/**
 * The worker script is fetched here and started from a blob: requests made inside a
 * worker do not reliably reach MainActivity's shouldInterceptRequest on old WebViews.
 */
export async function setupWorker(vendorUrl) {
  const lib = await loaded;
  const res = await fetch(new URL('pdf.worker.min.js', vendorUrl).href);
  if (!res.ok) throw new Error(`pdf.js-Worker fehlt (${res.status})`);
  const blob = new Blob([await res.text()], { type: 'application/javascript' });
  lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
}
