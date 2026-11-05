import LegalLayout, { V, useLegal } from './LegalLayout'

export default function Impressum() {
  const i = useLegal()
  if (!i) return <LegalLayout title="Impressum"><p>Lädt…</p></LegalLayout>
  return (
    <LegalLayout title="Impressum">
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        <V v={i.NAME} label="NAME" /><br />
        <V v={i.STRASSE} label="STRASSE" /><br />
        <V v={i.PLZ_ORT} label="PLZ_ORT" />
      </p>
      <h2>Kontakt</h2>
      <p>
        E-Mail: <V v={i.EMAIL} label="EMAIL" /><br />
        Telefon: <V v={i.TELEFON} label="TELEFON" />
      </p>
      <h2>Verantwortlich für Inhalte</h2>
      <p>
        Verantwortlich nach § 18 Abs. 2 MStV: <V v={i.NAME} label="NAME" />, Anschrift wie oben. Beiträge im Chat, Texte auf dem Schwarzen Brett und eingetragene Vokabeln stammen von den Nutzerinnen und Nutzern.
      </p>
      <h2>Hinweise zu Inhalten und Links</h2>
      <p>
        Auf der Seite „Websites“ und im Chat können Links zu fremden Seiten stehen. Für deren Inhalte sind allein die jeweiligen Betreiber verantwortlich. Zum Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar. Wenn dir etwas Rechtswidriges auffällt, nutze die Melden-Funktion in der App oder schreib an die E-Mail-Adresse oben, dann wird es geprüft und bei Bedarf entfernt.
      </p>
      <p>
        In der App gibt es virtuelle Coins und Punkte. Sie haben keinen Geldwert und lassen sich nicht auszahlen. Die Nutzung der App ist kostenlos.
      </p>
    </LegalLayout>
  )
}
