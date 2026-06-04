# Amadeus Features

## 2026-06-02 — Consolidated trip export menu

### What
Replaced separate PDF and ICS toolbar buttons in the day planner with a single **Export** button that opens a menu. The menu currently contains PDF, ICS Calendar, and Copy markdown options and is ready for more export formats later.

### Files changed

| File | Change |
|------|--------|
| `client/src/components/Planner/DayPlanSidebar.tsx` | Extracted PDF/ICS handlers and replaced separate buttons/tooltips with one Export dropdown menu. |
| `client/src/i18n/translations/en.ts` | Added export menu labels for Export, PDF, and ICS Calendar. |
| `README.md` | Updated feature summary to describe the export menu. |
| `local-readme.md` | Added local feature note for the export menu. |

### Behavior
- Day planner toolbar now shows a single `Export` button.
- Clicking it opens a menu with `PDF`, `ICS Calendar`, and `Copy markdown`.
- Selecting PDF runs the existing trip PDF export.
- Selecting ICS Calendar downloads the existing `.ics` calendar file.
- Selecting Copy markdown copies a readable itinerary markdown including days, places, notes, reservations, and place details.

## 2026-06-01 — Map marker display mode

### What
Added a Map setting that lets users choose whether map markers display place photos when available or always display category icons/colors.

### Files changed

| File | Change |
|------|--------|
| `client/src/types.ts` | Added `map_marker_mode` to user settings. |
| `client/src/store/settingsStore.ts` | Added default marker mode of `photos`. |
| `client/src/components/Settings/MapSettingsTab.tsx` | Added Marker Display Mode selector with `Photos` and `Category icons` options. |
| `client/src/components/Map/MapView.tsx` | Leaflet markers now respect marker mode and skip marker photo loading/rendering when category mode is selected. |
| `client/src/components/Map/MapViewGL.tsx` | Mapbox markers now respect marker mode and skip marker photo loading/rendering when category mode is selected. |
| `client/src/i18n/translations/en.ts` | Added English marker mode setting labels and descriptions. |

### Behavior
- `Photos`: existing behavior — use place photos when available, then fall back to category icons/colors.
- `Category icons`: always render category icons/colors for map markers, even if photos exist.
- Sidebar/place avatars remain unchanged and may still show photos; this setting targets map marker clarity.

## 2026-06-01 — Google Maps route URL import

### What
Added support for importing Google Maps directions URLs as unplanned places. Route stops are parsed in order and added to the trip place list without assigning them to any day.

### Files changed

| File | Change |
|------|--------|
| `server/src/services/placeService.ts` | Added Google Maps route URL parsing/import. Supports coordinate path segments like `/maps/dir/lat,lng/lat,lng` and named route URLs with embedded `!1d{lng}!2d{lat}` stop coordinates. Uses existing duplicate detection and inserts imported stops as normal places. |
| `server/src/routes/places.ts` | Added `POST /api/trips/:tripId/places/import/google-route` with the same auth, permission checks, response shape, and WebSocket broadcasts as existing list imports. |
| `client/src/api/client.ts` | Added `placesApi.importGoogleRoute()`. |
| `client/src/components/Planner/PlacesSidebar.tsx` | Extended the existing List Import modal with a `Google Route` provider. Successful imports reload the trip, show a toast, and register undo via bulk delete. |
| `client/src/i18n/translations/en.ts` | Added English strings for Google Route import labels, hints, success/error messages, and undo text. |

### Behavior
- Accepts Google Maps directions URLs such as `https://www.google.com/maps/dir/-6.127164,106.652988/-6.116454,106.681852/-6.246141,106.884281`.
- Accepts named Google route URLs where each stop's coordinates appear in the `/data=` section as `!2m2!1d{lng}!2d{lat}`.
- Imported stops remain unplanned places; users can assign them to days manually.
- Duplicate places are skipped using the existing import deduplication rules.

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