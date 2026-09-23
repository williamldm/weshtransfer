// Identité WeshTransfer : monogramme (le W aux trois cheminées fumantes)
// et logotype "Wesh" italique + "Transfer", en Bodoni Moda.
// Tracé repris tel quel du canevas de l'identité.

const MARK_PATHS =
  '<path d="M20 6 C 11 -2, 30 -9, 21 -19" stroke="#8B6CF0" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.45"/>' +
  '<path d="M70 6 C 58 0, 82 -6, 70 -13 L 70 -25" stroke="#EEE9F5" stroke-width="6.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<polygon points="70,-44 55,-19 85,-19" fill="#EEE9F5"/>' +
  '<path d="M120 6 C 111 -2, 130 -9, 121 -19" stroke="#8B6CF0" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.45"/>' +
  '<polyline points="20,12 20,50 45,130 70,50 95,130 120,50 120,12" fill="none" stroke="#EEE9F5" stroke-width="12" stroke-linejoin="miter"/>' +
  '<line x1="70" y1="12" x2="70" y2="54" stroke="#EEE9F5" stroke-width="12"/>' +
  '<rect x="11" y="8" width="18" height="5" fill="#EEE9F5"/>' +
  '<rect x="61" y="8" width="18" height="5" fill="#EEE9F5"/>' +
  '<rect x="111" y="8" width="18" height="5" fill="#EEE9F5"/>' +
  '<rect x="14" y="22" width="12" height="4" fill="#8B6CF0"/>' +
  '<rect x="64" y="22" width="12" height="4" fill="#8B6CF0"/>' +
  '<rect x="114" y="22" width="12" height="4" fill="#8B6CF0"/>';

// hauteur en px ; le monogramme est plus haut que large (140 x 204)
export function monogram(height) {
  const h = height || 28;
  const w = Math.round((h * 140) / 204);
  return '<svg class="monogram" width="' + w + '" height="' + h + '" viewBox="0 -46 140 204" aria-hidden="true">' + MARK_PATHS + "</svg>";
}

export function wordmark() {
  return '<span class="wordmark"><em>Wesh</em>Transfer</span>';
}

export function logo(height) {
  return monogram(height) + wordmark();
}
