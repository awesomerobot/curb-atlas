<script>
	import { onMount, untrack } from 'svelte';
	import throttle from 'lodash.throttle';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import { mapboxAccessToken, maxBounds, colors, widths, CURB_ZONE_MINZOOM, AUTO_LOAD_MINZOOM, TIMEOUT } from '../constants';
	import { simplifyFilters } from '../utils/basic-utils';
	import {
		parkingLineColor,
		parkingLineWidth,
		parkingLineDasharray,
		parkingEmphasisOutline,
		parkingEmphasis,
		parkingSymbol,
		parkingSymbolFilter,
		scaledByZoom
	} from '../utils/map-paint-expressions';
	import {
		containsBbox,
		bboxDifferenceRects,
		bboxFromPolygonFeature,
		bboxToPolygonFeature,
		buildTileGrid
	} from '../utils/bbox-math';
	import { createLoadingRegion } from '../utils/loading-region';
	import {
		geocoderState,
		mapState,
		selectedAreaState,
		selectedCurbZoneState,
		timeState,
		filterState,
		signsState
	} from '../state.svelte';
	import { getCurbZonesByArea } from '../utils/get-curb-zones';
	import { getCurbPoliciesById } from '../utils/get-curb-policies-by-id';
	import * as turf from '@turf/turf';

	const TIMEOUT_TIME = 150;
	const waitForStyleLoad = (map, res) => {
		if (!map || !map.isStyleLoaded()) {
			setTimeout(() => waitForStyleLoad(map, res), TIMEOUT_TIME);
		} else {
			res();
		}
	};

	mapboxgl.accessToken = mapboxAccessToken;

	let marker = $state(null);

	let hoveredCurbId = $state(null);

	// Padded bbox of the data currently loaded into the map source, and the
	// previous value captured at the moment we kicked off the in-flight fetch.
	// Used to (a) skip refetches when the visible area is already covered, and
	// (b) tint only the genuinely-new strip(s) during a refetch.
	let loadedBbox = null;
	let priorLoadedBbox = null;

	const curbLayout = {
		'line-join': 'round',
		'line-cap': 'round'
	};

	const filters = $derived(simplifyFilters(filterState.current));

	const parkingLineColorExpression = $derived(parkingLineColor(filters));
	const parkingLineWidthExpression = $derived(parkingLineWidth(filters));
	const parkingLineDasharrayExpression = $derived(parkingLineDasharray(filters));
	const parkingEmphasisOutlineExpression = $derived(parkingEmphasisOutline(filters));
	const parkingEmphasisExpression = $derived(parkingEmphasis(filters));
	const parkingSymbolExpression = $derived(parkingSymbol(filters));
	const parkingSymbolFilterExpression = $derived(parkingSymbolFilter(filters));

	const throttledSetPositionState = throttle(() => {
		const center = mapState.map.getCenter();
		const zoom = mapState.map.getZoom();
		mapState.position = { center, zoom };
	}, TIMEOUT);

	onMount(() => {
		mapState.map = new mapboxgl.Map({
			attributionControl: false,
			container: 'map',
			style: 'mapbox://styles/oetboston/cmla1zirs007d01st6h9kg2ij',
			center: mapState.position.center,
			zoom: mapState.position.zoom,
			maxBounds: [maxBounds.slice(0, 2), maxBounds.slice(2)],
			minZoom: AUTO_LOAD_MINZOOM,
			maxZoom: 17
		});

		mapState.map.addControl(
			new mapboxgl.AttributionControl({
				customAttribution: 'Designed by <a href="https://stamen.com">Stamen</a>'
			})
		);

		mapState.map.on('move', throttledSetPositionState);

		// Auto-load curb zones for whatever's currently in view (above AUTO_LOAD_MINZOOM).
		// - Pad the fetched bbox so small pans don't refetch (viewport pad).
		// - Skip entirely when the new viewport is still inside the last-loaded
		//   padded bbox — same data, no work to do.
		// - Drop the selection on zoom-out so the cleanup effect tears down layers.
		const VIEWPORT_PAD = 0.25; // fetch 1.5x viewport on each axis (0.25 each side)

		const syncViewportSelection = () => {
			const zoom = mapState.map.getZoom();
			if (zoom < AUTO_LOAD_MINZOOM) {
				if (selectedAreaState.selected) {
					selectedAreaState.selected = null;
					selectedAreaState.type = null;
					selectedAreaState.isViewport = false;
					loadedBbox = null;
				}
				return;
			}
			const b = mapState.map.getBounds();
			const sw = b.getSouthWest();
			const ne = b.getNorthEast();
			const lngPad = (ne.lng - sw.lng) * VIEWPORT_PAD;
			const latPad = (ne.lat - sw.lat) * VIEWPORT_PAD;
			const paddedBbox = [sw.lng - lngPad, sw.lat - latPad, ne.lng + lngPad, ne.lat + latPad];
			const visibleBbox = [sw.lng, sw.lat, ne.lng, ne.lat];

			// Visible area still inside the last-loaded padded bbox? Skip.
			if (containsBbox(loadedBbox, visibleBbox)) return;

			// Stash the old loadedBbox so addCurbZonesLayers can tint only the
			// genuinely-new rectangle(s). Update loadedBbox eagerly so
			// subsequent pans within the new region don't re-trigger.
			priorLoadedBbox = loadedBbox;
			loadedBbox = paddedBbox;
			selectedAreaState.isViewport = true;
			selectedAreaState.type = 'area';
			selectedAreaState.selected = bboxToPolygonFeature(paddedBbox);
		};

		// Debounce so a rapid pan/zoom gesture (which can fire moveend multiple
		// times) coalesces into a single refetch after the user settles.
		const debouncedSync = throttle(syncViewportSelection, 250, { leading: false, trailing: true });
		mapState.map.on('moveend', debouncedSync);

		mapState.map.on('load', () => {
			mapState.map.dragRotate.disable();
			mapState.map.touchZoomRotate.disableRotation();
			mapState.map.touchPitch.disable();
			mapState.map.keyboard.disable();
			// Initial fire so users who land at a zoomed-in view get data immediately.
			syncViewportSelection();
		});
	});

	const CURB_ZONES_SOURCE_ID = '_curbzones';
	const CURB_ZONES_LAYER_ID = '_curb_zones_layer';
	const CURB_ZONES_EMPHASIS_LAYER_ID = '_curb_zones_emphasis_layer';
	const CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID = '_curb_zones_emphasis_outline_layer';
	const CURB_ZONES_SYMBOL_LAYER_ID = '_curb_zones_symbol_layer';

	const SELECTED_CURB_ZONE_SOURCE_ID = '_selectedcurbzone';
	const SELECTED_CURB_ZONE_LAYER_ID = '_selectedcurbzone_layer';
	const SELECTED_CURB_ZONE_STROKE_LAYER_ID = '_selectedcurbzone_stroke_layer';

	const SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID = '_selectedcurbzone_endpoint';
	const SELECTED_CURB_ZONE_ENDPOINT_LAYER_ID = '_selectedcurbzone_endpoint_layer';
	const SELECTED_CURB_ZONE_ENDPOINT_STROKE_LAYER_ID = '_selectedcurbzone_stroke_endpoint_layer';

	const ALL_CURB_ZONE_LAYERS = [
		CURB_ZONES_LAYER_ID,
		CURB_ZONES_EMPHASIS_LAYER_ID,
		CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID,
		SELECTED_CURB_ZONE_LAYER_ID,
		SELECTED_CURB_ZONE_STROKE_LAYER_ID,
		SELECTED_CURB_ZONE_ENDPOINT_LAYER_ID,
		SELECTED_CURB_ZONE_ENDPOINT_STROKE_LAYER_ID
	];

	const selectCurbZoneSegment = (feature) => {
		// Tear down any previous selection. Check sources/layers independently
		// so we don't leak a source when its layers were never added (causes
		// "There is already a source with ID …" the next time around).
		for (const id of [
			SELECTED_CURB_ZONE_LAYER_ID,
			SELECTED_CURB_ZONE_STROKE_LAYER_ID,
			SELECTED_CURB_ZONE_ENDPOINT_LAYER_ID,
			SELECTED_CURB_ZONE_ENDPOINT_STROKE_LAYER_ID
		]) {
			if (mapState.map.getLayer(id)) mapState.map.removeLayer(id);
		}
		for (const id of [SELECTED_CURB_ZONE_SOURCE_ID, SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID]) {
			if (mapState.map.getSource(id)) mapState.map.removeSource(id);
		}

		const { geometry, properties } = feature;

		selectedCurbZoneState.geometry = geometry;
		selectedCurbZoneState.properties = properties;

		const geojson = geometry;

		const nextLineSource = {
			type: 'geojson',
			data: geojson
		};

		mapState.map.addSource(SELECTED_CURB_ZONE_SOURCE_ID, nextLineSource);

		// Endpoints
		const pointsData = {
			type: 'FeatureCollection',
			features: [
				geometry.coordinates[0],
				geometry.coordinates[geometry.coordinates.length - 1]
			].map((coord) => ({
				type: 'Feature',
				properties: {},
				geometry: {
					coordinates: coord,
					type: 'Point'
				}
			}))
		};

		const nextPointsSource = {
			type: 'geojson',
			data: pointsData
		};

		mapState.map.addSource(SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID, nextPointsSource);

		const nextLineStrokeLayer = {
			id: SELECTED_CURB_ZONE_STROKE_LAYER_ID,
			minzoom: CURB_ZONE_MINZOOM,
			type: 'line',
			source: SELECTED_CURB_ZONE_SOURCE_ID,
			layout: curbLayout,
			paint: {
				'line-color': colors.highlightColorStroke,
				'line-width': widths.selectedCurbZoneStroke
			}
		};

		mapState.map.addLayer(nextLineStrokeLayer);

		const nextEndPointsStrokeLayer = {
			id: SELECTED_CURB_ZONE_ENDPOINT_STROKE_LAYER_ID,
			minzoom: CURB_ZONE_MINZOOM,
			type: 'circle',
			source: SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID,
			paint: {
				'circle-radius': 6,
				'circle-color': colors.highlightColorStroke
			}
		};

		mapState.map.addLayer(nextEndPointsStrokeLayer);

		const nextLineLayer = {
			id: SELECTED_CURB_ZONE_LAYER_ID,
			minzoom: CURB_ZONE_MINZOOM,
			type: 'line',
			source: SELECTED_CURB_ZONE_SOURCE_ID,
			layout: curbLayout,
			paint: {
				'line-color': colors.highlightColor,
				'line-width': widths.selectedCurbZoneWidth
			}
		};

		mapState.map.addLayer(nextLineLayer);

		const nextEndPointsLayer = {
			id: SELECTED_CURB_ZONE_ENDPOINT_LAYER_ID,
			minzoom: CURB_ZONE_MINZOOM,
			type: 'circle',
			source: SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID,
			paint: {
				'circle-radius': 4,
				'circle-color': colors.highlightColor
			}
		};

		mapState.map.addLayer(nextEndPointsLayer);

		// Policies
		let { curb_policy_ids = '[]' } = properties;
		curb_policy_ids = JSON.parse(curb_policy_ids);

		if (curb_policy_ids && curb_policy_ids.length) {
			getCurbPoliciesById(curb_policy_ids).then((policies) => {
				selectedCurbZoneState.policies = policies;
			});
		} else {
			selectedCurbZoneState.policies = [];
		}
	};

	const addHoverState = (layerId, sourceId) => {
		mapState.map.on('mouseenter', layerId, (e) => {
			if (e.features.length > 0) {
				if (hoveredCurbId !== null) {
					mapState.map.setFeatureState({ source: sourceId, id: hoveredCurbId }, { hover: false });
				}
				hoveredCurbId = e.features[0].id;
				mapState.map.setFeatureState({ source: sourceId, id: hoveredCurbId }, { hover: true });
			}
		});

		mapState.map.on('mouseleave', layerId, () => {
			if (hoveredCurbId !== null) {
				mapState.map.setFeatureState({ source: sourceId, id: hoveredCurbId }, { hover: false });
			}
			hoveredCurbId = null;
		});
	};

	const loadingRegion = createLoadingRegion(() => mapState.map);
	const showLoadingRegion = loadingRegion.show;
	const hideLoadingBbox = loadingRegion.hide;

	const addCurbZonesLayers = async (type, day, time) => {
		if (type !== 'area') return;

		const [min_lng, min_lat, max_lng, max_lat] = bboxFromPolygonFeature(
			selectedAreaState.selected
		);

		// Per-tile loading rectangles — tint only the strips of each tile
		// that aren't already covered by data we loaded previously.
		const GRID_SIZE = 3;
		const tiles = buildTileGrid([min_lng, min_lat, max_lng, max_lat], GRID_SIZE);
		const tileKey = (b) => b.join(',');
		const pendingRectsByTile = new Map(
			tiles.map((tb) => [tileKey(tb), bboxDifferenceRects(tb, priorLoadedBbox)])
		);

		const renderLoadingRegion = () => {
			const rects = [...pendingRectsByTile.values()].flat();
			if (rects.length === 0) hideLoadingBbox();
			else showLoadingRegion(rects);
		};
		renderLoadingRegion();

		// Pre-seed the accumulator with whatever the source already has so the
		// existing zones don't flash off the map while tiles arrive.
		const featuresByZoneId = new Map();
		const existingSrc = mapState.map.getSource(CURB_ZONES_SOURCE_ID);
		if (existingSrc?._data?.features) {
			for (const f of existingSrc._data.features) {
				const id = f.properties?.curb_zone_id;
				if (id) featuresByZoneId.set(id, f);
			}
		}

		const upsertCurbZoneSource = (fc) => {
			const src = mapState.map.getSource(CURB_ZONES_SOURCE_ID);
			if (src) {
				src.setData(fc);
				return;
			}
			mapState.map.addSource(CURB_ZONES_SOURCE_ID, { type: 'geojson', data: fc, generateId: true });
			mapState.map.addLayer({
				id: CURB_ZONES_LAYER_ID,
				minzoom: CURB_ZONE_MINZOOM,
				type: 'line',
				source: CURB_ZONES_SOURCE_ID,
				layout: curbLayout,
				paint: {
					'line-color': parkingLineColorExpression,
					'line-width': parkingLineWidthExpression,
					'line-dasharray': parkingLineDasharrayExpression
				}
			});
			mapState.map.addLayer({
				id: CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID,
				minzoom: CURB_ZONE_MINZOOM,
				type: 'line',
				source: CURB_ZONES_SOURCE_ID,
				layout: curbLayout,
				paint: {
					'line-color': parkingEmphasisOutlineExpression,
					'line-width': scaledByZoom(widths.curbZoneEmphasisOutline)
				}
			});
			mapState.map.addLayer({
				id: CURB_ZONES_EMPHASIS_LAYER_ID,
				minzoom: CURB_ZONE_MINZOOM,
				type: 'line',
				source: CURB_ZONES_SOURCE_ID,
				layout: curbLayout,
				paint: {
					'line-color': parkingEmphasisExpression,
					'line-width': scaledByZoom(widths.curbZoneEmphasisWidth)
				}
			});
			addHoverState(CURB_ZONES_EMPHASIS_LAYER_ID, CURB_ZONES_SOURCE_ID);
			mapState.map.addLayer({
				id: CURB_ZONES_SYMBOL_LAYER_ID,
				minzoom: CURB_ZONE_MINZOOM,
				type: 'symbol',
				source: CURB_ZONES_SOURCE_ID,
				filter: parkingSymbolFilterExpression,
				layout: {
					'symbol-placement': 'line-center',
					'icon-rotation-alignment': 'viewport',
					'icon-image': parkingSymbolExpression
				},
				paint: {}
			});
			const onCurbZoneClick = (e) => {
				if (!e.features?.length) return;
				if (e.features[0]?.properties?.curb_zone_id) {
					selectCurbZoneSegment(e.features[0]);
				}
			};
			mapState.map.on('click', CURB_ZONES_LAYER_ID, onCurbZoneClick);
			mapState.map.on('click', CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID, onCurbZoneClick);
		};

		const onTileReady = (tileFC, tileBbox) => {
			for (const f of tileFC.features) {
				const id = f.properties?.curb_zone_id;
				if (id) featuresByZoneId.set(id, f);
			}
			upsertCurbZoneSource({
				type: 'FeatureCollection',
				features: [...featuresByZoneId.values()]
			});
			pendingRectsByTile.set(tileKey(tileBbox), []);
			renderLoadingRegion();
		};

		const result = await getCurbZonesByArea(min_lng, min_lat, max_lng, max_lat, day, time, {
			gridSize: GRID_SIZE,
			onTileReady
		});

		hideLoadingBbox();

		const hashSelectedId = untrack(() => selectedCurbZoneState.id);
		if (hashSelectedId) {
			const fn = () => {
				const selectedFeature = mapState.map.querySourceFeatures(CURB_ZONES_SOURCE_ID, {
					filter: ['==', ['get', 'curb_zone_id'], hashSelectedId]
				})?.[0];

				if (selectedFeature) {
					selectCurbZoneSegment(selectedFeature);
					// Set id to null, we only use this in the hash
					selectedCurbZoneState.id = null;
				}
			};

			waitForStyleLoad(mapState.map, fn);
		}
	};

	// React to viewport-driven selection changes by refetching curb zones.
	$effect(() => {
		selectedAreaState.type;
		selectedAreaState.selected;
		const fn = () => {
			if (!selectedAreaState.selected || selectedAreaState.type !== 'area') return;
			const day = untrack(() => timeState.day);
			const time = untrack(() => timeState.time);
			addCurbZonesLayers('area', day, time);
		};

		waitForStyleLoad(mapState.map, fn);
	});

	// time or day
	$effect(() => {
		const day = timeState.day;
		const time = timeState.time;
		const map = untrack(() => mapState.map);
		const selectedAreaType = untrack(() => selectedAreaState.type);
		if (map.isStyleLoaded() && selectedAreaType && (day || time)) {
			// In an ideal world we would only reprocess the data and not re-request it
			// But we receive large enough JSONs that it slows the app more to store it
			addCurbZonesLayers(selectedAreaType, timeState.day, timeState.time);
		}
	});

	// When the sign-inventory join finishes, stamp `hasDerivedSignage` on the
	// matching curb-zone features and re-setData so the paint expressions
	// re-evaluate. Without this the map can't tell which gray-dashed segments
	// have estimated data behind them.
	$effect(() => {
		const byZoneId = signsState.byZoneId;
		const source = mapState.map?.getSource?.(CURB_ZONES_SOURCE_ID);
		if (!source || !byZoneId?.size) return;
		const data = source._data;
		if (!data?.features) return;
		let changed = false;
		const nextFeatures = data.features.map((f) => {
			const has = byZoneId.has(f.properties?.curb_zone_id);
			if (!!f.properties?.hasDerivedSignage === has) return f;
			changed = true;
			return { ...f, properties: { ...f.properties, hasDerivedSignage: has } };
		});
		if (changed) source.setData({ ...data, features: nextFeatures });
	});

	// filters
	$effect(() => {
		if (filters && mapState.map.getLayer(CURB_ZONES_LAYER_ID)) {
			mapState.map.setPaintProperty(CURB_ZONES_LAYER_ID, 'line-color', parkingLineColorExpression);
			mapState.map.setPaintProperty(CURB_ZONES_LAYER_ID, 'line-width', parkingLineWidthExpression);
			mapState.map.setPaintProperty(CURB_ZONES_LAYER_ID, 'line-dasharray', parkingLineDasharrayExpression);
		}
		if (filters && mapState.map.getLayer(CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID)) {
			mapState.map.setPaintProperty(
				CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID,
				'line-color',
				parkingEmphasisOutlineExpression
			);
		}
		if (filters && mapState.map.getLayer(CURB_ZONES_EMPHASIS_LAYER_ID)) {
			mapState.map.setPaintProperty(
				CURB_ZONES_EMPHASIS_LAYER_ID,
				'line-color',
				parkingEmphasisExpression
			);
		}
		if (filters && mapState.map.getLayer(CURB_ZONES_SYMBOL_LAYER_ID)) {
			mapState.map.setFilter(CURB_ZONES_SYMBOL_LAYER_ID, parkingSymbolFilterExpression);
			mapState.map.setLayoutProperty(
				CURB_ZONES_SYMBOL_LAYER_ID,
				'icon-image',
				parkingSymbolExpression
			);
		}
	});

	// Tear down curb-zone layers when the selection is cleared (zoom drop below
	// AUTO_LOAD_MINZOOM is the only way that happens now).
	$effect(() => {
		const hasSelection = selectedAreaState.selected;
		if (mapState.map.isStyleLoaded() && !hasSelection) {
			// Remove curb zones
			if (mapState.map.getLayer(CURB_ZONES_LAYER_ID)) {
				mapState.map.removeLayer(CURB_ZONES_LAYER_ID);
				if (mapState.map.getLayer(CURB_ZONES_EMPHASIS_LAYER_ID)) {
					mapState.map.removeLayer(CURB_ZONES_EMPHASIS_LAYER_ID);
					if (mapState.map.getLayer(CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID)) {
						mapState.map.removeLayer(CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID);
						if (mapState.map.getLayer(CURB_ZONES_SYMBOL_LAYER_ID)) {
							mapState.map.removeLayer(CURB_ZONES_SYMBOL_LAYER_ID);
						}
					}
				}
				mapState.map.removeSource(CURB_ZONES_SOURCE_ID);
			}
			// Remove selected curb zone
			if (mapState.map.getLayer(SELECTED_CURB_ZONE_LAYER_ID)) {
				mapState.map.removeLayer(SELECTED_CURB_ZONE_LAYER_ID);
				mapState.map.removeLayer(SELECTED_CURB_ZONE_STROKE_LAYER_ID);
				mapState.map.removeSource(SELECTED_CURB_ZONE_SOURCE_ID);

				mapState.map.removeLayer(SELECTED_CURB_ZONE_ENDPOINT_LAYER_ID);
				mapState.map.removeLayer(SELECTED_CURB_ZONE_ENDPOINT_STROKE_LAYER_ID);
				mapState.map.removeSource(SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID);
				selectedCurbZoneState.geometry = null;
				selectedCurbZoneState.properties = null;
				selectedCurbZoneState.policies = null;
			}
		}
	});

	$effect(() => {
		const center = geocoderState?.results;
		if (center) {
			// Reuse existing marker so picking a second/Nth search result also
			// flies the map — the old guard only fired on first pick.
			if (marker) marker.setLngLat(center);
			else marker = new mapboxgl.Marker({ color: '#58585b' }).setLngLat(center).addTo(mapState.map);
			mapState.map.flyTo({ center, zoom: 16 });
		} else if (marker) {
			marker.remove();
			marker = null;
		}
	});
</script>

<div id="map" class="Map"></div>

<style lang="scss">
	.Map {
		position: relative;
		width: 100%;
		height: 100%;
	}

	:global(.mapboxgl-ctrl-top-left) {
		display: none;
	}
</style>
