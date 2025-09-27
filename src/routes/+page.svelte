<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  let L: any | null = null;

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
  let map: any | null = null;
  let markersLayer: any | null = null;
  let routeLayer: any | null = null;
  let userLatLng: any | null = null;
  let facilities: Facility[] = [];
  let selectedFacility: Facility | null = null;
  let errorMessage = '';
  let permissionDenied = false;
  let isLoadingFacilities = false;
  let hasInitializedMap = false;
  let showingRoute = false;
  // Address search state (US2.1/US2.2)
  let addressQuery = '';
  type Suggestion = { display_name: string; lat: number; lon: number };
  let suggestions: Suggestion[] = [];
  let isSearching = false;
  let activeIndex = -1;
  let searchTimer: any = null;
  let facilityIdToMarker: Record<string, any> = {};
  let listActiveIndex = -1;

  const kmDistance = (a: any, b: any) => a.distanceTo(b) / 1000;

  function detectFacilityType(amenity: string, name?: string): Facility['type'] {
    // First try to detect from name (more reliable for Indonesian facilities)
    if (name) {
      const lowerName = name.toLowerCase();
      
      // English keywords
      if (lowerName.includes('recycling') || lowerName.includes('recycle')) return 'recycling';
      if (lowerName.includes('waste') || lowerName.includes('trash') || lowerName.includes('garbage') || lowerName.includes('dump')) return 'trash';
      
      // Indonesian keywords
      if (lowerName.includes('daur ulang') || lowerName.includes('recycle')) return 'recycling';
      if (lowerName.includes('tempat sampah') || lowerName.includes('pembuangan') || lowerName.includes('sampah')) return 'trash';
    }
    
    // Fall back to amenity tag if name doesn't provide clear indication
    if (amenity === 'recycling') return 'recycling';
    if (amenity === 'waste_disposal') return 'trash';
    
    return 'unknown';
  }

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
      const type: Facility['type'] = detectFacilityType(el.tags?.amenity || '', el.tags?.name);
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

  function initMap(center: any, zoom = 13) {
    if (!L) throw new Error('Leaflet not loaded');
    if (map) return map;
    map = L.map(mapContainer as HTMLDivElement).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    hasInitializedMap = true;
    return map;
  }

  function clearMarkers() {
    markersLayer?.clearLayers();
    facilityIdToMarker = {};
  }

  function clearRoute() {
    routeLayer?.clearLayers();
    showingRoute = false;
  }

  function createFacilityIcon(type: Facility['type']) {
    if (!L) return undefined;
    
    // Create clean, simple icons with circular white background
    const iconConfig = {
      trash: {
        iconUrl: 'data:image/svg+xml;base64,' + btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="11" fill="white" stroke="#dc2626" stroke-width="1"/>
            <rect x="6" y="7" width="12" height="12" rx="1" fill="#dc2626"/>
            <rect x="8" y="5" width="8" height="2" rx="1" fill="#dc2626"/>
            <line x1="10" y1="10" x2="10" y2="16" stroke="white" stroke-width="1"/>
            <line x1="14" y1="10" x2="14" y2="16" stroke="white" stroke-width="1"/>
          </svg>
        `),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      },
      recycling: {
        iconUrl: 'data:image/svg+xml;base64,' + btoa(`
          <svg fill="#229922" height="24px" width="24px" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" xml:space="preserve">
          <circle cx="12" cy="12" r="10" fill="white" stroke="#229922" stroke-width="1"/>
          <g transform="scale(0.077) translate(0, 0)">
            <path d="M153.448,45.446c-7.796-12.435-21.438-19.991-36.116-20.003C102.654,25.43,89,32.962,81.18,45.384L63.656,73.227
              c-1.247,1.982-1.655,4.379-1.136,6.662c0.521,2.284,1.927,4.267,3.909,5.513l36.999,23.255c1.984,1.247,4.383,1.654,6.667,1.131
              c2.284-0.523,4.267-1.933,5.511-3.919L153.448,45.446z"/>
            <path d="M160.434,33.866l-0.022-0.012l38.33,61.133l-4.369,2.781c-1.07,0.681-1.667,1.906-1.545,3.169s0.943,2.351,2.124,2.814
              l56.054,21.997c1.003,0.394,2.134,0.284,3.043-0.295c0.908-0.579,1.486-1.557,1.554-2.632l3.794-60.097
              c0.08-1.267-0.558-2.47-1.65-3.116c-1.093-0.645-2.455-0.623-3.525,0.059l-3.705,2.359L228.672,27.19
              c-4.827-7.7-13.277-12.375-22.365-12.375h-74.472C143.512,16.86,153.939,23.698,160.434,33.866z"/>
            <path d="M267.258,214.027c14.677,0.018,28.333-7.509,36.156-19.929c7.821-12.419,8.712-27.986,2.359-41.217l-14.248-29.657
              c-1.014-2.111-2.825-3.732-5.035-4.507c-2.21-0.775-4.638-0.64-6.748,0.376l-39.379,18.946c-2.111,1.016-3.732,2.83-4.506,5.042
              c-0.773,2.212-0.634,4.641,0.385,6.751L267.258,214.027z"/>
            <path d="M273.342,226.105l0.022-0.014l-72.156-0.085l-0.029-5.178c-0.007-1.269-0.726-2.426-1.86-2.995
              c-1.134-0.568-2.492-0.452-3.513,0.301l-48.454,35.748c-0.867,0.64-1.376,1.655-1.37,2.733c0.006,1.077,0.526,2.087,1.401,2.716
              l48.856,35.197c1.029,0.742,2.388,0.843,3.516,0.261c1.128-0.582,1.834-1.747,1.827-3.016l-0.025-4.393l41.12,0.048
              c9.089,0.011,17.543-4.654,22.38-12.349l39.636-63.048C296.746,220.83,285.407,226.019,273.342,226.105z"/>
            <path d="M60.121,266.543c7.759,12.458,21.378,20.055,36.056,20.111l32.9,0.128c2.342,0.009,4.592-0.913,6.254-2.563
              c1.662-1.65,2.6-3.893,2.607-6.235l0.141-43.699c0.008-2.343-0.917-4.594-2.57-6.255c-1.653-1.661-3.9-2.597-6.242-2.6
              l-71.294-0.116C51.549,238.512,52.361,254.084,60.121,266.543z"/>
            <path d="M80.695,162.893c1.146,0.547,2.5,0.406,3.507-0.367c1.007-0.772,1.495-2.045,1.263-3.292l-11.014-59.198
              c-0.197-1.059-0.889-1.96-1.86-2.425c-0.972-0.465-2.107-0.437-3.056,0.075l-52.992,28.595c-1.117,0.603-1.801,1.781-1.769,3.049
              c0.031,1.269,0.772,2.412,1.916,2.96l3.964,1.896L2.662,171.159c-3.978,8.172-3.471,17.816,1.341,25.526l39.425,63.179
              c-4.447-10.989-4.167-23.455,1.021-34.348l0.005,0.025l31.57-64.883L80.695,162.893z"/>
          </g>
          </svg>
        `),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      },
      unknown: {
        iconUrl: 'data:image/svg+xml;base64,' + btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="11" fill="white" stroke="#6b7280" stroke-width="1"/>
            <circle cx="12" cy="12" r="6" stroke="#6b7280" stroke-width="2"/>
            <path d="m9,12 2,2 4,-4" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
      }
    };

    return L.icon(iconConfig[type]);
  }

  async function showDirections(f: Facility) {
    if (!L || !map || !userLatLng) return;
    
    // Clear any existing route
    clearRoute();
    
    try {
      // Fetch route from OSRM
      const startLng = userLatLng.lng;
      const startLat = userLatLng.lat;
      const endLng = f.lng;
      const endLat = f.lat;
      
      const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Route request failed');
      
      const data = await response.json();
      
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No route found');
      }
      
      const route = data.routes[0];
      const coordinates = route.geometry.coordinates;
      
      // Convert coordinates to Leaflet format (lat, lng)
      const latLngs = coordinates.map((coord: [number, number]) => L!.latLng(coord[1], coord[0]));
      
      // Create polyline for the route
      const routeLine = L.polyline(latLngs, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7
      }).addTo(routeLayer!);
      
      // Fit map to show the entire route
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [20, 20] });
      
      showingRoute = true;
      
      // Add route info popup
      const distance = (route.distance / 1000).toFixed(1);
      const duration = Math.round(route.duration / 60);
      routeLine.bindPopup(`
        <div class="text-sm">
          <div class="font-semibold">Route to ${f.name || f.type}</div>
          <div>Distance: ${distance} km</div>
          <div>Duration: ${duration} minutes</div>
        </div>
      `);
      
    } catch (err) {
      console.error('Failed to show route:', err);
      errorMessage = 'Could not find route. Try external directions.';
      setTimeout(() => { errorMessage = ''; }, 3000);
    }
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
    clearRoute();
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
      L.marker(userLatLng).addTo(markersLayer).bindPopup('You are here');
      facilities = await fetchFacilitiesAround(pos.coords.latitude, pos.coords.longitude, 30);
      selectedFacility = null;
      for (const f of facilities) {
        const icon = createFacilityIcon(f.type);
        const marker = L.marker([f.lat, f.lng], { icon }).addTo(markersLayer).bindPopup(f.name || f.type);
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
    clearRoute();
    isLoadingFacilities = true;
    const center = L.latLng(s.lat, s.lon);
    initMap(center, 13);
    map.setView(center, 13);
    clearMarkers();
    // Use selected center for distance calculations in this context
    userLatLng = center;
    L.marker(center).addTo(markersLayer).bindPopup('Selected area');
    facilities = await fetchFacilitiesAround(center.lat, center.lng, 30);
    selectedFacility = null;
    for (const f of facilities) {
      const icon = createFacilityIcon(f.type);
      const marker = L.marker([f.lat, f.lng], { icon }).addTo(markersLayer).bindPopup(f.name || f.type);
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

<div class="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
  <div class="max-w-screen-md mx-auto p-4 space-y-6">
    <div class="text-center py-6">
      <div class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-green-500 rounded-full mb-4">
        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
        </svg>
      </div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">Find Nearby Trash & Recycling</h1>
      <p class="text-gray-600">Discover waste disposal and recycling facilities near you</p>
    </div>

  <div class="flex flex-col sm:flex-row items-center gap-3">
    <button 
      class="inline-flex items-center gap-2 h-12 px-6 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-lg hover:from-blue-700 hover:to-blue-800 hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none" 
      on:click={useGeolocation}
      disabled={isLoadingFacilities}
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
      </svg>
      {isLoadingFacilities ? 'Finding location...' : 'Use my location'}
    </button>
    {#if permissionDenied}
      <div class="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
        </svg>
        Location is off. Use the search bar below to find an area.
      </div>
    {/if}
  </div>

  <!-- Address search with suggestions (US2.1/US2.2) -->
  <div class="relative">
    <div class="relative">
      <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
      </div>
      <input
        class="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 placeholder-gray-500"
        placeholder="Search for an address or location"
        bind:value={addressQuery}
        on:input={onAddressInput}
        on:keydown={onAddressKeydown}
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
      >
      {#if isSearching}
        <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
          <svg class="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      {/if}
    </div>
    {#if suggestions.length > 0}
      <ul class="absolute z-20 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg divide-y divide-gray-100 max-h-60 overflow-y-auto" role="listbox">
        {#each suggestions as s, i}
          <li
            class="px-4 py-3 cursor-pointer hover:bg-blue-50 transition-colors duration-150 {i === activeIndex ? 'bg-blue-100' : ''}"
            role="option"
            aria-selected={i === activeIndex}
            on:click={() => chooseSuggestion(i)}
            on:keydown={(e) => e.key === 'Enter' && chooseSuggestion(i)}
            tabindex="0"
          >
            <div class="flex items-center gap-3">
              <svg class="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
              <span class="text-sm text-gray-700 truncate">{s.display_name}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if errorMessage}
    <div class="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
      <svg class="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <span class="text-sm text-red-700">{errorMessage}</span>
    </div>
  {/if}

  <div class="relative">
    <div class="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      <div bind:this={mapContainer} class="h-[60vh] w-full"></div>
    </div>
    {#if isLoadingFacilities}
      <div class="absolute inset-0 bg-white/80 backdrop-blur-sm grid place-items-center rounded-xl">
        <div class="flex flex-col items-center gap-3">
          <svg class="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="text-sm font-medium text-gray-700">Loading facilities...</span>
        </div>
      </div>
    {/if}
    {#if showingRoute}
      <button 
        class="absolute top-4 right-4 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-white border border-gray-200 shadow-lg hover:shadow-xl focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 text-sm font-medium text-gray-700 transition-all duration-200"
        on:click={clearRoute}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        Clear Route
      </button>
    {/if}
  </div>

  <div class="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-blue-500 rounded-lg flex items-center justify-center">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
        </svg>
      </div>
      <h2 class="text-xl font-bold text-gray-800">Nearby Facilities</h2>
      {#if facilities.length > 0}
        <span class="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">{facilities.length} found</span>
      {/if}
    </div>
    
    {#if facilities.length === 0}
      <div class="text-center py-8">
        <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
        </svg>
        <p class="text-gray-500 mb-2">No facilities found yet</p>
        <p class="text-sm text-gray-400">Try "Use my location" or search for an address to find nearby facilities</p>
      </div>
    {:else}
      <ul class="space-y-3" on:keydown={onFacilitiesKeydown} tabindex="0" role="listbox" aria-activedescendant={selectedFacility?.id}>
        {#each facilities as f, i}
          <li 
            id={f.id} 
            class="group p-4 rounded-lg border border-gray-200 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 {selectedFacility?.id === f.id ? 'ring-2 ring-blue-500 border-blue-300 bg-blue-50' : 'bg-white'}" 
            on:click={() => selectFacility(f)} 
            on:keydown={(e) => e.key === 'Enter' && selectFacility(f)}
            tabindex="0" 
            role="option" 
            aria-selected={selectedFacility?.id === f.id} 
            on:focus={() => { listActiveIndex = i; }}
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-3 flex-1">
                <div class="flex-shrink-0 mt-1">
                  {#if f.type === 'trash'}
                    <div class="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                      <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                      </svg>
                    </div>
                  {:else if f.type === 'recycling'}
                    <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                    </div>
                  {:else}
                    <div class="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                      <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                    </div>
                  {/if}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-gray-900 truncate">{f.name || f.type}</div>
                  <div class="flex items-center gap-2 mt-1">
                    <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    </svg>
                    <span class="text-sm text-gray-600">{formatDistance(f.distanceKm)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-3 flex gap-2">
              <button 
                class="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed" 
                on:click={(e) => { e.stopPropagation(); showDirections(f); }}
                disabled={!userLatLng}
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path>
                </svg>
                Show Route
              </button>
              <a 
                class="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 transition-colors duration-200" 
                href={directionsUrlFor(f)} 
                target="_blank" 
                rel="noopener noreferrer"
                on:click={(e) => e.stopPropagation()}
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                </svg>
                External
              </a>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if selectedFacility}
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-screen-sm bg-white border border-gray-200 shadow-2xl rounded-xl p-4 transform transition-all duration-300 ease-out">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <div class="flex-shrink-0">
            {#if selectedFacility.type === 'trash'}
              <div class="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </div>
            {:else if selectedFacility.type === 'recycling'}
              <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </div>
            {:else}
              <div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
            {/if}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900 truncate">{selectedFacility.name || selectedFacility.type}</div>
            <div class="flex items-center gap-1 mt-1">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
              <span class="text-sm text-gray-600">{formatDistance(selectedFacility.distanceKm)}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button 
            class="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed" 
            on:click={() => selectedFacility && showDirections(selectedFacility)}
            disabled={!userLatLng || !selectedFacility}
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path>
            </svg>
            Route
          </button>
          <a 
            class="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 transition-colors duration-200" 
            href={directionsUrlFor(selectedFacility)} 
            target="_blank" 
            rel="noopener noreferrer"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
            </svg>
            External
          </a>
          <button 
            class="h-10 w-10 rounded-lg border border-gray-200 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 transition-colors duration-200 flex items-center justify-center" 
            on:click={() => selectedFacility = null} 
            aria-label="Close"
          >
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  {/if}
  </div>
</div>
