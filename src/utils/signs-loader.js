// Lazy loader + spatial index for the derived sign inventory. Loads
// /signs.geojson (~8 MB) on first use, caches it in memory, then exposes
// a join helper that takes a curb zone GeoJSON FeatureCollection and
// attaches the nearby signs (with derived CDS policies) to each zone.
//
// We index signs into a coarse grid (~111 m at this latitude) so the
// per-zone join only checks signs in adjacent grid cells. That avoids
// the O(zones × signs) blow-up for areas with thousands of zones.

import pointToLineDistance from '@turf/point-to-line-distance';
import { base } from '$app/paths';

const SIGNS_URL = `${base}/signs.geojson`;

// 0.001 degrees ≈ 111 m at Boston latitude; signs along a curb segment
// snap within ~10 m, so one cell of slop is plenty.
const GRID_SIZE_DEG = 0.001;
const SNAP_DISTANCE_METERS = 12;

let loadPromise = null;
let cache = null; // { features, byOid, grid, photoUrlPrefix }

const cellKey = (lng, lat) =>
	`${Math.floor(lng / GRID_SIZE_DEG)}:${Math.floor(lat / GRID_SIZE_DEG)}`;

const buildIndex = (collection) => {
	const byOid = new Map();
	const grid = new Map();
	for (const f of collection.features) {
		byOid.set(String(f.id), f);
		const [lng, lat] = f.geometry.coordinates;
		const key = cellKey(lng, lat);
		let bucket = grid.get(key);
		if (!bucket) {
			bucket = [];
			grid.set(key, bucket);
		}
		bucket.push(f);
	}
	return { byOid, grid };
};

export const loadSigns = async () => {
	if (cache) return cache;
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		const res = await fetch(SIGNS_URL);
		if (!res.ok) throw new Error(`signs.geojson fetch failed: ${res.status}`);
		const fc = await res.json();
		const { byOid, grid } = buildIndex(fc);
		cache = {
			features: fc.features,
			byOid,
			grid,
			photoUrlPrefix: fc.meta?.photoUrlPrefix || ''
		};
		return cache;
	})();
	return loadPromise;
};

// Bounding box of a curb zone (LineString) for grid prefiltering.
const zoneBbox = (geometry) => {
	let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
	for (const [lng, lat] of geometry.coordinates) {
		if (lng < minLng) minLng = lng;
		if (lng > maxLng) maxLng = lng;
		if (lat < minLat) minLat = lat;
		if (lat > maxLat) maxLat = lat;
	}
	return [minLng, minLat, maxLng, maxLat];
};

const candidatesInBbox = (grid, [minLng, minLat, maxLng, maxLat]) => {
	const result = [];
	const minIx = Math.floor(minLng / GRID_SIZE_DEG) - 1;
	const maxIx = Math.floor(maxLng / GRID_SIZE_DEG) + 1;
	const minIy = Math.floor(minLat / GRID_SIZE_DEG) - 1;
	const maxIy = Math.floor(maxLat / GRID_SIZE_DEG) + 1;
	for (let ix = minIx; ix <= maxIx; ix++) {
		for (let iy = minIy; iy <= maxIy; iy++) {
			const bucket = grid.get(`${ix}:${iy}`);
			if (bucket) result.push(...bucket);
		}
	}
	return result;
};

// Given a loaded sign cache and a curb zone FeatureCollection, return
// a Map curb_zone_id → Sign[] for zones that have any signs within
// SNAP_DISTANCE_METERS of their LineString.
export const joinSignsToZones = ({ grid }, zoneCollection) => {
	const byZoneId = new Map();
	if (!zoneCollection || !zoneCollection.features) return byZoneId;

	for (const zone of zoneCollection.features) {
		const zid = zone.properties?.curb_zone_id;
		if (!zid || zone.geometry?.type !== 'LineString') continue;
		const candidates = candidatesInBbox(grid, zoneBbox(zone.geometry));
		if (!candidates.length) continue;
		const hits = [];
		for (const sign of candidates) {
			const d = pointToLineDistance(sign.geometry.coordinates, zone, { units: 'meters' });
			if (d <= SNAP_DISTANCE_METERS) hits.push(sign);
		}
		if (hits.length) byZoneId.set(zid, hits);
	}
	return byZoneId;
};

export const resolvePhotoUrl = (path, photoUrlPrefix) =>
	/^https?:\/\//.test(path) ? path : `${photoUrlPrefix}${path}`;
