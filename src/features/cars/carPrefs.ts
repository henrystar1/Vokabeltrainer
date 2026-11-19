/** Lokal gemerkte Auto-Einstellungen (Lieblingsauto und Lackfarbe je Auto). */
const PICK = 'vt-car-pick', COLOR = 'vt-car-color:'
export function getPick(): string | null { try { return localStorage.getItem(PICK) } catch { return null } }
export function setPick(id: string): void { try { localStorage.setItem(PICK, id) } catch { /* ignorieren */ } }
export function getColor(id: string): string | null { try { const c = localStorage.getItem(COLOR + id); return c && /^#[0-9a-f]{6}$/i.test(c) ? c : null } catch { return null } }
export function setColor(id: string, color: string | null): void { try { if (color) localStorage.setItem(COLOR + id, color); else localStorage.removeItem(COLOR + id) } catch { /* ignorieren */ } }
