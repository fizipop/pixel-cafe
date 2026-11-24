import test from "node:test";
import assert from "node:assert/strict";
import { GRID, emptyPixels, floodFill, lineCells, paintCells, isValidPixels } from "./editor.ts";

test("paintCells paints and ignores out-of-bounds", () => {
  const p = paintCells(emptyPixels(), [[0, 0], [GRID, 5], [-1, 2]], "#ff0000");
  assert.equal(p[0], "#ff0000");
  assert.equal(p.filter(Boolean).length, 1);
});

test("paintCells returns same array when nothing changes", () => {
  const p = emptyPixels();
  assert.equal(paintCells(p, [[1, 1]], ""), p);
});

test("lineCells has no gaps and hits both ends", () => {
  const cells = lineCells(0, 0, 10, 4);
  assert.deepEqual(cells[0], [0, 0]);
  assert.deepEqual(cells[cells.length - 1], [10, 4]);
  for (let i = 1; i < cells.length; i++) {
    assert.ok(Math.abs(cells[i][0] - cells[i - 1][0]) <= 1);
    assert.ok(Math.abs(cells[i][1] - cells[i - 1][1]) <= 1);
  }
});

test("floodFill fills an enclosed region only", () => {
  let p = emptyPixels();
  // draw a 5x5 box outline at (2,2)-(6,6)
  const box: [number, number][] = [];
  for (let i = 2; i <= 6; i++) box.push([i, 2], [i, 6], [2, i], [6, i]);
  p = paintCells(p, box, "#000000");
  const filled = floodFill(p, 4, 4, "#00ff00");
  assert.equal(filled.filter((c) => c === "#00ff00").length, 9); // 3x3 inside
  assert.equal(filled[0], ""); // outside untouched
});

test("floodFill on empty canvas fills everything; same colour is a no-op", () => {
  const p = emptyPixels();
  assert.equal(floodFill(p, 0, 0, "").length, GRID * GRID);
  assert.equal(floodFill(p, 0, 0, ""), p);
  assert.ok(floodFill(p, 3, 3, "#123456").every((c) => c === "#123456"));
});

test("isValidPixels rejects bad data", () => {
  assert.ok(isValidPixels(emptyPixels()));
  assert.ok(!isValidPixels([]));
  assert.ok(!isValidPixels(Array(GRID * GRID).fill("red")));
});
