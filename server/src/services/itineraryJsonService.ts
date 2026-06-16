import { db } from '../db/database';
import { NotFoundError, TRIP_SELECT, ValidationError } from './tripService';

const SCHEMA_VERSION = 'trek-itinerary-v1';
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_DAYS = 365;

const toArray = (value: any): any[] => Array.isArray(value) ? value : [];
const toStringOrNull = (value: any): string | null => value === undefined || value === null || value === '' ? null : String(value);
const toNumberOrNull = (value: any): number | null => value === undefined || value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value);
const toIntOrNull = (value: any): number | null => value === undefined || value === null || value === '' || Number.isNaN(parseInt(String(value), 10)) ? null : parseInt(String(value), 10);
const toBoolInt = (value: any): number => value === true || value === 1 || value === '1' ? 1 : 0;

function makeRef(prefix: string, id: any, fallback?: any): string {
  const raw = id ?? fallback;
  return `${prefix}-${String(raw ?? '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function safeFilename(title: string | null | undefined): string {
  return (title || 'trek-trip').replace(/["\r\n]/g, '').replace(/[^\w\s.-]/g, '_');
}

function parseJsonMaybe(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function stringifyMetadata(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function keyFor(item: any, fallback: string | number): string {
  return String(item?.ref ?? item?.id ?? fallback);
}

function dayLookupKeys(day: any): string[] {
  return [day.ref, day.id, day.day_number, day.dayNumber, day.date].filter(v => v !== undefined && v !== null && v !== '').map(String);
}

function resolveMappedId(map: Map<string, number>, value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  return map.get(String(value)) ?? null;
}

function requireMappedId(map: Map<string, number>, value: any, label: string): number {
  const resolved = resolveMappedId(map, value);
  if (!resolved) throw new ValidationError(`Invalid ${label} reference: ${value}`);
  return resolved;
}

function getCategoryId(userId: number, category: any, legacyCategoryId: any): number | null {
  if (!category && !legacyCategoryId) return null;
  if (!category || typeof category !== 'object') return toIntOrNull(legacyCategoryId);
  const name = toStringOrNull(category.name);
  if (!name) return toIntOrNull(legacyCategoryId);

  const existing = db.prepare(`
    SELECT id FROM categories
    WHERE lower(name) = lower(?) AND (user_id = ? OR user_id IS NULL)
    ORDER BY user_id IS NULL DESC, id ASC
    LIMIT 1
  `).get(name, userId) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db.prepare('INSERT INTO categories (name, color, icon, user_id) VALUES (?, ?, ?, ?)')
    .run(name, toStringOrNull(category.color) || '#6366f1', toStringOrNull(category.icon) || '📍', userId);
  return Number(result.lastInsertRowid);
}

function getTagId(userId: number, tag: any): number | null {
  const name = typeof tag === 'string' ? tag : toStringOrNull(tag?.name);
  if (!name) return null;

  const existing = db.prepare('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1')
    .get(userId, name) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db.prepare('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)')
    .run(userId, name, typeof tag === 'object' ? (toStringOrNull(tag.color) || '#10b981') : '#10b981');
  return Number(result.lastInsertRowid);
}

function validatePayload(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Import file must contain a JSON object');
  }
  const schema = payload.schemaVersion || payload.schema_version || payload.schema;
  const version = payload.version;
  if (schema && schema !== SCHEMA_VERSION && schema !== 'trek.itinerary') {
    throw new ValidationError(`Unsupported itinerary schema: ${schema}`);
  }
  if (version && Number(version) !== 1) {
    throw new ValidationError(`Unsupported itinerary version: ${version}`);
  }
  if (!payload.trip || typeof payload.trip !== 'object') {
    throw new ValidationError('Itinerary JSON must include a trip object');
  }
  if (!toStringOrNull(payload.trip.title || payload.trip.name)) {
    throw new ValidationError('Trip title is required');
  }
  const days = toArray(payload.days);
  if (days.length > MAX_IMPORT_DAYS) {
    throw new ValidationError(`Trips can contain at most ${MAX_IMPORT_DAYS} days`);
  }
}

export function parseItineraryJsonUpload(file: Express.Multer.File | undefined, body: any): any {
  if (file) {
    if (file.size > MAX_IMPORT_BYTES) throw new ValidationError('JSON file is too large');
    try { return JSON.parse(file.buffer.toString('utf8')); } catch { throw new ValidationError('Invalid JSON file'); }
  }
  if (body?.itinerary) {
    if (typeof body.itinerary === 'string') {
      try { return JSON.parse(body.itinerary); } catch { throw new ValidationError('Invalid itinerary JSON'); }
    }
    return body.itinerary;
  }
  return body;
}

export function exportItineraryJson(tripId: string | number, userId: number) {
  const trip = db.prepare(`${TRIP_SELECT} WHERE t.id = :tripId`).get({ userId, tripId }) as any;
  if (!trip) throw new NotFoundError('Trip not found');

  const days = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId) as any[];
  const places = db.prepare(`
    SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM places p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.trip_id = ?
    ORDER BY p.created_at ASC, p.id ASC
  `).all(tripId) as any[];
  const placeTags = db.prepare(`
    SELECT pt.place_id, t.id, t.name, t.color
    FROM place_tags pt
    JOIN tags t ON t.id = pt.tag_id
    JOIN places p ON p.id = pt.place_id
    WHERE p.trip_id = ?
    ORDER BY t.name ASC
  `).all(tripId) as any[];
  const tagsByPlace = new Map<number, any[]>();
  for (const tag of placeTags) {
    const list = tagsByPlace.get(tag.place_id) || [];
    list.push({ id: tag.id, name: tag.name, color: tag.color });
    tagsByPlace.set(tag.place_id, list);
  }

  const assignments = db.prepare(`
    SELECT da.* FROM day_assignments da
    JOIN days d ON d.id = da.day_id
    WHERE d.trip_id = ?
    ORDER BY d.day_number ASC, da.order_index ASC, da.created_at ASC
  `).all(tripId) as any[];
  const dayNotes = db.prepare('SELECT * FROM day_notes WHERE trip_id = ? ORDER BY day_id ASC, sort_order ASC, created_at ASC').all(tripId) as any[];
  const accommodations = db.prepare('SELECT * FROM day_accommodations WHERE trip_id = ? ORDER BY created_at ASC, id ASC').all(tripId) as any[];
  const reservations = db.prepare('SELECT * FROM reservations WHERE trip_id = ? ORDER BY reservation_time ASC, created_at ASC, id ASC').all(tripId) as any[];
  const endpoints = db.prepare(`
    SELECT e.* FROM reservation_endpoints e
    JOIN reservations r ON r.id = e.reservation_id
    WHERE r.trip_id = ?
    ORDER BY e.reservation_id ASC, e.sequence ASC
  `).all(tripId) as any[];
  const positions = db.prepare(`
    SELECT rdp.* FROM reservation_day_positions rdp
    JOIN reservations r ON r.id = rdp.reservation_id
    WHERE r.trip_id = ?
  `).all(tripId) as any[];

  const endpointsByReservation = new Map<number, any[]>();
  for (const endpoint of endpoints) {
    const list = endpointsByReservation.get(endpoint.reservation_id) || [];
    list.push({
      role: endpoint.role,
      sequence: endpoint.sequence,
      name: endpoint.name,
      code: endpoint.code,
      lat: endpoint.lat,
      lng: endpoint.lng,
      timezone: endpoint.timezone,
      local_time: endpoint.local_time,
      local_date: endpoint.local_date,
    });
    endpointsByReservation.set(endpoint.reservation_id, list);
  }

  const positionsByReservation = new Map<number, Record<string, number>>();
  for (const position of positions) {
    const map = positionsByReservation.get(position.reservation_id) || {};
    map[String(position.day_id)] = position.position;
    positionsByReservation.set(position.reservation_id, map);
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    exportedAt: new Date().toISOString(),
    source: { app: 'TREK', tripId: trip.id },
    trip: {
      title: trip.title,
      description: trip.description,
      start_date: trip.start_date,
      end_date: trip.end_date,
      currency: trip.currency,
      reminder_days: trip.reminder_days,
      day_count: trip.day_count,
    },
    days: days.map(d => ({
      id: d.id,
      ref: makeRef('day', d.id, d.day_number),
      day_number: d.day_number,
      date: d.date,
      title: d.title,
      notes: d.notes,
    })),
    places: places.map(p => ({
      id: p.id,
      ref: makeRef('place', p.id, p.name),
      name: p.name,
      description: p.description,
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      category: p.category_id ? { id: p.category_id, name: p.category_name, color: p.category_color, icon: p.category_icon } : null,
      tags: tagsByPlace.get(p.id) || [],
      price: p.price,
      currency: p.currency,
      reservation_status: p.reservation_status,
      reservation_notes: p.reservation_notes,
      reservation_datetime: p.reservation_datetime,
      place_time: p.place_time,
      end_time: p.end_time,
      duration_minutes: p.duration_minutes,
      notes: p.notes,
      image_url: p.image_url,
      google_place_id: p.google_place_id,
      osm_id: p.osm_id,
      route_geometry: p.route_geometry,
      website: p.website,
      phone: p.phone,
      transport_mode: p.transport_mode,
    })),
    assignments: assignments.map(a => ({
      id: a.id,
      ref: makeRef('assignment', a.id),
      day_id: a.day_id,
      day_ref: makeRef('day', a.day_id),
      place_id: a.place_id,
      place_ref: makeRef('place', a.place_id),
      order_index: a.order_index,
      notes: a.notes,
      reservation_status: a.reservation_status,
      reservation_notes: a.reservation_notes,
      reservation_datetime: a.reservation_datetime,
      assignment_time: a.assignment_time,
      assignment_end_time: a.assignment_end_time,
    })),
    day_notes: dayNotes.map(n => ({
      id: n.id,
      day_id: n.day_id,
      day_ref: makeRef('day', n.day_id),
      text: n.text,
      time: n.time,
      icon: n.icon,
      sort_order: n.sort_order,
    })),
    accommodations: accommodations.map(a => ({
      id: a.id,
      ref: makeRef('accommodation', a.id),
      place_id: a.place_id,
      place_ref: a.place_id ? makeRef('place', a.place_id) : null,
      start_day_id: a.start_day_id,
      start_day_ref: makeRef('day', a.start_day_id),
      end_day_id: a.end_day_id,
      end_day_ref: makeRef('day', a.end_day_id),
      check_in: a.check_in,
      check_in_end: a.check_in_end,
      check_out: a.check_out,
      confirmation: a.confirmation,
      notes: a.notes,
    })),
    reservations: reservations.map(r => ({
      id: r.id,
      ref: makeRef('reservation', r.id),
      day_id: r.day_id,
      day_ref: r.day_id ? makeRef('day', r.day_id) : null,
      end_day_id: r.end_day_id,
      end_day_ref: r.end_day_id ? makeRef('day', r.end_day_id) : null,
      place_id: r.place_id,
      place_ref: r.place_id ? makeRef('place', r.place_id) : null,
      assignment_id: r.assignment_id,
      assignment_ref: r.assignment_id ? makeRef('assignment', r.assignment_id) : null,
      accommodation_id: r.accommodation_id,
      accommodation_ref: r.accommodation_id ? makeRef('accommodation', r.accommodation_id) : null,
      title: r.title,
      reservation_time: r.reservation_time,
      reservation_end_time: r.reservation_end_time,
      location: r.location,
      confirmation_number: r.confirmation_number,
      notes: r.notes,
      status: r.status,
      type: r.type,
      metadata: parseJsonMaybe(r.metadata),
      needs_review: !!r.needs_review,
      day_plan_position: r.day_plan_position,
      day_positions: positionsByReservation.get(r.id) || null,
      endpoints: endpointsByReservation.get(r.id) || [],
    })),
  };

  return { payload, filename: `${safeFilename(trip.title)}.trek.json` };
}

export function importItineraryJson(userId: number, payload: any) {
  validatePayload(payload);
  const tripPayload = payload.trip;
  const daysPayload = toArray(payload.days);
  const placesPayload = toArray(payload.places);
  const flatAssignmentsPayload = toArray(payload.assignments);
  const embeddedAssignments = daysPayload.flatMap((day, dayIndex) =>
    toArray(day.schedule || day.assignments).map((item, itemIndex) => ({
      ...item,
      day_ref: item.day_ref ?? item.dayRef ?? item.day_id ?? item.dayId ?? day.ref ?? day.id ?? day.day_number ?? day.dayNumber ?? dayIndex + 1,
      order_index: item.order_index ?? item.orderIndex ?? itemIndex,
    }))
  );
  const assignmentsPayload = [...flatAssignmentsPayload, ...embeddedAssignments];
  const dayNotesPayload = [
    ...toArray(payload.day_notes || payload.dayNotes),
    ...daysPayload.flatMap((day, dayIndex) => toArray(day.notes_items || day.note_items).map((note, noteIndex) => ({
      ...note,
      day_ref: note.day_ref ?? note.dayRef ?? note.day_id ?? note.dayId ?? day.ref ?? day.id ?? day.day_number ?? day.dayNumber ?? dayIndex + 1,
    }))),
  ];
  const accommodationsPayload = toArray(payload.accommodations);
  const reservationsPayload = toArray(payload.reservations);

  const fn = db.transaction(() => {
    const title = toStringOrNull(tripPayload.title || tripPayload.name)!;
    const tripResult = db.prepare(`
      INSERT INTO trips (user_id, title, description, start_date, end_date, currency, is_archived, reminder_days)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      userId,
      title,
      toStringOrNull(tripPayload.description),
      toStringOrNull(tripPayload.start_date || tripPayload.startDate),
      toStringOrNull(tripPayload.end_date || tripPayload.endDate),
      toStringOrNull(tripPayload.currency) || 'EUR',
      toIntOrNull(tripPayload.reminder_days ?? tripPayload.reminderDays) ?? 3,
    );
    const newTripId = Number(tripResult.lastInsertRowid);

    const dayMap = new Map<string, number>();
    const insertDay = db.prepare('INSERT INTO days (trip_id, day_number, date, notes, title) VALUES (?, ?, ?, ?, ?)');
    const normalizedDays = daysPayload.length > 0 ? daysPayload : Array.from({ length: Math.max(1, Math.min(MAX_IMPORT_DAYS, toIntOrNull(tripPayload.day_count ?? tripPayload.dayCount) || 7)) }, (_, i) => ({ day_number: i + 1 }));
    normalizedDays.forEach((day, index) => {
      const dayNumber = toIntOrNull(day.day_number ?? day.dayNumber) ?? index + 1;
      const result = insertDay.run(newTripId, dayNumber, toStringOrNull(day.date), typeof day.notes === 'string' ? day.notes : null, toStringOrNull(day.title));
      const newDayId = Number(result.lastInsertRowid);
      dayLookupKeys({ ...day, day_number: dayNumber }).forEach(k => dayMap.set(k, newDayId));
      dayMap.set(makeRef('day', day.id ?? newDayId, dayNumber), newDayId);
      dayMap.set(String(dayNumber), newDayId);
      if (day.date) dayMap.set(String(day.date), newDayId);
    });

    const placeMap = new Map<string, number>();
    const insertPlace = db.prepare(`
      INSERT INTO places (trip_id, name, description, lat, lng, address, category_id, price, currency,
        reservation_status, reservation_notes, reservation_datetime, place_time, end_time, duration_minutes,
        notes, image_url, google_place_id, osm_id, route_geometry, website, phone, transport_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPlaceTag = db.prepare('INSERT OR IGNORE INTO place_tags (place_id, tag_id) VALUES (?, ?)');
    placesPayload.forEach((place, index) => {
      const name = toStringOrNull(place.name || place.title);
      if (!name) throw new ValidationError(`Place at index ${index + 1} is missing a name`);
      const categoryId = getCategoryId(userId, place.category, place.category_id ?? place.categoryId);
      const result = insertPlace.run(
        newTripId,
        name,
        toStringOrNull(place.description),
        toNumberOrNull(place.lat ?? place.latitude),
        toNumberOrNull(place.lng ?? place.longitude),
        toStringOrNull(place.address),
        categoryId,
        toNumberOrNull(place.price),
        toStringOrNull(place.currency),
        toStringOrNull(place.reservation_status ?? place.reservationStatus) || 'none',
        toStringOrNull(place.reservation_notes ?? place.reservationNotes),
        toStringOrNull(place.reservation_datetime ?? place.reservationDateTime),
        toStringOrNull(place.place_time ?? place.time),
        toStringOrNull(place.end_time ?? place.endTime),
        toIntOrNull(place.duration_minutes ?? place.durationMinutes) ?? 60,
        toStringOrNull(place.notes),
        toStringOrNull(place.image_url ?? place.imageUrl),
        toStringOrNull(place.google_place_id ?? place.googlePlaceId),
        toStringOrNull(place.osm_id ?? place.osmId),
        toStringOrNull(place.route_geometry ?? place.routeGeometry),
        toStringOrNull(place.website),
        toStringOrNull(place.phone),
        toStringOrNull(place.transport_mode ?? place.transportMode) || 'walking',
      );
      const newPlaceId = Number(result.lastInsertRowid);
      [place.ref, place.id, name, makeRef('place', place.id ?? newPlaceId, name)].filter(Boolean).forEach(k => placeMap.set(String(k), newPlaceId));
      toArray(place.tags).forEach(tag => {
        const tagId = getTagId(userId, tag);
        if (tagId) insertPlaceTag.run(newPlaceId, tagId);
      });
    });

    const assignmentMap = new Map<string, number>();
    const insertAssignment = db.prepare(`
      INSERT INTO day_assignments (day_id, place_id, order_index, notes, reservation_status, reservation_notes, reservation_datetime, assignment_time, assignment_end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    assignmentsPayload.forEach((assignment, index) => {
      const dayRef = assignment.day_ref ?? assignment.dayRef ?? assignment.day_id ?? assignment.dayId ?? assignment.day;
      const placeRef = assignment.place_ref ?? assignment.placeRef ?? assignment.place_id ?? assignment.placeId ?? assignment.place;
      const newDayId = requireMappedId(dayMap, dayRef, `assignment day at index ${index + 1}`);
      const newPlaceId = requireMappedId(placeMap, placeRef, `assignment place at index ${index + 1}`);
      const result = insertAssignment.run(
        newDayId,
        newPlaceId,
        toIntOrNull(assignment.order_index ?? assignment.orderIndex) ?? index,
        toStringOrNull(assignment.notes),
        toStringOrNull(assignment.reservation_status ?? assignment.reservationStatus) || 'none',
        toStringOrNull(assignment.reservation_notes ?? assignment.reservationNotes),
        toStringOrNull(assignment.reservation_datetime ?? assignment.reservationDateTime),
        toStringOrNull(assignment.assignment_time ?? assignment.time),
        toStringOrNull(assignment.assignment_end_time ?? assignment.endTime ?? assignment.end_time),
      );
      const newAssignmentId = Number(result.lastInsertRowid);
      [assignment.ref, assignment.id, makeRef('assignment', assignment.id ?? newAssignmentId)].filter(Boolean).forEach(k => assignmentMap.set(String(k), newAssignmentId));
    });

    const insertNote = db.prepare('INSERT INTO day_notes (day_id, trip_id, text, time, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    dayNotesPayload.forEach((note, index) => {
      const dayRef = note.day_ref ?? note.dayRef ?? note.day_id ?? note.dayId ?? note.day;
      const newDayId = requireMappedId(dayMap, dayRef, `day note day at index ${index + 1}`);
      const text = toStringOrNull(note.text ?? note.content);
      if (!text) return;
      insertNote.run(newDayId, newTripId, text, toStringOrNull(note.time ?? note.note_time), toStringOrNull(note.icon) || '📝', toNumberOrNull(note.sort_order ?? note.sortOrder) ?? index);
    });

    const accommodationMap = new Map<string, number>();
    const insertAccommodation = db.prepare(`
      INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, check_in, check_in_end, check_out, confirmation, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    accommodationsPayload.forEach((accommodation, index) => {
      const startRef = accommodation.start_day_ref ?? accommodation.startDayRef ?? accommodation.start_day_id ?? accommodation.startDayId;
      const endRef = accommodation.end_day_ref ?? accommodation.endDayRef ?? accommodation.end_day_id ?? accommodation.endDayId ?? startRef;
      const newStartDayId = requireMappedId(dayMap, startRef, `accommodation start day at index ${index + 1}`);
      const newEndDayId = requireMappedId(dayMap, endRef, `accommodation end day at index ${index + 1}`);
      const placeRef = accommodation.place_ref ?? accommodation.placeRef ?? accommodation.place_id ?? accommodation.placeId;
      const result = insertAccommodation.run(
        newTripId,
        resolveMappedId(placeMap, placeRef),
        newStartDayId,
        newEndDayId,
        toStringOrNull(accommodation.check_in ?? accommodation.checkIn),
        toStringOrNull(accommodation.check_in_end ?? accommodation.checkInEnd),
        toStringOrNull(accommodation.check_out ?? accommodation.checkOut),
        toStringOrNull(accommodation.confirmation),
        toStringOrNull(accommodation.notes),
      );
      const newAccommodationId = Number(result.lastInsertRowid);
      [accommodation.ref, accommodation.id, makeRef('accommodation', accommodation.id ?? newAccommodationId)].filter(Boolean).forEach(k => accommodationMap.set(String(k), newAccommodationId));
    });

    const reservationMap = new Map<string, number>();
    const insertReservation = db.prepare(`
      INSERT INTO reservations (trip_id, day_id, end_day_id, place_id, assignment_id, accommodation_id, title, reservation_time,
        reservation_end_time, location, confirmation_number, notes, status, type, metadata, needs_review, day_plan_position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEndpoint = db.prepare(`
      INSERT INTO reservation_endpoints (reservation_id, role, sequence, name, code, lat, lng, timezone, local_time, local_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPosition = db.prepare('INSERT OR REPLACE INTO reservation_day_positions (reservation_id, day_id, position) VALUES (?, ?, ?)');

    reservationsPayload.forEach((reservation, index) => {
      const dayRef = reservation.day_ref ?? reservation.dayRef ?? reservation.day_id ?? reservation.dayId ?? reservation.day;
      const endDayRef = reservation.end_day_ref ?? reservation.endDayRef ?? reservation.end_day_id ?? reservation.endDayId;
      const placeRef = reservation.place_ref ?? reservation.placeRef ?? reservation.place_id ?? reservation.placeId;
      const assignmentRef = reservation.assignment_ref ?? reservation.assignmentRef ?? reservation.assignment_id ?? reservation.assignmentId;
      const accommodationRef = reservation.accommodation_ref ?? reservation.accommodationRef ?? reservation.accommodation_id ?? reservation.accommodationId;
      const title = toStringOrNull(reservation.title || reservation.name);
      if (!title) throw new ValidationError(`Reservation at index ${index + 1} is missing a title`);
      const result = insertReservation.run(
        newTripId,
        resolveMappedId(dayMap, dayRef),
        resolveMappedId(dayMap, endDayRef),
        resolveMappedId(placeMap, placeRef),
        resolveMappedId(assignmentMap, assignmentRef),
        resolveMappedId(accommodationMap, accommodationRef),
        title,
        toStringOrNull(reservation.reservation_time ?? reservation.reservationTime ?? reservation.startTime),
        toStringOrNull(reservation.reservation_end_time ?? reservation.reservationEndTime ?? reservation.endTime),
        toStringOrNull(reservation.location),
        toStringOrNull(reservation.confirmation_number ?? reservation.confirmationNumber),
        toStringOrNull(reservation.notes),
        toStringOrNull(reservation.status) || 'pending',
        toStringOrNull(reservation.type) || 'other',
        stringifyMetadata(reservation.metadata),
        toBoolInt(reservation.needs_review ?? reservation.needsReview),
        toNumberOrNull(reservation.day_plan_position ?? reservation.dayPlanPosition),
      );
      const newReservationId = Number(result.lastInsertRowid);
      [reservation.ref, reservation.id, makeRef('reservation', reservation.id ?? newReservationId)].filter(Boolean).forEach(k => reservationMap.set(String(k), newReservationId));

      toArray(reservation.endpoints).forEach((endpoint, endpointIndex) => {
        const role = endpoint.role === 'to' || endpoint.role === 'stop' ? endpoint.role : 'from';
        const name = toStringOrNull(endpoint.name);
        if (!name) return;
        insertEndpoint.run(
          newReservationId,
          role,
          toIntOrNull(endpoint.sequence) ?? endpointIndex,
          name,
          toStringOrNull(endpoint.code),
          toNumberOrNull(endpoint.lat ?? endpoint.latitude) ?? 0,
          toNumberOrNull(endpoint.lng ?? endpoint.longitude) ?? 0,
          toStringOrNull(endpoint.timezone),
          toStringOrNull(endpoint.local_time ?? endpoint.localTime),
          toStringOrNull(endpoint.local_date ?? endpoint.localDate),
        );
      });

      const dayPositions = reservation.day_positions ?? reservation.dayPositions;
      if (dayPositions && typeof dayPositions === 'object') {
        Object.entries(dayPositions).forEach(([oldDayRef, position]) => {
          const newDayId = resolveMappedId(dayMap, oldDayRef);
          if (newDayId) insertPosition.run(newReservationId, newDayId, toNumberOrNull(position) ?? 0);
        });
      }
    });

    const trip = db.prepare(`${TRIP_SELECT} WHERE t.id = :tripId`).get({ userId, tripId: newTripId });
    return {
      trip,
      counts: {
        days: normalizedDays.length,
        places: placesPayload.length,
        assignments: assignmentsPayload.length,
        day_notes: dayNotesPayload.length,
        accommodations: accommodationsPayload.length,
        reservations: reservationsPayload.length,
      },
      maps: {
        reservations: reservationMap.size,
      },
    };
  });

  return fn();
}
