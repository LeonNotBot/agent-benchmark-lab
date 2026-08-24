export declare const DIAGRAM_DEFAULT_ZOOM: number;
export declare const DIAGRAM_MIN_ZOOM: number;
export declare const DIAGRAM_MAX_ZOOM: number;
export declare const DIAGRAM_BUTTON_ZOOM_STEP: number;

export declare function clampDiagramZoom(value: number): number;
export declare function getButtonZoom(params: { currentZoom: number; action: "zoomIn" | "zoomOut" | "reset" }): number;
export declare function getNextDiagramZoom(params: { currentZoom: number; deltaY: number; ctrlKey?: boolean }): number;
export declare function shouldHandleDiagramWheelZoom(params: { ctrlKey?: boolean; metaKey?: boolean }): boolean;
export declare function getDiagramFitZoom(params: { viewportWidth: number; viewportHeight: number; contentWidth: number; contentHeight: number }): number;
export declare function getPanAfterZoom(params: { pan: { x: number; y: number }; currentZoom: number; nextZoom: number; anchor: { x: number; y: number } }): { x: number; y: number };
export declare function getDraggedPan(params: { pan: { x: number; y: number }; delta: { x: number; y: number } }): { x: number; y: number };
export declare function getPinchZoom(params: { startZoom: number; startDistance: number; currentDistance: number }): number;
export declare function getTouchDistance(firstTouch: { clientX: number; clientY: number } | null, secondTouch: { clientX: number; clientY: number } | null): number;
