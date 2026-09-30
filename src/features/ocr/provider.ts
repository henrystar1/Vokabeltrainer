import type { OcrProvider } from './types'

/** Platzhalter, bis ein echter Anbieter angebunden wird. Es gibt bewusst keine OCR-Oberfläche. */
export const notImplementedOcr: OcrProvider = {
  id: 'not-implemented',
  async recognize() {
    throw new Error('Die Texterkennung ist noch nicht verfügbar.')
  },
}

let active: OcrProvider = notImplementedOcr

export function setOcrProvider(provider: OcrProvider): void {
  active = provider
}

export function getOcrProvider(): OcrProvider {
  return active
}
