import React, { useState } from 'react'
import Modal from '../shared/Modal'
import { tripsApi } from '../../api/client'
import { useToast } from '../shared/Toast'

interface JsonImportModalProps {
  isOpen: boolean
  onClose: () => void
  tripId: number
  onSuccess: (stats: {
    categories: number
    days: number
    places: number
    assignments: number
    notes: number
    reservations: number
  }) => void
}

export default function JsonImportModal({ isOpen, onClose, tripId, onSuccess }: JsonImportModalProps) {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleImport = async () => {
    setError(null)
    setLoading(true)

    try {
      const data = JSON.parse(jsonText)
      const result = await tripsApi.importJson(tripId, data)

      if (result.success) {
        onSuccess(result.stats)
        toast.success('Trip imported successfully')
        setJsonText('')
        onClose()
      } else {
        setError(result.errors.join('\n'))
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON format. Please check your JSON syntax.')
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An unexpected error occurred')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setJsonText('')
    setError(null)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import JSON Itinerary" size="lg">
      <div style={{ padding: '16px' }}>
        <p style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-primary)' }}>
          Paste your JSON itinerary below. The format should include trip details, days, places, assignments, notes, and reservations.
        </p>

        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder='{
  "trip": {
    "title": "Tokyo Adventure",
    "start_date": "2026-07-01",
    "end_date": "2026-07-07"
  },
  "days": [...],
  "places": [...],
  "assignments": [...],
  "notes": [...],
  "reservations": [...]
}'
          style={{
            width: '100%',
            height: '400px',
            padding: '12px',
            border: '1px solid var(--border-primary)',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '13px',
            resize: 'vertical',
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)'
          }}
          disabled={loading}
        />

        {error && (
          <div
            style={{
              marginTop: '12px',
              padding: '12px',
              background: 'var(--bg-error)',
              borderRadius: '8px',
              color: 'var(--text-error)',
              fontSize: '13px',
              whiteSpace: 'pre-wrap',
              border: '1px solid var(--border-error)'
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={handleClose}
            disabled={loading}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--border-primary)',
              borderRadius: '8px',
              background: 'none',
              color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={loading || !jsonText.trim()}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '8px',
              background: loading || !jsonText.trim() ? 'var(--bg-disabled)' : 'var(--accent)',
              color: loading || !jsonText.trim() ? 'var(--text-disabled)' : 'var(--accent-text)',
              cursor: loading || !jsonText.trim() ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            {loading ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
