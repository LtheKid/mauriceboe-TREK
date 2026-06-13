import { db } from '../db/database'
import { buildDedupSet, isPlaceDuplicate, trackInsertedInDedupSet } from './placeService'

interface ImportTripData {
  title?: string
  description?: string
  start_date?: string
  end_date?: string
  currency?: string
}

interface ImportCategory {
  name: string
  color?: string
}

interface ImportDay {
  number: number
  date?: string
  title?: string
}

interface ImportPlace {
  ref: string
  name: string
  lat: number
  lng: number
  category?: string
  address?: string
  description?: string
  website?: string
  notes?: string
  price?: number
  place_time?: string
  end_time?: string
}

interface ImportAssignment {
  place_ref: string
  day_number: number
  time?: string
  end_time?: string
  order?: number
  notes?: string
}

interface ImportNote {
  day_number: number
  time?: string
  text: string
  icon?: string
}

interface ImportEndpoint {
  role: string
  sequence: number
  name: string
  code?: string
  lat: number
  lng: number
  timezone?: string
}

interface ImportReservation {
  title: string
  type: string
  day_number?: number
  reservation_time?: string
  reservation_end_time?: string
  status?: string
  confirmation_number?: string
  location?: string
  notes?: string
  metadata?: Record<string, string>
  endpoints?: ImportEndpoint[]
}

interface ImportJsonSchema {
  trip?: ImportTripData
  categories?: ImportCategory[]
  days?: ImportDay[]
  places?: ImportPlace[]
  assignments?: ImportAssignment[]
  notes?: ImportNote[]
  reservations?: ImportReservation[]
}

interface ImportStats {
  categories: number
  days: number
  places: number
  assignments: number
  notes: number
  reservations: number
}

export function validateImportJson(data: unknown): { valid: true; data: ImportJsonSchema } | { valid: false; errors: string[] } {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid JSON structure'] }
  }

  const schema = data as ImportJsonSchema

  // Validate places have unique refs
  if (schema.places && Array.isArray(schema.places)) {
    const refs = new Set<string>()
    for (const place of schema.places) {
      if (!place.ref) {
        errors.push('Place missing ref field')
      } else if (refs.has(place.ref)) {
        errors.push(`Duplicate place ref: ${place.ref}`)
      } else {
        refs.add(place.ref)
      }
      if (!place.name) errors.push(`Place ${place.ref || '?'} missing name`)
      if (typeof place.lat !== 'number') errors.push(`Place ${place.ref || '?'} invalid lat`)
      if (typeof place.lng !== 'number') errors.push(`Place ${place.ref || '?'} invalid lng`)
    }
  }

  // Validate days have unique numbers
  if (schema.days && Array.isArray(schema.days)) {
    const numbers = new Set<number>()
    for (const day of schema.days) {
      if (typeof day.number !== 'number') {
        errors.push('Day missing number field')
      } else if (numbers.has(day.number)) {
        errors.push(`Duplicate day number: ${day.number}`)
      } else {
        numbers.add(day.number)
      }
    }
  }

  // Validate assignments reference existing refs and days
  if (schema.assignments && Array.isArray(schema.assignments)) {
    const placeRefs = new Set(schema.places?.map(p => p.ref) || [])
    const dayNumbers = new Set(schema.days?.map(d => d.number) || [])

    for (const assignment of schema.assignments) {
      if (!assignment.place_ref) {
        errors.push('Assignment missing place_ref')
      } else if (!placeRefs.has(assignment.place_ref)) {
        errors.push(`Assignment references unknown place: ${assignment.place_ref}`)
      }
      if (typeof assignment.day_number !== 'number') {
        errors.push('Assignment missing day_number')
      } else if (!dayNumbers.has(assignment.day_number)) {
        errors.push(`Assignment references unknown day: ${assignment.day_number}`)
      }
    }
  }

  // Validate notes reference existing days
  if (schema.notes && Array.isArray(schema.notes)) {
    const dayNumbers = new Set(schema.days?.map(d => d.number) || [])

    for (const note of schema.notes) {
      if (typeof note.day_number !== 'number') {
        errors.push('Note missing day_number')
      } else if (!dayNumbers.has(note.day_number)) {
        errors.push(`Note references unknown day: ${note.day_number}`)
      }
      if (!note.text) errors.push(`Note for day ${note.day_number || '?'} missing text`)
    }
  }

  // Validate reservations
  if (schema.reservations && Array.isArray(schema.reservations)) {
    const dayNumbers = new Set(schema.days?.map(d => d.number) || [])

    for (const res of schema.reservations) {
      if (!res.title) errors.push('Reservation missing title')
      if (!res.type) errors.push(`Reservation "${res.title || '?'}" missing type`)
      if (res.day_number !== undefined && !dayNumbers.has(res.day_number)) {
        errors.push(`Reservation "${res.title}" references unknown day: ${res.day_number}`)
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, data: schema }
}

export function importTripFromJson(
  tripId: number,
  userId: number,
  data: ImportJsonSchema
): { success: true; stats: ImportStats } | { success: false; errors: string[] } {
  const validation = validateImportJson(data)
  if (!validation.valid) {
    return { success: false, errors: validation.errors }
  }

  const stats: ImportStats = {
    categories: 0,
    days: 0,
    places: 0,
    assignments: 0,
    notes: 0,
    reservations: 0
  }

  const importTransaction = db.transaction(() => {
    // Step 1: Create or reuse categories
    const categoryMap = new Map<string, number>()
    for (const cat of data.categories || []) {
      const existing = db.prepare(
        'SELECT id FROM categories WHERE name = ? AND (user_id = ? OR user_id IS NULL)'
      ).get(cat.name, userId) as { id: number } | undefined

      if (existing) {
        categoryMap.set(cat.name, existing.id)
      } else {
        const result = db.prepare(
          'INSERT INTO categories (name, color, user_id) VALUES (?, ?, ?)'
        ).run(cat.name, cat.color || '#6366f1', userId)
        categoryMap.set(cat.name, result.lastInsertRowid as number)
        stats.categories++
      }
    }

    // Step 2: Create or reuse days
    const dayMap = new Map<number, number>()
    for (const day of data.days || []) {
      if (day.date) {
        const existing = db.prepare(
          'SELECT id FROM days WHERE trip_id = ? AND date = ?'
        ).get(tripId, day.date) as { id: number } | undefined

        if (existing) {
          dayMap.set(day.number, existing.id)
          if (day.title) {
            db.prepare('UPDATE days SET title = ? WHERE id = ?').run(day.title, existing.id)
          }
          continue
        }
      }

      const result = db.prepare(
        'INSERT INTO days (trip_id, day_number, date, title) VALUES (?, ?, ?, ?)'
      ).run(tripId, day.number, day.date || null, day.title || null)
      dayMap.set(day.number, result.lastInsertRowid as number)
      stats.days++
    }

    // Step 3: Create places with deduplication
    const placeMap = new Map<string, number>()
    const dedup = buildDedupSet(tripId)

    for (const place of data.places || []) {
      if (isPlaceDuplicate(place, dedup)) {
        const existing = db.prepare(
          'SELECT id FROM places WHERE trip_id = ? AND name = ?'
        ).get(tripId, place.name) as { id: number } | undefined

        if (existing) {
          placeMap.set(place.ref, existing.id)
        }
        continue
      }

      const categoryId = place.category ? categoryMap.get(place.category) : null

      const result = db.prepare(`
        INSERT INTO places (trip_id, name, lat, lng, category_id, address, description, website, notes, price, place_time, end_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tripId,
        place.name,
        place.lat,
        place.lng,
        categoryId || null,
        place.address || null,
        place.description || null,
        place.website || null,
        place.notes || null,
        place.price || null,
        place.place_time || null,
        place.end_time || null
      )

      placeMap.set(place.ref, result.lastInsertRowid as number)
      trackInsertedInDedupSet(place, dedup)
      stats.places++
    }

    // Step 4: Create assignments
    for (const assignment of data.assignments || []) {
      const placeId = placeMap.get(assignment.place_ref)
      const dayId = dayMap.get(assignment.day_number)

      if (!placeId || !dayId) continue

      db.prepare(`
        INSERT INTO day_assignments (day_id, place_id, order_index, assignment_time, assignment_end_time, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        dayId,
        placeId,
        assignment.order || 0,
        assignment.time || null,
        assignment.end_time || null,
        assignment.notes || null
      )
      stats.assignments++
    }

    // Step 5: Create day notes
    for (const note of data.notes || []) {
      const dayId = dayMap.get(note.day_number)
      if (!dayId) continue

      db.prepare(`
        INSERT INTO day_notes (day_id, trip_id, text, time, icon)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        dayId,
        tripId,
        note.text,
        note.time || null,
        note.icon || '📝'
      )
      stats.notes++
    }

    // Step 6: Create reservations with endpoints
    for (const res of data.reservations || []) {
      const dayId = res.day_number ? dayMap.get(res.day_number) : null
      const metadataJson = res.metadata ? JSON.stringify(res.metadata) : null

      const result = db.prepare(`
        INSERT INTO reservations (trip_id, day_id, title, type, reservation_time, reservation_end_time, status, confirmation_number, location, notes, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tripId,
        dayId || null,
        res.title,
        res.type,
        res.reservation_time || null,
        res.reservation_end_time || null,
        res.status || 'pending',
        res.confirmation_number || null,
        res.location || null,
        res.notes || null,
        metadataJson
      )

      const reservationId = result.lastInsertRowid as number

      // Create endpoints if provided
      for (const endpoint of res.endpoints || []) {
        db.prepare(`
          INSERT INTO reservation_endpoints (reservation_id, role, sequence, name, code, lat, lng, timezone)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          reservationId,
          endpoint.role,
          endpoint.sequence,
          endpoint.name,
          endpoint.code || null,
          endpoint.lat,
          endpoint.lng,
          endpoint.timezone || null
        )
      }

      stats.reservations++
    }
  })

  try {
    importTransaction()
    return { success: true, stats }
  } catch (err: any) {
    return { success: false, errors: [err.message || 'Import failed'] }
  }
}
