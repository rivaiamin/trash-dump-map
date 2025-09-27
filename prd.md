## Product Requirements Document (PRD) — Trash Dump Direction

### 1) Overview
- **Problem**: People struggle to quickly find nearby, valid trash/recycling facilities.
- **Solution (client-only MVP)**: A mobile-first SvelteKit app that runs entirely in the browser, using public map/geocoding services to show nearby facilities and open directions in the user's default maps app. No backend.
- **Primary outcome**: From landing to first nearby result in under 30 seconds.

### 2) Goals and Non‑Goals
- **Goals**
  - Find nearest facility quickly using geolocation or address search.
  - Show simple details (name/type if available) and one-tap external directions.
  - Keep everything client-side; no server dependency for MVP.
  - Fast, accessible, mobile-first UX.
- **Non‑Goals (MVP)**
  - Any backend services, databases, or APIs we operate.
  - Accounts, reviews, submissions, moderation, payments.
  - Advanced routing beyond opening an external maps app.

### 3) Personas
- **On-the-go resident**: Wants to quickly find the nearest facility now.
- **Planner**: Prefers searching by address or city and comparing a few options.

### 4) Assumptions
- The device may deny geolocation; users need a manual search fallback.
- OpenStreetMap data is generally sufficient for facility discovery in most areas.
- Users prefer directions via their default maps app (Google/Apple/OSM) rather than in-app turn-by-turn (for MVP).

### 5) Scope
- **In Scope (MVP)**
  - Detect current location or search by address.
  - Map with markers and a minimal list; select to view basic details and distance.
  - External directions link (Google/Apple/OSM) from selected facility.
  - Minimal categories: trash, recycling (if available from source data).
  - Client-only implementation; rely on public endpoints with proper usage.
  - Performance, accessibility, and basic SEO.
- **Future (Post‑MVP)**
  - Crowdsourced edits/submissions.
  - In-app routing.
  - Offline caching.

### 6) User Stories & Acceptance Criteria
- **US1: Use my current location to find the nearest dump**
  - Given I grant location permission, when I open the app, then I see my location on a map and the nearest facilities within a reasonable radius (e.g., 10–20 km) ranked by distance.
  - Distance is displayed in km/mi based on browser locale.
  - If no facilities are found, I see a friendly empty state with suggestions to search another area.
- **US2: Search by address/place**
  - Given I deny or skip location permission, I can type an address and see suggestions.
  - After selecting a suggestion, the map centers on that area and shows nearby facilities.
- **US3: View facility details**
  - When I select a marker or list item, I see: name (or type if unnamed), category, distance, address (if available), hours (if available), data source, and a Directions button.
- **US4: Get directions**
  - When I tap Directions, my device opens the default maps app/site prefilled with the facility destination.
- **US5: Mobile-first experience**
  - Layout adapts to small screens, with readable text, tappable targets, and fast initial load (<2.5s on 4G target).

### 7) Functional Requirements
- **Geolocation**: Prompt for permission; handle allow/deny; fallback to manual search.
- **Search/Geocoding**: Client-side geocoding via public provider; results list and selection.
- **Map & Results**: Leaflet map with markers; optional clustering only if trivial.
- **Facility Details**: Minimal panel with name/type (if available), distance, and directions.
- **Directions**: Generate external links to maps with lat/lng.
- **Units/Locale**: Auto km/mi by locale; keep copy i18n-friendly.

### 8) Data & Sources
- **Entity model (single)**
  - Facility: `id`, `name?`, `type` (trash|recycling|unknown), `lat`, `lng`, `address?`.
- **Source options (client-only)**
  - Option A: Overpass API from client with conservative rate limits and attribution.
  - Option B: Bundled static JSON for demo/testing; swappable adapter for Overpass later.
- **Geocoding**: Client-side Nominatim (respect usage policy and rate limits).
- **Routing Links**: External deep links (Google/Apple/OSM) with coordinates.

### 9) Information Architecture & UX
- **Key pages/components**
  - Home: permission prompt, search bar, map, and nearest list.
  - Details: slide-over or modal with facility info and Directions.
  - Empty/Errors: clear messaging and retry/search actions.
- **Map interactions**: Pan/zoom updates nearby results; selecting marker syncs list highlight.
- **Accessibility**: Keyboard navigation, visible focus, sufficient contrast, ARIA roles, map interactions have accessible equivalents.

### 10) Technical Requirements
- **Architecture**: 100% client-only SPA (SvelteKit, TypeScript, TailwindCSS).
- **Maps**: Leaflet + OSM tiles with attribution; load map code lazily.
- **Lint/Format**: ESLint + Prettier.
- **Performance**: Code-splitting; avoid heavy deps; defer map until needed.
- **Configuration**: Provider base URLs via environment variables at build time if necessary.

### 11) Backend / API
- None for MVP. All data fetched directly from public services or bundled static JSON.

### 12) Privacy, Security, Compliance
- Request location only when needed; explain why; no server, so no storage of location.
- Respect OSM/Nominatim usage policies; display attribution.

### 13) Non‑Functional Requirements
- **Keep it simple**; **Mobile-first**; **Responsive**; **Performance optimized**; **Accessibility optimized**; **SEO optimized**.
- **Performance targets (MVP)**: TTI < 3s on mid-tier mobile; Core Web Vitals good.
- **Availability**: Best-effort; client-only.

### 14) Analytics & Metrics
- Optional privacy-friendly analytics (page view, search, directions click); do not store coordinates.
- **Success metrics**: median time-to-first-result < 10s; directions CTR > 40%.

### 15) Error Handling & Empty States
- Location denied → show search with clear CTA.
- No facilities found → informative message with radius expansion suggestion.
- Network errors → retry UI and offline notice.

### 16) Localization
- English MVP; copy written for easy i18n later; units auto-switch.

### 17) Release Plan
- **MVP**: Client-only geolocation + address search, map + list + minimal details, external directions, proper attribution.
- **Post‑MVP**: Harden Overpass usage, caching, expand categories, basic i18n.

### 18) Risks & Mitigations
- Overpass rate limits → introduce server cache/proxy or seed data fallback.
- Sparse OSM coverage in some regions → allow manual search and show guidance.
- Tile usage limits → use appropriate tile provider and caching policies.

### 19) Open Questions
- Which tile/geocoding providers and quotas will we use in production?
- Do we want in-app routing later (OSRM/GraphHopper) or stay with deep links?



### 20) Epics & User Stories (MVP-first)

- **Epic: Discover Nearby Facilities [MVP]**
  [x] US1.1: As a user who grants location access, I see nearby facilities ranked by distance.
    - Acceptance: Map centers on my location; at least one result or an empty state; distances shown in km/mi by locale.
  [x] US1.2: As a user who denies location, I’m guided to use address search.
    - Acceptance: Clear, persistent search CTA with brief explanation; no blocking modals.

- **Epic: Search by Address [MVP]**
  [x] US2.1: As a user, I can type an address and see relevant suggestions.
    - Acceptance: Suggestions appear within 1s on 4G; keyboard and touch selectable.
  [x] US2.2: As a user, selecting a suggestion recenters the map and loads nearby facilities.
    - Acceptance: Map recenters within 1s; results update within 2s; empty state if none.

- **Epic: View Facility Details [MVP]**
  [x] US3.1: As a user, when I select a marker/list item, I see minimal details.
    - Acceptance: Panel shows name (or type if unnamed), category, distance, and address if available.
  [x] US3.2: As a user, map selection and list selection stay in sync.
    - Acceptance: Selecting on one highlights the other consistently.

- **Epic: Get Directions [MVP]**
  [x] US4.1: As a user, I can open my default maps app/site with the destination prefilled.
    - Acceptance: Directions link opens Google/Apple/OSM with correct lat/lng on mobile and desktop.
  [x] US4.2: As a user, the directions action is always visible from the details panel.
    - Acceptance: One-tap access with clear label and icon.

- **Epic: Mobile-first UX, Performance, Accessibility [MVP]**
  [x] US5.1: As a mobile user, the UI is readable and tappable.
    - Acceptance: Tap targets ≥ 44px; text and contrast meet WCAG AA.
  [x] US5.2: As a user on mid-tier mobile, the app loads quickly.
    - Acceptance: First interactive under 3s on 4G; defer map until needed.
  [x] US5.3: As a keyboard user, I can navigate and see focus states.
    - Acceptance: All interactive elements are reachable; visible focus rings.

- **Epic: Data Source Hardening & Caching [Post‑MVP]**
  [ ] USX.1: As an operator, the app respects provider rate limits and remains reliable.
    - Acceptance: Backoff and minimal caching for Overpass/Nominatim usage; attribution shown.

- **Epic: Offline & Resilience [Post‑MVP]**
  [ ] USX.2: As a user, I can recover from transient network errors.
    - Acceptance: Retry UI; cached last search area where feasible.

- **Epic: Community & In‑App Routing [Post‑MVP]**
  [ ] USX.3: As a user, I can propose edits/submit new facilities (with moderation).
  [ ] USX.4: As a user, I can see in‑app routes without leaving the site.

