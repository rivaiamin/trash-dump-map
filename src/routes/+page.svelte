<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type * as Leaflet from 'leaflet';
  let L: typeof import('leaflet') | null = null;

  type Facility = {
    id: string;
    name?: string;
    type: 'trash' | 'recycling' | 'unknown';
    lat: number;
    lng: number;
    address?: string;
    distanceKm?: number;
  };

  let mapContainer: HTMLDivElement | null = null;
  let map: Leaflet.Map | null = null;
  let markersLayer: Leaflet.LayerGroup | null = null;
  let userLatLng: Leaflet.LatLng | null = null;
  let facilities: Facility[] = [];
  let selectedFacility: Facility | null = null;
  let errorMessage = '';
  let permissionDenied = false;
  let isLoadingFacilities = false;
  let hasInitializedMap = false;
  // Address search state (US2.1/US2.2)
  let addressQuery = '';
  type Suggestion = { display_name: string; lat: number; lon: number };
  let suggestions: Suggestion[] = [];
  let isSearching = false;
  let activeIndex = -1;
  let searchTimer: any = null;
  let facilityIdToMarker: Record<string, Leaflet.Marker> = {};
  let listActiveIndex = -1;

  const kmDistance = (a: Leaflet.LatLng, b: Leaflet.LatLng) => a.distanceTo(b) / 1000;

  function formatDistance(km?: number) {
    if (km === undefined) return '';
    // Simple locale heuristic: use miles in en-US; otherwise km
    const useMiles = browser && navigator.language?.toLowerCase().includes('en-us');
    if (useMiles) {
      const miles = km * 0.621371;
      return `${miles.toFixed(1)} mi away`;
    }
    return `${km.toFixed(1)} km away`;
  }

  async function fetchFacilitiesAround(lat: number, lng: number, radiusKm = 10) {
    // Overpass: find waste disposal / recycling within radius
    const radiusMeters = Math.floor(radiusKm * 1000);
    const query = `
      [out:json][timeout:25];
      (
        node["amenity"="waste_disposal"](around:${radiusMeters},${lat},${lng});
        node["amenity"="recycling"](around:${radiusMeters},${lat},${lng});
        way["amenity"="waste_disposal"](around:${radiusMeters},${lat},${lng});
        way["amenity"="recycling"](around:${radiusMeters},${lat},${lng});
        relation["amenity"="waste_disposal"](around:${radiusMeters},${lat},${lng});
        relation["amenity"="recycling"](around:${radiusMeters},${lat},${lng});
      );
      out center 30;
    `;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query })
    });
    if (!res.ok) throw new Error('Failed to fetch facilities');
    const data = await res.json();
    const results: Facility[] = (data.elements || []).map((el: any) => {
      const center = el.type === 'node' ? { lat: el.lat, lng: el.lon } : (el.center || {});
      const latNum = Number(center.lat);
      const lngNum = Number(center.lng);
      const type: Facility['type'] = el.tags?.amenity === 'recycling' ? 'recycling' : el.tags?.amenity === 'waste_disposal' ? 'trash' : 'unknown';
      return {
        id: String(el.id),
        name: el.tags?.name,
        type,
        lat: latNum,
        lng: lngNum,
        address: el.tags?.['addr:full'] || el.tags?.['addr:street']
      } satisfies Facility;
    }).filter((f: Facility) => Number.isFinite(f.lat) && Number.isFinite(f.lng));

    if (userLatLng && L) {
      for (const f of results) {
        f.distanceKm = kmDistance(userLatLng, L.latLng(f.lat, f.lng));
      }
      results.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }
    return results;
  }

  function initMap(center: Leaflet.LatLngExpression, zoom = 13) {
    if (!L) throw new Error('Leaflet not loaded');
    if (map) return map;
    map = L.map(mapContainer as HTMLDivElement).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    hasInitializedMap = true;
    return map;
  }

  function clearMarkers() {
    markersLayer?.clearLayers();
    facilityIdToMarker = {};
  }

  function directionsUrlFor(f: Facility) {
    const lat = f.lat.toFixed(6);
    const lng = f.lng.toFixed(6);
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }

  function selectFacility(f: Facility) {
    selectedFacility = f;
    if (L && map) {
      const where = L.latLng(f.lat, f.lng);
      map.setView(where, Math.max(map.getZoom(), 13));
      const marker = facilityIdToMarker[f.id];
      if (marker) marker.openPopup();
    }
  }

  async function useGeolocation() {
    permissionDenied = false;
    errorMessage = '';
    facilities = [];
    try {
      if (!L) {
        L = await import('leaflet');
      }
      isLoadingFacilities = true;
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000
        });
      });
      userLatLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      initMap(userLatLng, 13);
      clearMarkers();
      L.marker(userLatLng).addTo(markersLayer as Leaflet.LayerGroup).bindPopup('You are here');
      facilities = await fetchFacilitiesAround(pos.coords.latitude, pos.coords.longitude, 10);
      selectedFacility = null;
      for (const f of facilities) {
        const marker = L.marker([f.lat, f.lng]).addTo(markersLayer as Leaflet.LayerGroup).bindPopup(f.name || f.type);
        marker.on('click', () => selectFacility(f));
        facilityIdToMarker[f.id] = marker;
      }
      if (facilities.length === 0) {
        errorMessage = 'No facilities found nearby. Try searching another area.';
      }
    } catch (err: any) {
      if (err?.code === err?.PERMISSION_DENIED || err?.message?.toLowerCase?.().includes('permission')) {
        permissionDenied = true; // US1.2 path
        errorMessage = '';
      } else {
        errorMessage = 'Unable to get location. Please try address search.';
        permissionDenied = true; // guide to search anyway
      }
    } finally {
      isLoadingFacilities = false;
    }
  }

  onMount(() => {
    // Defer map and Leaflet load until user interacts (geolocation or address search selection)
  });

  async function searchAddresses(q: string) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', navigator.language || 'en');
    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    return (data as any[]).map((d) => ({ display_name: d.display_name, lat: Number(d.lat), lon: Number(d.lon) })) as Suggestion[];
  }

  function onAddressInput() {
    activeIndex = -1;
    if (searchTimer) clearTimeout(searchTimer);
    const q = addressQuery.trim();
    if (q.length < 3) {
      suggestions = [];
      return;
    }
    isSearching = true;
    searchTimer = setTimeout(async () => {
      try {
        suggestions = await searchAddresses(q);
      } catch {
        suggestions = [];
      } finally {
        isSearching = false;
      }
    }, 350);
  }

  async function chooseSuggestion(i: number) {
    const s = suggestions[i];
    if (!s) return;
    if (!L) {
      L = await import('leaflet');
    }
    isLoadingFacilities = true;
    const center = L.latLng(s.lat, s.lon);
    initMap(center, 13);
    (map as Leaflet.Map).setView(center, 13);
    clearMarkers();
    // Use selected center for distance calculations in this context
    userLatLng = center;
    L.marker(center).addTo(markersLayer as Leaflet.LayerGroup).bindPopup('Selected area');
    facilities = await fetchFacilitiesAround(center.lat, center.lng, 10);
    selectedFacility = null;
    for (const f of facilities) {
      const marker = L.marker([f.lat, f.lng]).addTo(markersLayer as Leaflet.LayerGroup).bindPopup(f.name || f.type);
      marker.on('click', () => selectFacility(f));
      facilityIdToMarker[f.id] = marker;
    }
    suggestions = [];
    isLoadingFacilities = false;
  }

  function onAddressKeydown(e: KeyboardEvent) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) chooseSuggestion(activeIndex);
    } else if (e.key === 'Escape') {
      suggestions = [];
    }
  }

  function onFacilitiesKeydown(e: KeyboardEvent) {
    if (facilities.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      listActiveIndex = (listActiveIndex + 1) % facilities.length;
      selectFacility(facilities[listActiveIndex]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      listActiveIndex = (listActiveIndex - 1 + facilities.length) % facilities.length;
      selectFacility(facilities[listActiveIndex]);
    } else if (e.key === 'Enter' && listActiveIndex >= 0) {
      e.preventDefault();
      selectFacility(facilities[listActiveIndex]);
    }
  }
</script>

<div class="max-w-screen-md mx-auto p-4 space-y-4">
  <h1 class="text-2xl font-bold">Find nearby trash & recycling</h1>

  <div class="flex items-center gap-2">
    <button class="btn h-11 px-4 rounded bg-black text-white focus-visible:ring-2 ring-black" on:click={useGeolocation}>
      Use my location
    </button>
    {#if permissionDenied}
      <div class="text-sm">
        Location is off. Use the search bar below to find an area.
      </div>
    {/if}
  </div>

  <!-- Address search with suggestions (US2.1/US2.2) -->
  <div class="relative">
    <input
      class="border rounded px-3 py-2 w-full focus-visible:ring-2 ring-black"
      placeholder="Search an address"
      bind:value={addressQuery}
      on:input={onAddressInput}
      on:keydown={onAddressKeydown}
      aria-autocomplete="list"
      aria-expanded={suggestions.length > 0}
    >
    {#if isSearching}
      <div class="absolute right-2 top-2 text-xs text-gray-500">Searching…</div>
    {/if}
    {#if suggestions.length > 0}
      <ul class="absolute z-10 mt-1 w-full bg-white border rounded shadow divide-y" role="listbox">
        {#each suggestions as s, i}
          <li
            class="px-3 py-3 cursor-pointer hover:bg-gray-50 {i === activeIndex ? 'bg-gray-100' : ''}"
            role="option"
            aria-selected={i === activeIndex}
            on:click={() => chooseSuggestion(i)}
          >
            {s.display_name}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if errorMessage}
    <div class="text-sm text-red-600">{errorMessage}</div>
  {/if}

  <div class="relative">
    <div bind:this={mapContainer} class="h-[60vh] w-full rounded border"></div>
    {#if isLoadingFacilities}
      <div class="absolute inset-0 bg-white/50 grid place-items-center text-sm">Loading…</div>
    {/if}
  </div>

  <div>
    <h2 class="font-semibold mb-2">Nearby facilities</h2>
    {#if facilities.length === 0}
      <div class="text-sm text-gray-600">No results yet. Try "Use my location" or search an address.</div>
    {:else}
      <ul class="space-y-2" on:keydown={onFacilitiesKeydown} tabindex="0" role="listbox" aria-activedescendant={selectedFacility?.id}>
        {#each facilities as f, i}
          <li id={f.id} class="p-3 rounded border cursor-pointer focus-visible:ring-2 ring-black {selectedFacility?.id === f.id ? 'ring-2 ring-black' : ''}" on:click={() => selectFacility(f)} tabindex="0" role="option" aria-selected={selectedFacility?.id === f.id} on:focus={() => { listActiveIndex = i; }}>
            <div class="font-medium">{f.name || f.type}</div>
            <div class="text-sm text-gray-600">
              {formatDistance(f.distanceKm)}
            </div>
            <div class="mt-2">
              <a class="inline-flex items-center justify-center h-11 px-4 rounded bg-black text-white focus-visible:ring-2 ring-black" href={directionsUrlFor(f)} target="_blank" rel="noopener noreferrer">Directions</a>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if selectedFacility}
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-screen-sm bg-white border shadow rounded p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="font-semibold">{selectedFacility.name || selectedFacility.type}</div>
          <div class="text-sm text-gray-600">
            {formatDistance(selectedFacility.distanceKm)}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <a class="inline-flex items-center justify-center h-11 px-4 rounded bg-black text-white focus-visible:ring-2 ring-black" href={directionsUrlFor(selectedFacility)} target="_blank" rel="noopener noreferrer">Directions</a>
          <button class="h-11 px-3 rounded border focus-visible:ring-2 ring-black" on:click={() => selectedFacility = null} aria-label="Close">Close</button>
        </div>
      </div>
    </div>
  {/if}
</div>
