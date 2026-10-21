import { useRef, useState } from 'react'
import { importLocalData, maxImportBytes, parseLocalDataImport } from './storage'
import type { StorageSchema } from './storage'
import { formatActiveTime } from './goalProgress'

export function DataImport({ onImported }: { onImported: (data: StorageSchema) => void }) {
  const [preview, setPreview] = useState<{ json: string; data: StorageSchema } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selection = useRef(0)

  const selectFile = async (file: File | undefined) => {
    const current = ++selection.current
    setPreview(null)
    setStatus(null)
    if (!file) return
    try {
      if (file.size > maxImportBytes) throw new Error('Choose a JSON export smaller than 10 MB.')
      const json = await file.text()
      const data = parseLocalDataImport(json)
      if (selection.current === current) setPreview({ json, data })
    } catch (error) {
      if (selection.current === current) setStatus(error instanceof Error ? error.message : 'Could not read this file.')
    }
  }

  const replace = async () => {
    if (!preview || busy) return
    setBusy(true)
    setStatus('Importing local data...')
    try {
      const next = await importLocalData(preview.json)
      onImported(next)
      setPreview(null)
      setStatus('Import complete. History and settings were replaced. Tracking will start a new session.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed. Try again.')
    } finally { setBusy(false) }
  }

  return <div className="data-import">
    <p>Import replaces all history, app settings, and path settings on this device. It does not merge time.
      Download an export first if you want to keep a backup.</p>
    <label>Import JSON export <input type="file" accept=".json,application/json" disabled={busy}
      onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
    {preview && <div>
      <p>Ready to replace with {Object.keys(preview.data.dailyActivities).length} saved dates,
        {' '}{formatActiveTime(Object.values(preview.data.dailyActivities).reduce((sum, day) => sum + day.activeSeconds, 0))} total.
        {' '}Timezone: {preview.data.userSettings.timezone}. App and path settings will also be replaced.</p>
      <button type="button" className="danger-button" disabled={busy} onClick={() => { void replace() }}>
        Replace local data with import
      </button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPreview(null); setStatus(null) }}>Cancel import</button>
    </div>}
    {status && <p role="status">{status}</p>}
  </div>
}
