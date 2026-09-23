// Identité WeshTransfer : monogramme (ligature W + T, la barre du T se
// termine en flèche de transfert) et logotype "Wesh" en violet +
// "Transfer", en Outfit grasse. Tracé repris du canevas de l'identité
// (piste A, "flèche de transfert").

const MARK_PATHS =
  '<path d="M135.733 84.8 125.733 84.933 146.8 0H183.2L155.067 100H110.8L84.933 18.8H98.267L72.4 100H28.133L0 0H36.533L57.6 84.8L47.6 84.667L73.6 0H109.6Z" fill="#A48BFF"/>' +
  '<path d="M200.048 14.8H234.448V100H200.048ZM164.048 0H258V30.667H164.048ZM256 -15L292 15.333L256 45.667Z" fill="#ECEAF0"/>';

// Le monogramme est large : 294 x 118 unités. On le dimensionne par sa hauteur.
export function monogram(height) {
  const h = height || 20;
  const w = Math.round((h * 294) / 118);
  return '<svg class="monogram" width="' + w + '" height="' + h + '" viewBox="0 -16 294 118" aria-hidden="true">' + MARK_PATHS + "</svg>";
}

export function wordmark() {
  return '<span class="wordmark"><em>Wesh</em>Transfer</span>';
}

export function logo(height) {
  return monogram(height) + wordmark();
}
