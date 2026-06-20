import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { FileJson, Upload, ClipboardPaste } from 'lucide-react'
import { tripsApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import { getApiErrorMessage } from '../../types'
import { useToast } from '../shared/Toast'

interface TripImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImported: (trip: any, counts?: Record<string, number>) => void
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

type ImportMode = 'file' | 'paste'

export default function TripImportModal({ isOpen, onClose, onImported }: TripImportModalProps): React.ReactElement | null {
  const { t } = useTranslation()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const validateFile = (f: File): string | null => {
    const ext = f.name.toLowerCase().split('.').pop()
    if (ext !== 'json') return t('dashboard.importJsonUnsupported')
    if (f.size > MAX_FILE_BYTES) return t('dashboard.importJsonTooLarge', { maxMb: 10 })
    return null
  }

  const reset = () => {
    setMode('file')
    setFile(null)
    setPastedText('')
    setIsDragOver(false)
    setLoading(false)
    setError('')
  }

  useEffect(() => {
    if (isOpen) reset()
  }, [isOpen])

  const handleClose = () => {
    if (loading) return
    reset()
    onClose()
  }

  const selectFile = (f: File) => {
    const validationError = validateFile(f)
    if (validationError) {
      setError(validationError)
      setFile(null)
      return
    }
    setFile(f)
    setError('')
  }

  const handlePasteFromClipboard = async () => {
    setError('')
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setError(t('dashboard.importJsonClipboardEmpty'))
        return
      }
      setPastedText(text)
    } catch {
      setError(t('dashboard.importJsonClipboardError'))
    }
  }

  // Build a File from pasted text so we reuse the multipart upload path and
  // bypass the server's small JSON body-parser limit.
  const buildPastedFile = (): File | null => {
    const trimmed = pastedText.trim()
    if (!trimmed) {
      setError(t('dashboard.importJsonPasteEmpty'))
      return null
    }
    try {
      JSON.parse(trimmed)
    } catch {
      setError(t('dashboard.importJsonInvalid'))
      return null
    }
    const blob = new Blob([trimmed], { type: 'application/json' })
    if (blob.size > MAX_FILE_BYTES) {
      setError(t('dashboard.importJsonTooLarge', { maxMb: 10 }))
      return null
    }
    return new File([blob], 'itinerary.json', { type: 'application/json' })
  }

  const handleImport = async () => {
    if (loading) return
    let target = file
    if (mode === 'paste') {
      target = buildPastedFile()
      if (!target) return
    }
    if (!target) return
    setLoading(true)
    setError('')
    try {
      const result = await tripsApi.importJson(target)
      toast.success(t('dashboard.importJsonSuccess', { title: result.trip?.title || t('dashboard.newTrip') }))
      onImported(result.trip, result.counts)
      reset()
      onClose()
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('dashboard.importJsonError'))
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const canImport = !loading && (mode === 'file' ? !!file : !!pastedText.trim())
  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: active ? 'var(--bg-card)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-faint)',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  })

  return ReactDOM.createPortal(
    <div
      onClick={handleClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <FileJson size={18} color="var(--accent)" />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('dashboard.importTripJson')}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 14, lineHeight: 1.45 }}>
          {t('dashboard.importTripJsonHint')}
        </div>

        <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 14, background: 'var(--bg-tertiary)', borderRadius: 10 }}>
          <button type="button" onClick={() => { setMode('file'); setError('') }} style={tabButtonStyle(mode === 'file')}>
            <Upload size={13} /> {t('dashboard.importJsonTabFile')}
          </button>
          <button type="button" onClick={() => { setMode('paste'); setError('') }} style={tabButtonStyle(mode === 'paste')}>
            <ClipboardPaste size={13} /> {t('dashboard.importJsonTabPaste')}
          </button>
        </div>

        {mode === 'file' ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) selectFile(f)
              }}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
              onDragEnter={e => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={e => { if (e.target === e.currentTarget) setIsDragOver(false) }}
              onDrop={e => {
                e.preventDefault()
                setIsDragOver(false)
                const f = e.dataTransfer.files[0]
                if (f) selectFile(f)
              }}
              style={{
                width: '100%', minHeight: 96, borderRadius: 12,
                border: `2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border-primary)'}`,
                background: isDragOver ? 'var(--bg-tertiary)' : 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7,
                fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 12, fontFamily: 'inherit', padding: 16, boxSizing: 'border-box',
              }}
            >
              <Upload size={18} strokeWidth={1.8} color={isDragOver ? 'var(--accent)' : 'var(--text-faint)'} style={{ pointerEvents: 'none' }} />
              {file ? (
                <span style={{ color: 'var(--text-primary)', textAlign: 'center', wordBreak: 'break-all', pointerEvents: 'none' }}>{file.name}</span>
              ) : (
                <span style={{ color: 'var(--text-faint)', textAlign: 'center', pointerEvents: 'none' }}>{t('dashboard.importJsonDropHere')}</span>
              )}
            </div>
          </>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500 }}
              >
                <ClipboardPaste size={13} /> {t('dashboard.importJsonPasteButton')}
              </button>
            </div>
            <textarea
              value={pastedText}
              onChange={e => { setPastedText(e.target.value); setError('') }}
              placeholder={t('dashboard.importJsonPastePlaceholder')}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 180, resize: 'vertical', borderRadius: 12, padding: 12, boxSizing: 'border-box',
                border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5,
              }}
            />
          </div>
        )}

        {error && (
          <div style={{ color: '#ef4444', fontSize: 12, background: 'rgba(239,68,68,0.08)', padding: 10, borderRadius: 8, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-primary)', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!canImport}
            style={{ padding: '9px 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: !canImport ? 'not-allowed' : 'pointer', opacity: !canImport ? 0.6 : 1, fontFamily: 'inherit', fontWeight: 600 }}
          >
            {loading ? t('common.uploading') : t('dashboard.importTrip')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
