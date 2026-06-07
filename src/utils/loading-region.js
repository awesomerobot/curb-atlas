// A pulsing white tint on the map showing which rectangle(s) of data are
// currently being fetched. Manages its own Mapbox source/layer and a RAF
// loop for the opacity animation. Call `createLoadingRegion(map)` once to
// get { show, hide } closures that own the source's lifecycle.

import { rectsToFeatureCollection } from './bbox-math';

const SOURCE_ID = '_loading_bbox';
const LAYER_ID = '_loading_bbox_layer';
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const TINT_COLOR = '#ffffff';
const OPACITY_MIN = 0.15;
const OPACITY_MAX = 0.45;
const PULSE_MS = 1400;

export const createLoadingRegion = (mapRef) => {
	let pulseRaf = null;
	let pulseActive = false;

	const startPulse = () => {
		if (pulseRaf) return;
		pulseActive = true;
		const tick = (t) => {
			if (!pulseActive) {
				pulseRaf = null;
				return;
			}
			// Skip a frame quietly if the layer is briefly missing (can happen
			// during a select-zone layer reorder); resume next frame instead
			// of permanently breaking the RAF chain.
			try {
				const map = mapRef();
				if (map?.getLayer?.(LAYER_ID)) {
					const phase = 0.5 - 0.5 * Math.cos((t / PULSE_MS) * Math.PI * 2);
					const opacity = OPACITY_MIN + phase * (OPACITY_MAX - OPACITY_MIN);
					map.setPaintProperty(LAYER_ID, 'fill-opacity', opacity);
				}
			} catch {}
			pulseRaf = requestAnimationFrame(tick);
		};
		pulseRaf = requestAnimationFrame(tick);
	};

	const stopPulse = () => {
		pulseActive = false;
		if (pulseRaf) cancelAnimationFrame(pulseRaf);
		pulseRaf = null;
	};

	const show = (rects) => {
		const map = mapRef();
		if (!map) return;
		const data = rectsToFeatureCollection(rects);
		const src = map.getSource(SOURCE_ID);
		if (!src) {
			map.addSource(SOURCE_ID, { type: 'geojson', data });
			map.addLayer({
				id: LAYER_ID,
				type: 'fill',
				source: SOURCE_ID,
				paint: { 'fill-color': TINT_COLOR, 'fill-opacity': OPACITY_MIN }
			});
		} else {
			src.setData(data);
		}
		startPulse();
	};

	const hide = () => {
		stopPulse();
		const map = mapRef();
		const src = map?.getSource?.(SOURCE_ID);
		if (src) src.setData(EMPTY_FC);
	};

	return { show, hide };
};
