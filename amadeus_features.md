# Amadeus Features

## 2026-05-31 — Google Maps URL coordinate extraction (Add Place modal)

### What
Added a dedicated **Google Maps URL** input field near the Latitude/Longitude fields in the Add Place modal, with an **Extract** button that parses the URL and auto-fills the most granular coordinates.

### Files changed

| File | Change |
|------|--------|
| `client/src/components/Planner/PlaceFormModal.tsx` | Added `googleMapsUrl` state, `isResolvingUrl` state, `handleResolveGoogleMapsUrl()` handler, URL input + Extract button in the Address section below Lat/Lng. Extracted `applyResolvedUrl()` helper to avoid duplication with the existing top search bar URL resolver. URL input resets when the modal reopens. |
| `client/src/i18n/translations/en.ts` | Added `places.googleMapsUrlPlaceholder` ("Paste Google Maps URL") and `places.extractCoords` ("Extract"). |
| `server/src/services/mapsService.ts` | Reworked coordinate extraction priority in `resolveGoogleMapsUrl`: prefers last `!3d...!4d...` pair (place-specific) → `?q=lat,lng` → `?ll=lat,lng` → `@lat,lng` (viewport fallback). Also added `?ll=` pattern that was previously unsupported. |
| `client/src/components/Planner/PlaceFormModal.test.tsx` | Added test FE-PLANNER-PLACEFORM-037: Google Maps URL input extracts coordinates. |
| `server/tests/unit/services/mapsService.test.ts` | Added test MAPS-028e: prefers the last Google data coordinates over viewport coordinates with the real Eiffel Tower URL. |

### Behavior
- The new input accepts a full Google Maps URL (e.g. `https://www.google.com/maps/place/Eiffel+Tower/@48.8589385,2.2646339,12z/...`).
- On Extract (button or Enter), it calls `POST /api/maps/resolve-url`.
- On success: populates `lat`, `lng`; fills `name`/`address` only if those fields are currently empty; clears the URL input; shows "Place imported from URL" toast.
- On failure: shows "Place search failed." toast.
- The backend now correctly extracts `48.8583701, 2.2944813` (the Eiffel Tower place coordinates) rather than `48.8589385, 2.2646339` (the map viewport center).

### Test results
- Server: 99/99 maps service tests passing (including new test)
- Client: 37/37 PlaceFormModal tests passing (including new test, requires `--localstorage-file` for Node localStorage)