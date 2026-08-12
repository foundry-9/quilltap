#!/usr/bin/env node
// PDF.js refuses to run when the API and worker builds disagree — the worker
// compares the two version strings on setup and throws
// `The API version "x" does not match the Worker version "y"`.
//
// components/files/FilePreview/FilePreviewPdf.tsx loads the worker from
// /pdf.worker.mjs, so public/pdf.worker.mjs has to track whatever pdfjs-dist
// version is installed. It used to be hand-copied, which meant every pdfjs-dist
// bump silently broke PDF preview: the throw lands in the component's catch and
// surfaces only as "Failed to load PDF. Try downloading instead."
//
// This runs on postinstall. When the versions already agree it's a no-op; when
// they don't it re-copies, and because public/pdf.worker.mjs is checked in the
// update shows up as a git diff rather than drifting unnoticed.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs');
const DEST = path.join(ROOT, 'public', 'pdf.worker.mjs');

// pdfjs-dist is a normal dependency, but postinstall also runs in trees where
// it hasn't been placed yet (or was pruned). Nothing to sync then.
if (!fs.existsSync(SOURCE)) {
  process.exit(0);
}

function workerVersion(file) {
  try {
    const match = fs.readFileSync(file, 'utf-8').match(/const workerVersion = "([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const sourceVersion = workerVersion(SOURCE);
const destVersion = fs.existsSync(DEST) ? workerVersion(DEST) : null;

if (sourceVersion && sourceVersion === destVersion) {
  process.exit(0);
}

try {
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.copyFileSync(SOURCE, DEST);
} catch (err) {
  // Don't fail the install over this — a read-only or sandboxed tree still
  // installs fine, and the mismatch is loud enough at build and test time.
  console.warn(`[pdf-worker] could not sync public/pdf.worker.mjs: ${err.message}`);
  process.exit(0);
}

console.log(
  `[pdf-worker] synced public/pdf.worker.mjs ${destVersion ?? '(missing)'} -> ${sourceVersion ?? '(unknown)'}`,
);
