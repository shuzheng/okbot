export const SIDEBAR_DEFAULT = 250;
export const SIDEBAR_MIN = 80;
export const SIDEBAR_MAX = 400;
/**
 * Collapse threshold for expanded → icon rail.
 * Was 156 (traffic-lights inset ~68–78 + topbar icons ~68).
 * Lowered to 128 so expanded search/+ can sit closer to the traffic lights
 * before snapping to the rail; drag hysteresis still uses NARROW + EXPAND_HYST.
 */
export const SIDEBAR_NARROW_AT = 128;
/** Drag hysteresis: from rail, only re-expand after passing NARROW + this. */
export const SIDEBAR_EXPAND_HYST = 28;
/** Splitter mouseup with |dx| ≤ this is treated as click (toggle), not drag. */
export const SPLITTER_CLICK_SLOP = 4;
export const MAIN_COLLAPSE_AT = 450;
