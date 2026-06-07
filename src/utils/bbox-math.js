// Bbox = [W, S, E, N] (matches Mapbox / GeoJSON convention).

// True iff `inner` is entirely contained in `outer`. Returns false when
// outer is missing so callers can use it directly as a skip guard.
export const containsBbox = (outer, inner) =>
	!!outer &&
	inner[0] >= outer[0] &&
	inner[1] >= outer[1] &&
	inner[2] <= outer[2] &&
	inner[3] <= outer[3];

// Up-to-4-rectangle decomposition of (newBb − oldBb). Returns the new bbox
// itself when there's no prior overlap. Used to tint only the genuinely-new
// strips of a viewport refetch (vs the whole new bbox).
export const bboxDifferenceRects = (newBb, oldBb) => {
	if (!oldBb) return [newBb];
	const [nW, nS, nE, nN] = newBb;
	const [oW, oS, oE, oN] = oldBb;
	const iW = Math.max(nW, oW);
	const iE = Math.min(nE, oE);
	const iS = Math.max(nS, oS);
	const iN = Math.min(nN, oN);
	if (iE <= iW || iN <= iS) return [newBb];
	const rects = [];
	if (nN > iN) rects.push([nW, iN, nE, nN]); // strip above overlap
	if (nS < iS) rects.push([nW, nS, nE, iS]); // strip below overlap
	if (nW < iW) rects.push([nW, iS, iW, iN]); // strip left of overlap
	if (nE > iE) rects.push([iE, iS, nE, iN]); // strip right of overlap
	return rects;
};

// Build a GeoJSON FeatureCollection of rectangle polygons (one per bbox).
export const rectsToFeatureCollection = (rects) => ({
	type: 'FeatureCollection',
	features: rects.map(([w, s, e, n]) => ({
		type: 'Feature',
		properties: {},
		geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
	}))
});

// Extract a [W,S,E,N] bbox from a GeoJSON Polygon Feature's outer ring.
export const bboxFromPolygonFeature = (polygon) => {
	const ring = polygon?.geometry?.coordinates?.[0] || [];
	let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
	for (const [lng, lat] of ring) {
		if (lng < minLng) minLng = lng;
		if (lng > maxLng) maxLng = lng;
		if (lat < minLat) minLat = lat;
		if (lat > maxLat) maxLat = lat;
	}
	return [minLng, minLat, maxLng, maxLat];
};

// Build a closed rectangle polygon Feature from a bbox.
export const bboxToPolygonFeature = ([minLng, minLat, maxLng, maxLat]) => ({
	type: 'Feature',
	properties: {},
	geometry: {
		type: 'Polygon',
		coordinates: [[
			[minLng, minLat],
			[maxLng, minLat],
			[maxLng, maxLat],
			[minLng, maxLat],
			[minLng, minLat]
		]]
	}
});

// Divide a bbox into an n×n grid of sub-bboxes (row-major, west→east then
// south→north). Used to split a viewport fetch into parallel tile requests.
export const buildTileGrid = ([minLng, minLat, maxLng, maxLat], n) => {
	const tiles = [];
	const lngStep = (maxLng - minLng) / n;
	const latStep = (maxLat - minLat) / n;
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			tiles.push([
				minLng + i * lngStep,
				minLat + j * latStep,
				minLng + (i + 1) * lngStep,
				minLat + (j + 1) * latStep
			]);
		}
	}
	return tiles;
};
