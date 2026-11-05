import LegalLayout, { V, useLegal } from './LegalLayout'

export default function Datenschutz() {
  const i = useLegal()
  if (!i) return <LegalLayout title="Datenschutzerklärung"><p>Lädt…</p></LegalLayout>
  const mail = i.DATENSCHUTZ_EMAIL || i.EMAIL
  return (
    <LegalLayout title="Datenschutzerklärung">
      <p>Hier steht, welche Daten die App verarbeitet und warum. Das ist ein Entwurf und soll vor der Veröffentlichung noch geprüft werden.</p>

      <h2>Verantwortlicher</h2>
      <p>
        <V v={i.NAME} label="NAME" />, <V v={i.STRASSE} label="STRASSE" />, <V v={i.PLZ_ORT} label="PLZ_ORT" /><br />
        E-Mail: <V v={mail} label="EMAIL" />
      </p>

      <h2>Welche Daten und wofür</h2>
      <ul>
        <li><b>Konto:</b> E-Mail-Adresse, Anzeigename, Passwort (nur als Hash, ich kann es nicht lesen), Rolle, Freischaltung. Zweck: Anmeldung und Verwaltung (Art. 6 Abs. 1 lit. b DSGVO).</li>
        <li><b>Lernen:</b> Bücher, Vokabeln, Lernstufen, Ergebnisse, Fehler, Statistik, Hausaufgaben-Häkchen. Zweck: die Lernfunktionen.</li>
        <li><b>Spiele und Community:</b> Coins, Punkte, Ranglisten, Shop-Käufe, Parkour-Ergebnisse, Gambling-Statistik (virtuelles Spielgeld), Chat-Nachrichten, Schwarzes Brett, Online-Anzeige, Duelle. Andere Nutzer sehen deinen Anzeigenamen, dein Profilbild und deine Platzierungen.</li>
        <li><b>Benachrichtigungen:</b> Wenn du Push einschaltest, wird ein Geräte-Token gespeichert und über den Push-Dienst deines Browsers (z. B. Google, Apple oder Mozilla) zugestellt. Du kannst das jederzeit in den Einstellungen ausschalten.</li>
        <li><b>KI-Funktionen (Plus):</b> Wenn du sie benutzt, werden die dafür nötigen Texte an OpenAI (USA) geschickt, um die Antwort zu erzeugen. Gib dort keine privaten Daten ein.</li>
        <li><b>Technisch:</b> Beim Aufruf entstehen kurzzeitig Server-Protokolle mit IP-Adresse beim Hosting. Im Browser werden Einstellungen und Lernstände auf deinem Gerät gespeichert (Local Storage), nur für die Funktion der App, keine Werbung, kein Tracking.</li>
      </ul>

      <h2>Dienstleister</h2>
      <ul>
        <li><b>Supabase</b> (Datenbank und Anmeldung), Region: <V v={i.SUPABASE_REGION} label="SUPABASE_REGION" />. Mit Supabase besteht ein Auftragsverarbeitungsvertrag.</li>
        <li><b>Zweites Supabase-Projekt für die Parkour-Echtzeit:</b> Betreiber <V v={i.SPIEL_SUPABASE_BETREIBER} label="SPIEL_SUPABASE_BETREIBER" />, Region <V v={i.SPIEL_SUPABASE_REGION} label="SPIEL_SUPABASE_REGION" />. Dorthin gehen nur Spiel-Nachrichten (Position, Herzen, Spielername) während einer Parkour-Runde, keine Konto- oder Lerndaten.</li>
        <li><b>GitHub Pages</b> (Hosting der Website, GitHub Inc./Microsoft, USA): Dabei wird deine IP-Adresse verarbeitet.</li>
        <li><b>flagcdn.com</b> (Flaggenbilder im Flaggen-Lernen): Dein Browser lädt sie direkt von dort, dabei wird deine IP-Adresse übertragen. Die Schriftarten liegen auf dem eigenen Server und werden nicht von Google geladen.</li>
        <li><b>Auf der Seite „Websites“</b> werden Vorschauen eingebetteter Fremdseiten geladen. Dabei verbindet sich dein Browser mit diesen Seiten.</li>
      </ul>
      <p>Bei Diensten in den USA stützt sich die Übermittlung auf Standardvertragsklauseln bzw. das EU-US Data Privacy Framework.</p>

      <h2>Speicherdauer</h2>
      <p>Konto- und Lerndaten bleiben, bis du dein Konto löschen lässt. Chat-Nachrichten und Online-Anzeige werden nach kurzer Zeit automatisch gelöscht. Gambling-Feed-Einträge nach wenigen Tagen. Backups können zeitverzögert nachlaufen.</p>

      <h2>Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Schreib dafür an <V v={mail} label="EMAIL" />. Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei: <V v={i.AUFSICHTSBEHOERDE} label="AUFSICHTSBEHOERDE" />.
      </p>

      <h2>Kinder und Jugendliche</h2>
      <p>Wer jünger als 16 ist, sollte sich nur mit Zustimmung der Eltern registrieren. Neue Konten müssen außerdem von mir freigeschaltet werden.</p>
    </LegalLayout>
  )
}
