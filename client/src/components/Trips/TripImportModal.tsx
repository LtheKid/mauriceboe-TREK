import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { FileJson, Upload } from 'lucide-react'
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

export default function TripImportModal({ isOpen, onClose, onImported }: TripImportModalProps): React.ReactElement | null {
  const { t } = useTranslation()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
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
    setFile(null)
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

  const handleImport = async () => {
    if (!file || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await tripsApi.importJson(file)
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
            disabled={!file || loading}
            style={{ padding: '9px 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: (!file || loading) ? 'not-allowed' : 'pointer', opacity: (!file || loading) ? 0.6 : 1, fontFamily: 'inherit', fontWeight: 600 }}
          >
            {loading ? t('common.uploading') : t('dashboard.importTrip')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
