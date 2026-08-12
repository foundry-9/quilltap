/**
 * @jest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from '@jest/globals'

/**
 * PDF.js compares the API and worker build versions on worker setup and throws
 * `The API version "x" does not match the Worker version "y"` when they differ.
 * FilePreviewPdf serves the worker from public/pdf.worker.mjs, so that copy has
 * to track the installed pdfjs-dist exactly.
 *
 * The failure mode is silent: the throw lands in the component's catch and the
 * user just sees "Failed to load PDF. Try downloading instead." scripts/sync-pdf-worker.js
 * keeps the copy current on postinstall; this test is the backstop that fails
 * loudly if it is ever bypassed.
 */

const root = process.cwd()
const publicWorker = path.join(root, 'public', 'pdf.worker.mjs')
const installedWorker = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs')
const installedApi = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs')

function readWorkerVersion(file: string): string | null {
  const match = fs.readFileSync(file, 'utf-8').match(/const workerVersion = "([^"]+)"/)
  return match ? match[1] : null
}

function readApiVersion(file: string): string | null {
  const match = fs.readFileSync(file, 'utf-8').match(/apiVersion: "([^"]+)"/)
  return match ? match[1] : null
}

describe('public/pdf.worker.mjs', () => {
  it('is present', () => {
    expect(fs.existsSync(publicWorker)).toBe(true)
  })

  it('matches the installed pdfjs-dist worker version', () => {
    const served = readWorkerVersion(publicWorker)
    const installed = readWorkerVersion(installedWorker)

    expect(served).not.toBeNull()
    expect(installed).not.toBeNull()
    expect(served).toBe(installed)
  })

  it('matches the API version the app loads', () => {
    // The mismatch PDF.js actually enforces is API-vs-worker, so assert that
    // pairing directly rather than trusting the two workers to agree.
    expect(readWorkerVersion(publicWorker)).toBe(readApiVersion(installedApi))
  })

  it('is the worker FilePreviewPdf points at', () => {
    const component = fs.readFileSync(
      path.join(root, 'components', 'files', 'FilePreview', 'FilePreviewPdf.tsx'),
      'utf-8',
    )

    // If this moves, the invariant above needs to follow it.
    expect(component).toContain("GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'")
  })
})
