declare module 'apca-w3' {
  /** APCA lightness contrast Lc of text over background, both as screen luminance Y (sRGBtoY). */
  export function APCAcontrast(textY: number, bgY: number): number;
  export function sRGBtoY(rgb: [number, number, number]): number;
}
