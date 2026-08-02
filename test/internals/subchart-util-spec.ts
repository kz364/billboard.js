/**
 * Copyright (c) 2017 ~ present NAVER Corp.
 * billboard.js project is licensed under the MIT license
 */
/* eslint-disable */
import {describe, expect, it} from "vitest";

import {
	getMainCoordFromSubchartCoord,
	isContinuousGridFocusEnabled
} from "../../src/ChartInternal/internals/subchart.util";

/**
 * Build a minimal ChartInternal-like stub carrying only the config/state the
 * subchart focus-grid helpers read. Overrides are merged shallowly per section.
 */
function stubForContinuous(overrides: {config?: object; state?: object} = {}): any {
	return {
		config: {
			subchart_grid_focus_continuous: true,
			subchart_grid_focus: true,
			subchart_show: true,
			subchart_brush_enabled: false,
			...overrides.config
		},
		state: {
			width2: 100,
			height2: 40,
			...overrides.state
		}
	};
}

describe("SUBCHART utility", () => {
	describe("isContinuousGridFocusEnabled", () => {
		it("is enabled only when every precondition holds", () => {
			expect(isContinuousGridFocusEnabled(stubForContinuous())).to.be.true;
		});

		it("is disabled when the continuous option is off", () => {
			expect(isContinuousGridFocusEnabled(stubForContinuous({
				config: {subchart_grid_focus_continuous: false}
			}))).to.be.false;
		});

		it("is disabled when the focus grid is explicitly turned off", () => {
			// `subchart_grid_focus === false` is the only disabling value; other
			// object-valued focus configurations must keep it enabled.
			expect(isContinuousGridFocusEnabled(stubForContinuous({
				config: {subchart_grid_focus: false}
			}))).to.be.false;

			expect(isContinuousGridFocusEnabled(stubForContinuous({
				config: {subchart_grid_focus: {y: 100}}
			}))).to.be.true;
		});

		it("is disabled when the subchart is hidden", () => {
			expect(isContinuousGridFocusEnabled(stubForContinuous({
				config: {subchart_show: false}
			}))).to.be.false;
		});

		it("is disabled while the brush is enabled (continuous line only makes sense without brush)", () => {
			expect(isContinuousGridFocusEnabled(stubForContinuous({
				config: {subchart_brush_enabled: true}
			}))).to.be.false;
		});

		it("is disabled until the subchart has a measured size", () => {
			expect(isContinuousGridFocusEnabled(stubForContinuous({
				state: {width2: 0}
			}))).to.be.false;

			expect(isContinuousGridFocusEnabled(stubForContinuous({
				state: {height2: 0}
			}))).to.be.false;
		});
	});

	describe("getMainCoordFromSubchartCoord", () => {
		/**
		 * Build a stub with invertible linear-like scales.
		 * subX maps subchart pixels→domain via `invert`; mainX maps domain→main pixels.
		 * With subDomain [0,50]→[0,width2] and mainDomain [0,50]→[0,width], a subchart
		 * coordinate maps to the proportional main-chart coordinate.
		 */
		function linearStub(overrides: {config?: object; state?: object; scale?: object} = {}): any {
			const width2 = 100;
			const width = 400;
			const subX: any = (d: number) => d * (width2 / 50);
			subX.invert = (px: number) => px / (width2 / 50);

			const mainX: any = (d: number) => d * (width / 50);

			return {
				config: {axis_rotated: false, ...overrides.config},
				state: {width2, height2: 40, width, height: 120, ...overrides.state},
				scale: {x: mainX, subX, ...overrides.scale}
			};
		}

		it("maps a subchart coordinate to the proportional main-chart coordinate", () => {
			// subCoord 50px → domain 25 → main 200px (400 * 25/50)
			expect(getMainCoordFromSubchartCoord(linearStub(), 50)).to.be.equal(200);
		});

		it("prefers the zoom scale over the base x scale when both exist", () => {
			const stub = linearStub();
			// base x maps subCoord 50 -> 200; the zoom scale maps the same domain to
			// 300 (a non-boundary value), so the result must follow the zoom scale.
			stub.scale.zoom = (d: number) => d * 12;

			expect(getMainCoordFromSubchartCoord(stub, 50)).to.be.equal(300);
		});

		it("returns null when either scale is unavailable", () => {
			expect(getMainCoordFromSubchartCoord(linearStub({scale: {subX: null}}), 50))
				.to.be.null;

			const noMain = linearStub();
			noMain.scale.x = null;
			expect(getMainCoordFromSubchartCoord(noMain, 50)).to.be.null;
		});

		it("clamps the mapped coordinate to the main plot length", () => {
			// subCoord beyond the subchart still yields an in-range main coordinate.
			expect(getMainCoordFromSubchartCoord(linearStub(), 500)).to.be.equal(400);
			expect(getMainCoordFromSubchartCoord(linearStub(), -20)).to.be.equal(0);
		});

		it("falls back to a proportional mapping when the scale cannot invert (category/ordinal)", () => {
			const stub = linearStub();
			// ordinal/point scales have no `invert`; ratio 60/100 * 400 = 240.
			delete stub.scale.subX.invert;

			expect(getMainCoordFromSubchartCoord(stub, 60)).to.be.equal(240);
		});

		it("uses the proportional fallback when the main scale returns a non-finite value", () => {
			const stub = linearStub();
			// invert succeeds (domain 30) but the main scale blows up to Infinity;
			// the finite proportional fallback must take over: 60/100 * 400 = 240.
			stub.scale.x = () => Infinity;

			const result = getMainCoordFromSubchartCoord(stub, 60);

			expect(Number.isFinite(result)).to.be.true;
			expect(result).to.be.equal(240);
		});

		it("clamps the proportional fallback ratio to [0, 1]", () => {
			const over = linearStub();
			delete over.scale.subX.invert;
			expect(getMainCoordFromSubchartCoord(over, 150)).to.be.equal(400);

			const under = linearStub();
			delete under.scale.subX.invert;
			expect(getMainCoordFromSubchartCoord(under, -30)).to.be.equal(0);
		});

		it("uses vertical extents when the axis is rotated", () => {
			// Deliberately non-proportional extents so a width-only implementation
			// gives a different answer: width/width2 = 4 but height/height2 = 3.
			const stub = linearStub({config: {axis_rotated: true}});
			delete stub.scale.subX.invert;
			// fallback uses height2(40) and height(120): 10/40 * 120 = 30 (not 40).

			expect(getMainCoordFromSubchartCoord(stub, 10)).to.be.equal(30);
		});

		it("returns null when the coordinate cannot be resolved and no fallback size exists", () => {
			const stub = linearStub({state: {width2: 0}});
			// invert yields a non-finite domain and width2 is 0 → no fallback possible.
			stub.scale.subX.invert = () => NaN;

			expect(getMainCoordFromSubchartCoord(stub, 50)).to.be.null;
		});
	});
});
