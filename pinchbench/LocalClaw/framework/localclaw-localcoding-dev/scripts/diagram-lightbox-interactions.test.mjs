import assert from "node:assert/strict";
import {
  DIAGRAM_DEFAULT_ZOOM,
  DIAGRAM_MAX_ZOOM,
  clampDiagramZoom,
  getDraggedPan,
  getButtonZoom,
  getDiagramFitZoom,
  getNextDiagramZoom,
  getPanAfterZoom,
  getPinchZoom,
  shouldHandleDiagramWheelZoom,
} from "../packages/client/src/render/diagramZoom.js";

assert.equal(DIAGRAM_DEFAULT_ZOOM, 1, "默认缩放应为 100%");
assert.equal(DIAGRAM_MAX_ZOOM, 10, "最大缩放应放宽到 1000%");
assert.equal(clampDiagramZoom(20), 10, "缩放上限应限制为 1000%");
assert.equal(clampDiagramZoom(0.1), 0.5, "缩放下限应限制为 50%");

assert.equal(
  getDiagramFitZoom({
    viewportWidth: 1600,
    viewportHeight: 900,
    contentWidth: 800,
    contentHeight: 300,
  }),
  2,
  "默认打开时应优先放大到适配全屏",
);

assert.equal(
  getButtonZoom({ currentZoom: 1, action: "zoomIn" }),
  1.1,
  "放大按钮应按 10% 递增",
);

assert.equal(
  getButtonZoom({ currentZoom: 1, action: "zoomOut" }),
  0.9,
  "缩小按钮应按 10% 递减",
);

assert.equal(
  getButtonZoom({ currentZoom: 2.2, action: "reset" }),
  1,
  "缩放辅助应保留重置到基准比例的能力",
);

assert.equal(
  shouldHandleDiagramWheelZoom({ ctrlKey: false, metaKey: false }),
  false,
  "普通滚轮应保留给滚动行为",
);

assert.equal(
  shouldHandleDiagramWheelZoom({ ctrlKey: true, metaKey: false }),
  true,
  "Ctrl+滚轮应触发缩放",
);

assert.equal(
  getNextDiagramZoom({ currentZoom: 1, deltaY: -120, ctrlKey: true }),
  1.1,
  "带缩放意图的滚轮上滚应放大 10%",
);

assert.equal(
  getNextDiagramZoom({ currentZoom: 1, deltaY: 120, ctrlKey: true }),
  0.9,
  "带缩放意图的滚轮下滚应缩小 10%",
);

assert.equal(
  getNextDiagramZoom({ currentZoom: 1, deltaY: -15, ctrlKey: true }),
  1.03,
  "触控板捏合事件应支持更细粒度缩放",
);

assert.deepEqual(
  getPanAfterZoom({
    pan: { x: 0, y: 0 },
    currentZoom: 1,
    nextZoom: 2,
    anchor: { x: 100, y: 50 },
  }),
  { x: -100, y: -50 },
  "围绕指针缩放时应保持指针下内容位置稳定",
);

assert.deepEqual(
  getDraggedPan({
    pan: { x: 24, y: -10 },
    delta: { x: -15, y: 30 },
  }),
  { x: 9, y: 20 },
  "拖拽平移应把指针位移累加到当前偏移量上",
);

assert.equal(
  getPinchZoom({ startZoom: 1, startDistance: 120, currentDistance: 180 }),
  1.5,
  "双指距离扩大时应同步放大图表",
);

console.log("diagram lightbox interaction checks passed");
