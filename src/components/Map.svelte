<script>
	import { onMount, untrack } from 'svelte';
	import throttle from 'lodash.throttle';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import { mapboxAccessToken, maxBounds, dasharrays, widths, colors, CURB_ZONE_MINZOOM, AUTO_LOAD_MINZOOM, TIMEOUT } from '../constants';
	import { simplifyFilters } from '../utils/basic-utils';
	import {
		geocoderState,
		mapState,
		selectedAreaState,
		selectedCurbZoneState,
		timeState,
		filterState
	} from '../state.svelte';
	import { getCurbZonesByArea } from '../utils/get-curb-zones';
	import { getCurbPoliciesById } from '../utils/get-curb-policies-by-id';
	import NoZonesModal from './NoZonesModal.svelte';
	import * as turf from '@turf/turf';

	let showNoZoneWarning = $state(false);

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

	const curbLayout = {
		'line-join': 'round',
		'line-cap': 'round'
	};

	const curbFilter = ['!=', ['get', 'selectionOnly'], true];

	const filters = $derived(simplifyFilters(filterState.current));

	const generateNestedCondition = (bothResult, permittedResult, paidResult, defaultResult) => [
			'case',
			[
				'all',
				['has', 'permitted'],
				['==', ['get', 'permitted'], true],
				['has', 'paid'],
				['==', ['get', 'paid'], true]
			],
			bothResult,
			['all', ['has', 'permitted'], ['==', ['get', 'permitted'], true]],
			permittedResult,
			['all', ['has', 'paid'], ['==', ['get', 'paid'], true]],
			paidResult,
			defaultResult
		];

	const generateOuterNestedCondition = (isLoadingZone, isAccessible, loadingResult, accessibleResult, nestedCondition) => {
		// If both, accessible gets priority
		if (isLoadingZone && isAccessible) {
			return [
				'case',
				['to-boolean', ['get', 'accessible']],
				accessibleResult,
				['to-boolean', ['get', 'loadingZone']],
				loadingResult,
				nestedCondition
			];
		} else if (isAccessible) {
			return [
				'case',
				['to-boolean', ['get', 'accessible']],
				accessibleResult,
				nestedCondition
			];
		} else if (isLoadingZone) {
			return [
				'case',
				['to-boolean', ['get', 'loadingZone']],
				loadingResult,
				nestedCondition
			];
		} else {
			return nestedCondition;
		}
	};

	const generateCanParkCondition = (permitted, paid) => {
		if (permitted && paid) {
			return ['to-boolean', ['get', 'canPark']];
		} else if (permitted) {
			return [
				'all',
				['to-boolean', ['get', 'canPark']],
				['!', ['to-boolean', ['get', 'paid']]]
			];
		} else if (paid) {
			return [
				'all',
				['to-boolean', ['get', 'canPark']],
				['!', ['to-boolean', ['get', 'permitted']]]
			];
		} else {
			return [
				'all',
				['to-boolean', ['get', 'canPark']],
				['!', ['to-boolean', ['get', 'permitted']]],
				['!', ['to-boolean', ['get', 'paid']]]
			];
		}
	};

	const parkingLineWidthExpression = $derived.by(() => {
		const { paid, permitted } = filters;

		let condition = generateCanParkCondition(permitted, paid);

		return [
			'case',
			['to-boolean', ['get', 'unusableImage']],
			widths.unusableCurbZoneWidth,
			condition,
			widths.curbZoneWidth,
			widths.notAllowedCurbZoneWidth
		];
	});

	const parkingLineDasharrayExpression = $derived.by(() => {
		const { paid, permitted } = filters;

		let condition = generateCanParkCondition(permitted, paid);

		return [
			'case',
			['to-boolean', ['get', 'unusableImage']],
			dasharrays.unusableImageDasharray, // red dashed line
			condition,
			dasharrays.curbZoneDasharray, // solid line
			dasharrays.notAllowedCurbZoneDasharray // dotted line
		];
	});

	const parkingLineColorExpression = $derived.by(() => {
		const { paid, permitted, accessible, loadingZone } = filters;

		let nestedCondition = generateNestedCondition(
			colors.parkingAllowedPermittedPaid,
			colors.parkingAllowedPermitted,
			colors.parkingAllowedPaid,
			colors.parkingAllowed
		);

		let nestedConditionLightened = generateNestedCondition(
			colors.parkingAllowedPermittedPaidLight,
			colors.parkingAllowedPermittedLight,
			colors.parkingAllowedPaidLight,
			colors.parkingAllowedLight
		);

		let fallback = colors.parkingNotAllowed;

		let condition = generateCanParkCondition(permitted, paid);

		if (loadingZone || accessible) {
			nestedCondition = generateOuterNestedCondition(
				loadingZone,
				accessible,
				colors.loading,
				colors.accessible,
				nestedConditionLightened
			);
			fallback = colors.parkingNotAllowedLight;
		}	

		return [
			'case',
			['to-boolean', ['get', 'unusableImage']],
			colors.unusableImage,
			['boolean', ['feature-state', 'hover'], false],
			colors.hoverHighlightColor,
			condition,
			nestedCondition,
			fallback
		];
	});

	const parkingEmphasisOutlineExpression = $derived.by(() => {
		const { accessible, loadingZone } = filters;
		let condition = 'transparent';
		let outlineColor = '#ffffff';

		return generateOuterNestedCondition(
			loadingZone,
			accessible,
			outlineColor,
			outlineColor,
			condition
		);
	});

	const parkingEmphasisExpression = $derived.by(() => {
		const { accessible, loadingZone } = filters;
		let condition = 'transparent';

		return [
			'case',
			['boolean', ['feature-state', 'hover'], false],
			colors.hoverHighlightColor,
			generateOuterNestedCondition(
				loadingZone,
				accessible,
				colors.loading,
				colors.accessible,
				condition
			)
		];
	});

	const parkingSymbolExpression = $derived.by(() => {
		const { accessible, loadingZone } = filters;
		let condition = 'none'; // default no symbol

		// If both, accessible gets priority
		if (loadingZone && accessible) {
			condition = [
				'case',
				['to-boolean', ['get', 'accessible']],
				[
					'image',
					'wheelchair 24x24',
					{
						params: {
							'color-2': colors.accessibleIconFill,
							'color-1': colors.accessibleIconStroke
						}
					}
				],
				[
					'image',
					'loading 24x24',
					{
						params: {
							'color-2': colors.loadingIconFill,
							'color-1': colors.loadingIconStroke
						}
					}
				]
			];
		} else if (accessible) {
			condition = [
				'image',
				'wheelchair 24x24',
				{
					params: {
						'color-2': colors.accessibleIconFill,
						'color-1': colors.accessibleIconStroke
					}
				}
			];
		} else if (loadingZone) {
			condition = [
				'image',
				'loading 24x24',
				{
					params: {
						'color-2': colors.loadingIconFill,
						'color-1': colors.loadingIconStroke
					}
				}
			];
		}

		return condition;
	});

	const parkingSymbolFilter = $derived.by(() => {
		const { accessible, loadingZone } = filters;
		let condition = false;

		if (loadingZone && accessible) {
			condition = [
				'any',
				['to-boolean', ['get', 'accessible']],
				['to-boolean', ['get', 'loadingZone']]
			];
		} else if (accessible) {
			condition = ['to-boolean', ['get', 'accessible']];
		} else if (loadingZone) {
			condition = ['to-boolean', ['get', 'loadingZone']];
		}

		return condition;
	});

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
			maxZoom: 17
		});

		mapState.map.addControl(
			new mapboxgl.AttributionControl({
				customAttribution: 'Designed by <a href="https://stamen.com">Stamen</a>'
			})
		);

		mapState.map.on('move', throttledSetPositionState);

		// Auto-load curb zones for whatever's currently in view (above AUTO_LOAD_MINZOOM).
		// Drop the existing selection when the user zooms back out so the cleanup
		// effect tears down the layers and the "zoom in" prompt shows clean.
		const syncViewportSelection = () => {
			const zoom = mapState.map.getZoom();
			if (zoom < AUTO_LOAD_MINZOOM) {
				if (selectedAreaState.selected) {
					selectedAreaState.selected = null;
					selectedAreaState.type = null;
					selectedAreaState.isViewport = false;
				}
				return;
			}
			const b = mapState.map.getBounds();
			const sw = b.getSouthWest();
			const ne = b.getNorthEast();
			const polygon = {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [[
						[sw.lng, sw.lat],
						[ne.lng, sw.lat],
						[ne.lng, ne.lat],
						[sw.lng, ne.lat],
						[sw.lng, sw.lat]
					]]
				}
			};
			selectedAreaState.isViewport = true;
			selectedAreaState.type = 'area';
			selectedAreaState.selected = polygon;
		};

		mapState.map.on('moveend', syncViewportSelection);

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
		// Remove selected curb zone
		if (mapState.map.getLayer(SELECTED_CURB_ZONE_LAYER_ID)) {
			mapState.map.removeLayer(SELECTED_CURB_ZONE_LAYER_ID);
			mapState.map.removeLayer(SELECTED_CURB_ZONE_STROKE_LAYER_ID);
			mapState.map.removeSource(SELECTED_CURB_ZONE_SOURCE_ID);

			mapState.map.removeLayer(SELECTED_CURB_ZONE_ENDPOINT_LAYER_ID);
			mapState.map.removeLayer(SELECTED_CURB_ZONE_ENDPOINT_STROKE_LAYER_ID);
			mapState.map.removeSource(SELECTED_CURB_ZONE_ENDPOINT_SOURCE_ID);
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

	const addCurbZonesLayers = async (type, day, time) => {
		let fetchFn = null;

		if (type === 'area') {
			const { min_lng, min_lat, max_lng, max_lat } =
				selectedAreaState.selected.geometry.coordinates[0].reduce(
					(acc, coord) => {
						const [lng, lat] = coord;
						if (lng < acc.min_lng) acc.min_lng = lng;
						if (lng > acc.max_lng) acc.max_lng = lng;
						if (lat < acc.min_lat) acc.min_lat = lat;
						if (lat > acc.max_lat) acc.max_lat = lat;
						return acc;
					},
					{
						min_lng: Infinity,
						min_lat: Infinity,
						max_lng: -Infinity,
						max_lat: -Infinity
					}
				);
			fetchFn = () => getCurbZonesByArea(min_lng, min_lat, max_lng, max_lat, day, time);
		}

		if (!fetchFn) return;

		const curbZones = await fetchFn().then((curbZones) => {
			if (!curbZones || !curbZones.features.length) {
				showNoZoneWarning = true;
				return;
			}

			// Clipping logic (potentially move to its own discrete function)
			const selectedArea = JSON.parse(JSON.stringify(selectedAreaState.selected));

			// Setup an empty array to collect line segmets clipped by clip area
			let linesArray = [];

			turf.featureEach(JSON.parse(JSON.stringify(curbZones)), (line) => {
				const { properties } = line;
				// Check if the line feature is fully within the clip area. If it is, add it to linesArray.
				// Add "innerLine" property to be used alongside "selectionOnly"
				if (turf.booleanWithin(line, selectedArea)) {
					const innerLine = { ...line, properties: { ...properties, innerLine: true } };
					linesArray.push(innerLine);
				} else {
					// If the feature is not fully within the clip area, split the line by the clip area
					let splitResults = turf.lineSplit(line, selectedArea);
					// Ignore this for curb zones layer, but not selected layer by adding the "selectionOnly" flag
					// This is duplicative so we can show a full segment for selection
					const edgeLine = { ...line, properties: { ...properties, selectionOnly: true } };
					linesArray.push(edgeLine);
					// Take the resulting features from the split, calculate a point on surface, and
					// check if the point is within the clip area. If it is, add the line segment to linesArray.
					turf.featureEach(splitResults, (splitResult) => {
						splitResult.properties = properties;
						let pof = turf.pointOnFeature(splitResult);
						if (turf.booleanWithin(pof, selectedArea)) {
							linesArray.push(splitResult);
						}
					});
				}
			});

			const nextData = turf.featureCollection(linesArray);

			const nextSource = {
				type: 'geojson',
				data: nextData,
				generateId: true
			};

			const existingSource = mapState.map.getSource(CURB_ZONES_SOURCE_ID);

			if (!existingSource) {
				mapState.map.addSource(CURB_ZONES_SOURCE_ID, nextSource);

				const nextLayer = {
					id: CURB_ZONES_LAYER_ID,
					minzoom: CURB_ZONE_MINZOOM,
					type: 'line',
					source: CURB_ZONES_SOURCE_ID,
					filter: curbFilter,
					layout: curbLayout,
					paint: {
						'line-color': parkingLineColorExpression,
						'line-width': parkingLineWidthExpression,
						'line-dasharray': parkingLineDasharrayExpression,
					}
				};

				mapState.map.addLayer(nextLayer);

				const emphasisOutlineLayer = {
					id: CURB_ZONES_EMPHASIS_OUTLINE_LAYER_ID,
					minzoom: CURB_ZONE_MINZOOM,
					type: 'line',
					source: CURB_ZONES_SOURCE_ID,
					layout: curbLayout,
					paint: {
						'line-color': parkingEmphasisOutlineExpression,
						'line-width': widths.curbZoneEmphasisOutline
					}
				};

				mapState.map.addLayer(emphasisOutlineLayer);

				const emphasisLayer = {
					id: CURB_ZONES_EMPHASIS_LAYER_ID,
					minzoom: CURB_ZONE_MINZOOM,
					type: 'line',
					source: CURB_ZONES_SOURCE_ID,
					filter: curbFilter,
					layout: curbLayout,
					paint: {
						'line-color': parkingEmphasisExpression,
						'line-width': widths.curbZoneEmphasisWidth
					}
				};

				mapState.map.addLayer(emphasisLayer);

				addHoverState(CURB_ZONES_EMPHASIS_LAYER_ID, CURB_ZONES_SOURCE_ID);

				const symbolLayer = {
					id: CURB_ZONES_SYMBOL_LAYER_ID,
					minzoom: CURB_ZONE_MINZOOM,
					type: 'symbol',
					source: CURB_ZONES_SOURCE_ID,
					filter: curbFilter,
					filter: parkingSymbolFilter,
					layout: {
						'symbol-placement': 'line-center',
						'icon-rotation-alignment': 'viewport',
						'icon-image': parkingSymbolExpression
					},
					paint: {}
				};

				mapState.map.addLayer(symbolLayer);

				mapState.map.on('click', CURB_ZONES_LAYER_ID, (e) => {
					if (!e.features?.length) return;
					const feature = e.features[0];
					// Query the source because we want to pass the non-cropped geometries to selected segment
					const selectionFeatures = mapState.map.querySourceFeatures(CURB_ZONES_SOURCE_ID, {
						filter: [
							'all',
							['any', ['==', 'selectionOnly', true], ['==', 'innerLine', true]],
							['==', 'curb_zone_id', feature?.properties?.curb_zone_id]
						]
					});

					selectCurbZoneSegment(selectionFeatures[0]);
				});
			} else {
				existingSource.setData(nextData);
			}
		});

		const hashSelectedId = untrack(() => selectedCurbZoneState.id);
		if (hashSelectedId) {
			const fn = () => {
				const selectedFeature = mapState.map.querySourceFeatures(CURB_ZONES_SOURCE_ID, {
					filter: [
						'all',
						['any', ['==', 'selectionOnly', true], ['==', 'innerLine', true]],
						['==', 'curb_zone_id', hashSelectedId]
					]
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
			mapState.map.setFilter(CURB_ZONES_SYMBOL_LAYER_ID, parkingSymbolFilter);
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
		if (geocoderState?.results && !marker) {
			const center = geocoderState.results;
			marker = new mapboxgl.Marker({ color: '#58585b' }).setLngLat(center).addTo(mapState.map);
			mapState.map.flyTo({ center, zoom: 16 });
		} else if (!geocoderState?.results && marker) {
			marker.remove();
			marker = null;
		}
	});
</script>

<div id="map" class="Map">
	{#if showNoZoneWarning}
		<NoZonesModal onClose={() => (showNoZoneWarning = false)} />
	{/if}
</div>

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
