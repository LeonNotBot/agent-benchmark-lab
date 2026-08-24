export const DIAGRAM_DEFAULT_ZOOM = 1;
export const DIAGRAM_MIN_ZOOM = 0.5;
export const DIAGRAM_MAX_ZOOM = 10;
export const DIAGRAM_BUTTON_ZOOM_STEP = 0.1;

function roundDiagramValue(value) {
  return Math.round(value * 100) / 100;
}

export function clampDiagramZoom(value) {
  if (!Number.isFinite(value)) {
    return DIAGRAM_DEFAULT_ZOOM;
  }

  return roundDiagramValue(
    Math.min(DIAGRAM_MAX_ZOOM, Math.max(DIAGRAM_MIN_ZOOM, value)),
  );
}

export function getButtonZoom({ currentZoom, action }) {
  if (action === "reset") {
    return DIAGRAM_DEFAULT_ZOOM;
  }

  const baseZoom = clampDiagramZoom(currentZoom);
  const delta =
    action === "zoomIn" ? DIAGRAM_BUTTON_ZOOM_STEP : -DIAGRAM_BUTTON_ZOOM_STEP;
  return clampDiagramZoom(baseZoom + delta);
}

export function getNextDiagramZoom({ currentZoom, deltaY, ctrlKey = false }) {
  const baseZoom = clampDiagramZoom(currentZoom);
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return baseZoom;
  }

  const amount = ctrlKey
    ? Math.abs(deltaY) >= 40
      ? DIAGRAM_BUTTON_ZOOM_STEP
      : Math.min(0.08, Math.max(0.02, Math.abs(deltaY) / 500))
    : DIAGRAM_BUTTON_ZOOM_STEP;
  return clampDiagramZoom(baseZoom + (deltaY < 0 ? amount : -amount));
}

export function shouldHandleDiagramWheelZoom({
  ctrlKey = false,
  metaKey = false,
}) {
  return Boolean(ctrlKey || metaKey);
}

export function getDiagramFitZoom({
  viewportWidth,
  viewportHeight,
  contentWidth,
  contentHeight,
}) {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return DIAGRAM_DEFAULT_ZOOM;
  }

  return clampDiagramZoom(
    Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight),
  );
}

export function getPanAfterZoom({ pan, currentZoom, nextZoom, anchor }) {
  const safePan = {
    x: Number.isFinite(pan?.x) ? pan.x : 0,
    y: Number.isFinite(pan?.y) ? pan.y : 0,
  };
  const safeCurrentZoom = clampDiagramZoom(currentZoom);
  const safeNextZoom = clampDiagramZoom(nextZoom);
  const safeAnchor = {
    x: Number.isFinite(anchor?.x) ? anchor.x : 0,
    y: Number.isFinite(anchor?.y) ? anchor.y : 0,
  };

  if (safeCurrentZoom === safeNextZoom) {
    return safePan;
  }

  return {
    x: roundDiagramValue(
      safeAnchor.x -
        ((safeAnchor.x - safePan.x) / safeCurrentZoom) * safeNextZoom,
    ),
    y: roundDiagramValue(
      safeAnchor.y -
        ((safeAnchor.y - safePan.y) / safeCurrentZoom) * safeNextZoom,
    ),
  };
}

export function getDraggedPan({ pan, delta }) {
  return {
    x: roundDiagramValue(
      (Number.isFinite(pan?.x) ? pan.x : 0) +
        (Number.isFinite(delta?.x) ? delta.x : 0),
    ),
    y: roundDiagramValue(
      (Number.isFinite(pan?.y) ? pan.y : 0) +
        (Number.isFinite(delta?.y) ? delta.y : 0),
    ),
  };
}

export function getPinchZoom({ startZoom, startDistance, currentDistance }) {
  if (!Number.isFinite(startDistance) || startDistance <= 0) {
    return clampDiagramZoom(startZoom);
  }

  if (!Number.isFinite(currentDistance) || currentDistance <= 0) {
    return clampDiagramZoom(startZoom);
  }

  return clampDiagramZoom(
    (clampDiagramZoom(startZoom) * currentDistance) / startDistance,
  );
}

export function getTouchDistance(firstTouch, secondTouch) {
  if (!firstTouch || !secondTouch) {
    return 0;
  }

  const deltaX = secondTouch.clientX - firstTouch.clientX;
  const deltaY = secondTouch.clientY - firstTouch.clientY;
  return Math.hypot(deltaX, deltaY);
}
