/** Französische Oberfläche für das Auto-Spiel: Wörterbuch + Muster + ein kleiner DOM-Übersetzer (Texte, aria-label, title, placeholder). */

export type RaceLang = 'de' | 'fr'

/** Exakte Sätze/Wörter (ohne Leerraum an den Rändern). */
export const FR: Record<string, string> = {
  // Seiten, Tabs, Autohaus
  Showroom: 'Salon', Kaufen: 'Acheter', Tuning: 'Tuning', Rennen: 'Course', Rangliste: 'Classement', Autobahn: 'Autoroute', Autohaus: 'Concession',
  'Kaufe Autos mit deinen Coins und sammle sie in deiner Garage': 'Achète des voitures avec tes pièces et collectionne-les dans ton garage',
  'In der Garage': 'Dans le garage', 'Meine Garage': 'Mon garage',
  'Du brauchst erst ein Auto. Kaufe eins unter „Kaufen“.': 'Il te faut d’abord une voiture. Achètes-en une sous « Acheter ».',
  'Dein Auto:': 'Ta voiture :', '· Fahrassistent mit F oder dem Knopf im Rennen': '· Assistant de conduite avec F ou le bouton en course',
  'Online-Rennen mit Freunden starten →': 'Lancer une course en ligne avec des amis →',
  Höchstgeschwindigkeit: 'Vitesse maximale', 'Höchstgeschwindigkeit im Rennen': 'Vitesse maximale en course', 'Höchstgeschw.': 'Vit. max', Max: 'Max', Maximal: 'Maximum',
  '✈ kann fliegen': '✈ peut voler', 'kann fliegen': 'peut voler', '· ✈ kann fliegen': '· ✈ peut voler',
  'Vorheriges Auto': 'Voiture précédente', 'Nächstes Auto': 'Voiture suivante', 'Drehbares 3D-Bild des Autos': 'Image 3D rotative de la voiture',
  '3D-Ansicht nicht verfügbar': 'Vue 3D indisponible', 'Keine Autos verfügbar.': 'Aucune voiture disponible.', '← zurück zum Showroom': '← retour au salon',
  'Preis:': 'Prix :', Farbe: 'Couleur', eigene: 'perso', 'Eigene Farbe': 'Couleur perso', Originalfarbe: 'Couleur d’origine',
  'Die Farbe wird auf diesem Gerät gemerkt und gilt im Rennen und online.': 'La couleur est mémorisée sur cet appareil et vaut en course et en ligne.',
  'Kaufe das Auto, um damit zu fahren.': 'Achète la voiture pour la conduire.', '(Admin-Auto)': '(voiture admin)',
  'Wirklich verkaufen? Du bekommst die Hälfte des Kaufpreises zurück, das Tuning geht verloren. Nochmal tippen zum Bestätigen.': 'Vraiment vendre ? Tu récupères la moitié du prix, le tuning est perdu. Appuie encore pour confirmer.',
  '+4 % Lenkung': '+4 % direction', '+6 % Bremsen': '+6 % freins', 'Sitzplätze pro Auto': 'Places par voiture',
  'Lauftempo in Metern pro Sekunde': 'Vitesse de marche en mètres par seconde', 'Sprinttempo in Metern pro Sekunde': 'Vitesse de sprint en mètres par seconde',
  Gespeichert: 'Enregistré', 'Gespeichert.': 'Enregistré.', 'Mitfahren und Laufen (Admin)': 'Passagers et marche (admin)',
  'Wie viele Leute in ein Auto passen (der Erste fährt, die anderen fahren mit) und wie schnell die Figur läuft und sprintet.': 'Combien de personnes tiennent dans une voiture (le premier conduit, les autres sont passagers) et à quelle vitesse le personnage marche et sprinte.',
  Sitzplätze: 'Places', Laufen: 'Marche', Sprint: 'Sprint',
  'Verbessern': 'Améliorer', 'Verkaufen': 'Vendre',
  // Tuning
  '+4 % Höchstgeschwindigkeit, +8 % Beschleunigung je Stufe': '+4 % de vitesse max, +8 % d’accélération par niveau', '+4 % Lenkung und Grip je Stufe': '+4 % de direction et d’adhérence par niveau', '+6 % Bremskraft je Stufe': '+6 % de freinage par niveau',
  // Rangliste
  'Die Rangliste konnte nicht geladen werden.': 'Impossible de charger le classement.', 'Schnellste Fahrer (beste Runde)': 'Pilotes les plus rapides (meilleur tour)', 'Lädt …': 'Chargement…',
  'Noch keine Zeit. Fahre eine Runde!': 'Pas encore de temps. Fais un tour !', 'Schnellste Autos (beste Runde)': 'Voitures les plus rapides (meilleur tour)', 'Noch kein Auto hat hier eine Zeit.': 'Aucune voiture n’a encore de temps ici.',
  'Alle Autos nach Höchstgeschwindigkeit': 'Toutes les voitures par vitesse maximale',
  // Streckeneditor
  'Eigene Strecke': 'Circuit perso', 'Gib der Strecke einen Namen (mindestens 2 Zeichen).': 'Donne un nom au circuit (au moins 2 caractères).', 'Zeichenfläche für die Strecke': 'Zone de dessin du circuit', 'Name der Strecke': 'Nom du circuit',
  'Strecke malen': 'Dessiner un circuit', Zurück: 'Retour',
  'Male mit dem Finger oder der Maus eine Runde. Sie wird automatisch geschlossen, geglättet und auf die gewählte Länge gebracht. Der Start liegt am Anfang deiner Linie.': 'Dessine un tour avec le doigt ou la souris. Il est fermé, lissé et ajusté à la longueur choisie. Le départ est au début de ta ligne.',
  'Hier eine Runde malen': 'Dessine un tour ici', 'So wird deine Strecke:': 'Voici ton circuit :', '. Der türkise Punkt ist der Start.': '. Le point turquoise est le départ.', 'Länge:': 'Longueur :',
  'Fläche ausfüllen (komplett Straße, ohne Ziel und Barriere, zum Üben und Driften)': 'Remplir la surface (tout en route, sans arrivée ni barrière, pour s’entraîner et driffer)', 'Breite:': 'Largeur :', 'für alle sichtbar': 'visible par tous',
  'Neu malen': 'Redessiner', Probefahrt: 'Essai', Speichern: 'Enregistrer',
  'Male eine längere Linie – am besten eine Runde, die wieder beim Start ankommt.': 'Dessine une ligne plus longue – idéalement un tour qui revient au départ.', 'Die Linie ist zu kurz.': 'La ligne est trop courte.',
  'Der Anfang und das Ende liegen zu weit auseinander. Male eine Runde, die fast wieder am Start ankommt.': 'Le début et la fin sont trop éloignés. Dessine un tour qui revient presque au départ.',
  'Die Strecke kreuzt sich selbst. Male eine Runde ohne Überschneidung.': 'Le circuit se croise lui-même. Dessine un tour sans croisement.',
  'Eine Kurve ist zu eng. Male sie weiter und runder, oder wähle eine größere Strecke.': 'Un virage est trop serré. Dessine-le plus large et plus rond, ou choisis un circuit plus grand.',
  'Zwei Teile der Strecke liegen zu dicht beieinander. Male sie weiter auseinander.': 'Deux parties du circuit sont trop proches. Écarte-les davantage.',
  'Aus der Linie lässt sich keine befahrbare Strecke machen. Versuche es mit weicheren Kurven.': 'Cette ligne ne donne pas de circuit praticable. Essaie avec des virages plus doux.',
  // Vokabel-Shop
  'Autoschlüssel-Paket': 'Pack clés de voiture', 'Bis zu 5 statt 2 Auto-Spawns, 30 Min': 'Jusqu’à 5 voitures au lieu de 2, 30 min', '40 % schneller laufen, 30 Min': 'Courir 40 % plus vite, 30 min', 'Höher springen, 30 Min': 'Sauter plus haut, 30 min',
  'Nur halber Schaden (Autos, Schläge, Unfälle), 30 Min': 'Moitié des dégâts (voitures, coups, accidents), 30 min', 'Sofort volle Leben': 'Vie pleine tout de suite', '+10 Leben (höchstens +100)': '+10 vies (maximum +100)',
  'Richtig!': 'Juste !', 'Gekauft!': 'Acheté !', 'Shop – Theke': 'Boutique – comptoir', 'Admin: alles gratis.': 'Admin : tout est gratuit.', Prüfen: 'Vérifier', Schließen: 'Fermer', 'Vokabeln lernen': 'Apprendre du vocabulaire',
  'Lade Vokabeln …': 'Chargement du vocabulaire…', 'Du hast noch keine Vokabeln zum Abfragen.': 'Tu n’as pas encore de vocabulaire à réviser.',
  // Waffenladen
  Waffenladen: 'Armurerie', 'Gekauft – du trägst es jetzt!': 'Acheté – tu le portes maintenant !', 'Deine Coins:': 'Tes pièces :', 'Besitz ✓': 'Possédé ✓',
  Schussweste: 'Gilet pare-balles', Helm: 'Casque', Schlagstock: 'Matraque', Pistole: 'Pistolet',
  'Schläge, Schüsse und Rammen tun etwa halb so viel weh.': 'Les coups, les tirs et les chocs font environ moitié moins mal.', 'Noch ein bisschen weniger Schaden – und du siehst richtig taff aus.': 'Encore un peu moins de dégâts – et tu as vraiment l’air costaud.',
  'Schläge machen fast dreimal so viel Schaden und der Stock ist in deiner Hand zu sehen.': 'Les coups font presque trois fois plus de dégâts et la matraque est visible dans ta main.',
  'Zu Fuß schießen: Maus/Tippen zielt, auch über weite Strecken. Polizisten brauchen 3 Treffer.': 'Tirer à pied : la souris/le toucher vise, même de loin. Les policiers encaissent 3 tirs.',
  // Rennmenü
  'Dein Auto': 'Ta voiture', 'Du hast noch kein Auto – du fährst mit einem Leihwagen. Im Autohaus kannst du eins kaufen.': 'Tu n’as pas encore de voiture – tu conduis une voiture de location. Tu peux en acheter une à la concession.',
  'Üben starten': 'Commencer l’entraînement', 'Rennen starten': 'Lancer la course', 'Offene Stadt-Lobby: sofort mitfahren': 'Lobby ville ouverte : rejoindre tout de suite', Strecke: 'Circuit', 'Eigene Strecken': 'Circuits perso', 'Gemalte Strecken': 'Circuits dessinés',
  'Noch keine. Male deine eigene Strecke – allein oder online fahrbar.': 'Aucun pour l’instant. Dessine ton propre circuit – jouable seul ou en ligne.', Löschen: 'Supprimer', 'Modus:': 'Mode :', 'Gegen Bots': 'Contre des bots', 'Training allein': 'Entraînement seul',
  'Bots:': 'Bots :', 'Schwierigkeit:': 'Difficulté :', 'Profi fährt starke Autos exakt auf der Ideallinie.': 'Le pro conduit des voitures puissantes exactement sur la trajectoire idéale.', 'Runden:': 'Tours :',
  'Steuerung: links ◀ ▶, rechts Gas und Bremse (am iPad mit den Fingern, am Computer Pfeiltasten oder WASD, Leertaste bremst, R repariert und setzt das Auto zurück). Driften: Bremse und Lenken gleichzeitig. Wände und andere Autos machen Schaden. Online gegen Freunde: unter Mehrspieler → Rennen.': 'Commandes : à gauche ◀ ▶, à droite accélérateur et frein (sur iPad avec les doigts, sur ordinateur flèches ou WASD, la barre d’espace freine, R répare et remet la voiture en place). Drift : frein et direction en même temps. Les murs et les autres voitures font des dégâts. En ligne avec des amis : sous Multijoueur → Course.',
  'Auto konnte nicht gewählt werden.': 'Impossible de choisir la voiture.', 'Auf der Startaufstellung': 'Sur la grille de départ', 'wählt …': 'choisit…', 'Mit Bots starten': 'Démarrer avec des bots', Mitmachen: 'Participer', Nein: 'Non',
  'Offene Lobby': 'Lobby ouverte', Einfach: 'Facile', Mittel: 'Moyen', Schwer: 'Difficile', Profi: 'Pro',
  // Polizeijagd
  'Einladung zur Polizeijagd': 'Invitation à la chasse policière', 'der Bandit': 'le bandit', 'den Bandit': 'le bandit', '🚔 Du wurdest gefangen – die anderen Banditen laufen noch': '🚔 Tu as été attrapé – les autres bandits courent encore',
  '🏴‍☠️ Du bist Bandit: entkomme der Polizei!': '🏴‍☠️ Tu es bandit : échappe à la police !', 'Ergebnis der Polizeijagd': 'Résultat de la chasse policière', 'Die Polizei hat alle Banditen gefangen!': 'La police a attrapé tous les bandits !', 'Die Banditen sind entkommen!': 'Les bandits se sont échappés !',
  'Ihr habt gewonnen.': 'Vous avez gagné.', 'Diesmal verloren.': 'Perdu cette fois.', 'Anzahl Polizei-Bots': 'Nombre de bots de police', 'Zugesagt – warte auf den Start …': 'Accepté – en attente du départ…', 'Tageslimit für Jagd-Coins erreicht.': 'Limite quotidienne de pièces de chasse atteinte.',
  '🚓 Polizeijagd': '🚓 Chasse policière', 'Jagd starten': 'Lancer la chasse', Abbrechen: 'Annuler', 'Startet mit allen, die zugesagt haben, sobald mindestens ein Bandit und ein Polizist oder Bot dabei ist.': 'Démarre avec tous ceux qui ont accepté dès qu’il y a au moins un bandit et un policier ou un bot.',
  'Wen einladen? (nur wer gerade in der Stadt ist)': 'Qui inviter ? (seulement ceux qui sont en ville)', 'Gerade ist niemand sonst in der Stadt. Du kannst trotzdem mit Polizei-Bots spielen.': 'Personne d’autre n’est en ville. Tu peux quand même jouer avec des bots de police.',
  'Wer sind die Banditen? (mehrere möglich, der Rest ist Polizei)': 'Qui sont les bandits ? (plusieurs possibles, les autres sont la police)', 'Polizei-Bots': 'Bots de police',
  'Banditen fahren ein schnelleres, fliegendes Auto und sind immer auf der Karte zu sehen. Die Polizei hat Blaulicht und ist etwas langsamer. Rammt ein Polizist einen Banditen, ist er gefangen; sind alle gefangen, gewinnt die Polizei. Nach 6 Minuten gewinnen die Banditen.': 'Les bandits conduisent une voiture plus rapide qui vole et sont toujours visibles sur la carte. La police a un gyrophare et est un peu plus lente. Si un policier percute un bandit, il est capturé ; si tous sont capturés, la police gagne. Après 6 minutes, les bandits gagnent.',
  // Feuerwehr
  'Ankleidezimmer: Feuerwehr-Dienst': 'Vestiaire : service des pompiers', 'Rutschstange: runter in die Fahrzeughalle': 'Perche de descente : vers le garage des véhicules', 'Im Bett ausruhen (Leben auffüllen)': 'Se reposer au lit (refaire le plein de vie)', 'Küche: etwas essen (Leben auffüllen)': 'Cuisine : manger quelque chose (refaire le plein de vie)',
  '🚒 Im Dienst: Feuerwehr': '🚒 En service : pompiers', Feuerwehr: 'Pompiers', Feuerwache: 'Caserne de pompiers',
  'Du bist jetzt Feuerwehrmann! Bei einem Brand ertönt der Alarm – du rutschst die Stange runter und fährst mit dem Löschzug los (Coins für jedes gelöschte Feuer).': 'Tu es maintenant pompier ! En cas d’incendie, l’alarme retentit – tu glisses le long de la perche et pars avec le camion de pompiers (des pièces pour chaque feu éteint).',
  '🔥 Brand! Ein Haus steht in Flammen – die Feuerwehr rückt aus.': '🔥 Incendie ! Une maison est en flammes – les pompiers interviennent.', '🚨 ALARM! Brand in der Stadt – ab zur Rutschstange!': '🚨 ALARME ! Incendie en ville – direction la perche !', 'Du rutschst die Stange runter …': 'Tu glisses le long de la perche…',
  'Los! Zum Brand – die blaue Linie zeigt den Weg. Q/Tippen spritzt Wasser.': 'Allez ! Vers l’incendie – la ligne bleue montre le chemin. Q/toucher projette de l’eau.', 'Feuer gelöscht! Gut gemacht.': 'Feu éteint ! Bien joué.', 'Das Feuer ist gelöscht.': 'Le feu est éteint.',
  'Du ruhst dich aus – volle Leben.': 'Tu te reposes – vie pleine.', 'Du isst etwas – volle Leben.': 'Tu manges quelque chose – vie pleine.', 'Streifenwagen explodiert!': 'Voiture de patrouille explosée !', 'SWAT-Wagen explodiert!': 'Fourgon SWAT explosé !',
  'Der Admin hat dir den Iron-Man-Anzug gegeben! (I)': 'L’admin t’a donné l’armure d’Iron Man ! (I)', 'Der Admin hat dir den Iron-Man-Anzug wieder genommen.': 'L’admin t’a repris l’armure d’Iron Man.', 'Iron Man vergeben.': 'Iron Man donné.', 'Iron Man genommen.': 'Iron Man retiré.', 'Niemand sonst ist gerade in der Stadt.': 'Personne d’autre n’est en ville.', 'Teleport (T)': 'Téléportation (T)',
  '↻ Auf Updates prüfen / Seite neu laden': '↻ Vérifier les mises à jour / recharger la page',
  // Hauptspiel: HUD / Buttons
  'Vollbild beenden': 'Quitter le plein écran', '⤢ Vollbild aus': '⤢ Plein écran off', '⤢ Vollbild': '⤢ Plein écran', 'Reichweite der Karte': 'Portée de la carte', 'Größe der Karte': 'Taille de la carte', Groß: 'Grand',
  'Fliegen: Taste halten (E)': 'Voler : maintenir la touche (E)', 'Flug bereit (E)': 'Vol prêt (E)', '◀◀ Linkskurve': '◀◀ Virage à gauche', 'Rechtskurve ▶▶': 'Virage à droite ▶▶', 'TRESOR ÖFFNEN (G) – danach 6 Min Polizeijagd': 'OUVRIR LE COFFRE (G) – puis 6 min de chasse',
  'WAFFENKAMMER AUFBRECHEN (G) – Schlagstock, 6 Min Polizeijagd': 'FORCER L’ARMURERIE (G) – matraque, 6 min de chasse', 'SWAT-WAGEN KLAUEN (G) – 6 Min Polizeijagd': 'VOLER LE FOURGON SWAT (G) – 6 min de chasse',
  'Sofort wiederbeleben (gratis)': 'Réanimer tout de suite (gratuit)', 'Sofort wiederbeleben (10 Coins)': 'Réanimer tout de suite (10 pièces)', 'Ego: AN (V)': 'Vue subjective : ON (V)', 'Ego (V)': 'Vue subjective (V)', 'Iron Man: AN (I)': 'Iron Man : ON (I)', 'Iron Man (I)': 'Iron Man (I)',
  '👮 Im Dienst: Polizei': '👮 En service : police', '🚑 Im Dienst: Sanitäter': '🚑 En service : secouriste', 'Auto zum Spawnen wählen': 'Choisir la voiture à faire apparaître', 'Von unten': 'Par en dessous', Außenansicht: 'Vue extérieure',
  'Reparieren (R)': 'Réparer (R)', 'Zurücksetzen / Reparieren (R)': 'Remettre en place / Réparer (R)', 'Höchstgeschwindigkeit in km/h': 'Vitesse maximale en km/h', 'Einsteigen (X)': 'Monter (X)', 'Aussteigen (X)': 'Descendre (X)',
  'Im Gebüsch: Name versteckt': 'Dans les buissons : nom caché', 'Name versteckt – zeigen (H)': 'Nom caché – montrer (H)', 'Namen verstecken (H)': 'Cacher le nom (H)', Steuerknüppel: 'Manette', 'Nach links': 'À gauche', 'Nach rechts': 'À droite',
  '⚙ Karte & Steuerung': '⚙ Carte et commandes', 'Karte anzeigen': 'Afficher la carte', Reichweite: 'Portée', 'nah, groß': 'proche, grand', 'weit, klein': 'loin, petit', Größe: 'Taille', 'Joystick-Drehung': 'Rotation du joystick', 'Farbe der Figur': 'Couleur du personnage', Auto: 'Voiture',
  'Nur im Umkreis rendern': 'Afficher seulement alentour', 'PNG wählen': 'Choisir un PNG', Entfernen: 'Retirer', 'Mit Pro kannst du deinen Minecraft-Skin importieren.': 'Avec Pro, tu peux importer ton skin Minecraft.',
  'DRIFT!': 'DRIFT !', 'Totalschaden! R = Werkstatt (3 s Pause)': 'Perte totale ! R = garage (pause de 3 s)', 'Du bist bewusstlos – Hilfe ist unterwegs': 'Tu es inconscient – les secours arrivent', '🔭 Zoom (Z)': '🔭 Zoom (Z)',
  'Welches Auto spawnen? (Schnellstes = 1, auch N dann Ziffer)': 'Quelle voiture faire apparaître ? (La plus rapide = 1, aussi N puis un chiffre)', 'Überfahren!': 'Écrasé !', 'Falsche Richtung! (R = zurücksetzen)': 'Mauvais sens ! (R = remettre en place)', 'Neben der Strecke – langsamer': 'Hors piste – plus lent',
  'LOS!': 'GO !', 'In der Stadt fliegen erlauben': 'Autoriser le vol en ville', Beschleunigung: 'Accélération', RENNEN: 'COURSE', RUNTER: 'DESCENDRE', SCHLAG: 'COUP', SPRINGEN: 'SAUTER', RAKETE: 'MISSILE', FLIEGEN: 'VOLER', BREMSE: 'FREIN', GAS: 'GAZ',
  'Im Ziel!': 'Arrivé !', 'Tageslimit für Renn-Coins erreicht.': 'Limite quotidienne de pièces de course atteinte.', Nochmal: 'Encore', 'Drift-Punkte': 'Points de drift', 'km/h': 'km/h',
  'Die Datei ist zu groß für einen Skin.': 'Le fichier est trop grand pour un skin.', 'Bitte eine PNG-Datei wählen.': 'Choisis un fichier PNG.', 'Ein Minecraft-Skin ist 64×64 (oder 64×32) Pixel groß.': 'Un skin Minecraft fait 64×64 (ou 64×32) pixels.', 'Das Bild konnte nicht gelesen werden.': 'L’image n’a pas pu être lue.',
  'Die 3D-Ansicht konnte nicht geladen werden. Prüfe die Verbindung und lade die Seite neu.': 'La vue 3D n’a pas pu être chargée. Vérifie la connexion et recharge la page.',
  // Meldungen
  'Du wurdest geschlagen!': 'On t’a frappé !', 'Die Sanitäter haben dich aufgeladen – ab ins Krankenhaus!': 'Les secouristes t’ont chargé – direction l’hôpital !', 'Der Admin hat dich wiederbelebt!': 'L’admin t’a réanimé !',
  'Polizist ausgeschaltet – die Polizei ruft SWAT!': 'Policier neutralisé – la police appelle le SWAT !', 'Die Polizei jagt dich – 6 Minuten durchhalten!': 'La police te poursuit – tiens 6 minutes !', 'Du bist nicht mehr gesucht.': 'Tu n’es plus recherché.',
  'Du hast einen Streifenwagen gerammt! Die Polizei verfolgt dich – 6 Minuten durchhalten!': 'Tu as percuté une voiture de patrouille ! La police te poursuit – tiens 6 minutes !', 'Passant getötet!': 'Passant tué !', 'Zeugen haben die Polizei gerufen – 6 Minuten durchhalten!': 'Des témoins ont appelé la police – tiens 6 minutes !',
  'Ein Passant schlägt dich!': 'Un passant te frappe !', 'Du trägst schon eine Schutzweste.': 'Tu portes déjà un gilet pare-balles.', 'Schutzweste genommen – sie hält bis zu deinem nächsten Tod.': 'Gilet pris – il tient jusqu’à ta prochaine mort.',
  'Soldat ausgeschaltet!': 'Soldat neutralisé !', 'Panzerfaust! Weich aus!': 'Lance-roquette ! Esquive !', 'Du kletterst aus dem Gelände.': 'Tu sors du terrain en escaladant.', 'Du kletterst über den Zaun!': 'Tu escalades la clôture !', 'Das Fahrzeug ist weg – es kommt bald ein neues.': 'Le véhicule est parti – un nouveau arrive bientôt.',
  'Hubschrauber geklaut! W/S fliegen, A/D drehen, E hoch, R runter, Q/Tippen schießt.': 'Hélicoptère volé ! W/S pour avancer, A/D pour tourner, E monter, R descendre, Q/toucher tire.', 'Panzer geklaut! Pfeile/Wischen drehen, W/S fahren, Q/Tippen schießt.': 'Char volé ! Flèches/glisser pour tourner, W/S pour rouler, Q/toucher tire.',
  'Die KSK rückt an – Elitesoldaten mit Sturmgewehren und Panzerfäusten!': 'Le KSK arrive – des soldats d’élite avec fusils d’assaut et lance-roquettes !', 'KSK-Soldat ausgeschaltet!': 'Soldat du KSK neutralisé !', 'Im Bunker wird nicht geschossen.': 'On ne tire pas dans le bunker.',
  'Quad: Auto-Schuss an.': 'Quad : tir automatique activé.', 'Quad: Auto-Schuss aus – schieße selbst mit der Schuss-Taste.': 'Quad : tir automatique désactivé – tire toi-même avec la touche de tir.',
  'Auto-Schuss: AN (tippen = aus)': 'Tir auto : ON (toucher = off)', 'Auto-Schuss: AUS (tippen = an)': 'Tir auto : OFF (toucher = on)',
  'Fäuste.': 'Poings.', 'Schlagstock in der Hand.': 'Matraque en main.', 'Pistole in der Hand.': 'Pistolet en main.', 'Sturmgewehr in der Hand.': 'Fusil d’assaut en main.', 'Scharfschützengewehr in der Hand.': 'Fusil de précision en main.',
  'Das Tor schließt sich – hier findet dich die Polizei nicht.': 'La porte se ferme – ici, la police ne te trouve pas.', 'Du verlässt die Garage.': 'Tu quittes le garage.', 'Dein Auto steht vor der Garage – steig ein.': 'Ta voiture est devant le garage – monte.', 'Die Garage ist voll.': 'Le garage est plein.', 'In der Luft geht das nicht.': 'Impossible en l’air.',
  'Auftrag angenommen – das Ziel ist auf der Karte (blinkender Punkt).': 'Mission acceptée – la cible est sur la carte (point clignotant).', 'Auftrag abgebrochen.': 'Mission annulée.', 'Auftrag erfüllt! Der Auftraggeber überweist …': 'Mission accomplie ! Le commanditaire vire l’argent …', 'Gerade lässt sich keine Zielperson finden – versuch es gleich nochmal.': 'Aucune cible pour l’instant – réessaie bientôt.',
  'Auftrag gescheitert: Die Zeit ist abgelaufen.': 'Mission échouée : le temps est écoulé.', 'Auftrag gescheitert: Die Zielperson ist verschwunden.': 'Mission échouée : la cible a disparu.', 'Auftrag gescheitert: Das Zielauto ist weg.': 'Mission échouée : la voiture cible a disparu.',
  'Du bist im Flugzeug über dem Bunker – es fliegt zum Ziel und wirft dich mit dem Fallschirm ab.': 'Tu es dans l’avion au-dessus du bunker – il vole vers la cible et te largue en parachute.', 'Absprung! Der Fallschirm öffnet sich – steuere zum Ziel.': 'Saut ! Le parachute s’ouvre – dirige-toi vers la cible.', 'Gelandet.': 'Atterri.',
  'Gerade sieht keine Kamera jemanden – du siehst die nächsten Kameras.': 'Aucune caméra ne voit personne – voici les caméras les plus proches.', 'Das Haus gehört jetzt dir! Du kannst es einrichten und hast eine Garage.': 'La maison est à toi ! Tu peux l’aménager, et tu as un garage.',
  'Aufträge gibt es nur für die KSK.': 'Les missions sont réservées au KSK.', 'Das Flugzeug ist nur für die KSK.': 'L’avion est réservé au KSK.',
  'Waffenauto geklaut!': 'Voiture armée volée !', 'Armee-Fahrzeug geklaut – die Polizei und die Armee jagen dich!': 'Véhicule militaire volé – la police et l’armée te poursuivent !', 'Iron Mans greifen an – sie halten einiges aus und ihre Raketen zerstören sogar Panzer!': 'Des Iron Man attaquent – ils encaissent beaucoup et leurs missiles détruisent même les chars !',
  'Ein Iron Man ist abgestürzt!': 'Un Iron Man s’est écrasé !', 'Die Armee rückt an – Kampfhubschrauber und Panzer!': 'L’armée arrive – hélicoptères de combat et chars !', 'Einsatz! Du wurdest zur Wache gebracht – verfolge den Gangster (blaue Linie).': 'Intervention ! Tu as été amené au poste – poursuis le gangster (ligne bleue).',
  'Das Auto ist explodiert!': 'La voiture a explosé !', 'In der Luft kannst du nicht aussteigen.': 'Tu ne peux pas descendre en l’air.', 'Der Fahrer ist weg – du steigst aus.': 'Le conducteur est parti – tu descends.', 'Das Auto ist explodiert – du hast es nicht überlebt und wachst im Krankenhaus auf.': 'La voiture a explosé – tu n’as pas survécu et tu te réveilles à l’hôpital.',
  'Du hast die Fahrt nicht überlebt – du wachst im Krankenhaus auf.': 'Tu n’as pas survécu au trajet – tu te réveilles à l’hôpital.', 'Kein Auto in der Nähe zum Einsteigen.': 'Aucune voiture à proximité pour monter.', 'Ein Sanitäter ist auf dem Weg zu dir!': 'Un secouriste est en route vers toi !',
  'Hilfe ist unterwegs …': 'Les secours arrivent…', 'Du wurdest ins Krankenhaus gebracht und liegst im Bett.': 'Tu as été amené à l’hôpital et tu es alité.', 'Du wachst im Krankenhaus auf.': 'Tu te réveilles à l’hôpital.', 'Wiederbelebt!': 'Réanimé !',
  'Ein Rettungshubschrauber fliegt zu dir.': 'Un hélicoptère de secours vole vers toi.', 'Ein Krankenwagen fährt zu dir.': 'Une ambulance roule vers toi.', 'Die Sanitäter legen dich auf die Trage …': 'Les secouristes te couchent sur le brancard…', 'Du liegst im Krankenwagen – es geht ins Krankenhaus.': 'Tu es dans l’ambulance – direction l’hôpital.',
  'Der Sanitäter ist nicht angekommen – ein Krankenwagen fährt zu dir.': 'Le secouriste n’est pas arrivé – une ambulance roule vers toi.', 'Du bist nicht mehr im Dienst.': 'Tu n’es plus en service.',
  'Du bist jetzt Polizist! Bei Bankraub, Autodiebstahl und Waffenkammer-Einbruch wirst du zur Wache gebracht – dafür gibt es Coins.': 'Tu es maintenant policier ! Lors d’un braquage, d’un vol de voiture ou d’un cambriolage d’armurerie, tu es amené au poste – ça rapporte des pièces.',
  'Du bist jetzt Sanitäter! Wenn jemand stirbt, wirst du mit dem Krankenwagen losgeschickt – dafür gibt es Coins.': 'Tu es maintenant secouriste ! Quand quelqu’un meurt, on t’envoie en ambulance – ça rapporte des pièces.', 'Der Einsatz ist beendet.': 'L’intervention est terminée.',
  'Patient aufgeladen! Bring ihn zum Krankenhaus.': 'Patient chargé ! Amène-le à l’hôpital.', 'Dein Auto ist explodiert – du wachst im Krankenhaus auf.': 'Ta voiture a explosé – tu te réveilles à l’hôpital.', 'Dein Auto ist explodiert – du bekommst ein neues.': 'Ta voiture a explosé – tu en reçois une nouvelle.',
  'Hier ist kein Platz zum Spawnen.': 'Il n’y a pas de place pour faire apparaître une voiture ici.', 'Du bist wieder auf den Beinen.': 'Tu es de nouveau sur pied.', 'Treffer – er geht zu Boden!': 'Touché – il tombe !', 'Schlag ins Leere.': 'Coup dans le vide.', 'Du bist gestorben – du wachst im Krankenhaus auf.': 'Tu es mort – tu te réveilles à l’hôpital.',
  'Kampfhubschrauber abgeschossen!': 'Hélicoptère de combat abattu !', 'Panzer zerstört!': 'Char détruit !', 'Raketen laden nach …': 'Rechargement des missiles…', 'Lenkrakete gestartet!': 'Missile guidé lancé !', 'Rakete ohne Ziel gestartet.': 'Missile lancé sans cible.',
  'Du wirst beschossen!': 'On te tire dessus !', 'Dein Auto wird beschossen!': 'On tire sur ta voiture !', 'Iron-Man-Anzug an! W/S fliegen, A/D drehen, E hoch, R runter, Klick/Tippen schießt. Tippe auf die Minimap: Bombe!': 'Armure d’Iron Man enfilée ! W/S voler, A/D tourner, E monter, R descendre, clic/toucher lance des missiles. Touche la minicarte : bombe !',
  'Bombe lädt nach …': 'La bombe recharge…', 'Zugang nur für die KSK.': 'Accès réservé au KSK.', 'Die Bunker-Luke fährt auf …': 'La trappe du bunker s’ouvre…', 'Die Bunker-Luke schließt sich.': 'La trappe du bunker se referme.', 'Die Luke ist noch nicht offen.': 'La trappe n’est pas encore ouverte.', 'Der Fahrstuhl fährt nach unten …': 'L’ascenseur descend…', 'Der Fahrstuhl fährt nach oben …': 'L’ascenseur monte…',
  'Willkommen im KSK-Bunker! Computer, Quad-Schmiede und Iron-Man-Werkstatt.': 'Bienvenue dans le bunker KSK ! Ordinateurs, forge à quad et atelier Iron Man.', 'Du bist oben. Dein Quad steht neben der Luke bereit.': 'Tu es en haut. Ton quad est prêt à côté de la trappe.', 'Du bist wieder oben.': 'Tu es de nouveau en haut.',
  'Der Bauarm setzt hier die Iron-Man-Anzüge zusammen – alle 16 Sekunden ein neuer.': 'Le bras robotisé assemble ici les armures d’Iron Man – une nouvelle toutes les 16 secondes.', 'Strategietisch: Hologramm der Stadt.': 'Table stratégique : hologramme de la ville.', 'Bombe unterwegs!': 'Bombe en approche !',
  'Der Admin hat dich zur KSK befördert! Knopf „KSK“, dann Quad rufen.': 'L’admin t’a promu au KSK ! Bouton « KSK », puis appelle ton quad.', 'Der Admin hat dir die KSK-Rechte genommen.': 'L’admin t’a retiré les droits KSK.',
  'KSK-Spezialausrüstung an: Sturmgewehr, Spezialpanzerung, Nachtsicht. Knopf „Quad rufen“ holt dein Quad.': 'Équipement spécial KSK activé : fusil d’assaut, blindage, vision nocturne. Le bouton « Quad rufen » amène ton quad.', 'KSK-Ausrüstung aus.': 'Équipement KSK retiré.',
  'Dein Quad steht bereit. X = aufsteigen (nur KSK, höchstens 2 Personen).': 'Ton quad est prêt. X = monter (KSK uniquement, 2 personnes maximum).', 'Das Quad ist nur für die KSK.': 'Le quad est réservé au KSK.', 'KSK vergeben.': 'KSK attribué.', 'KSK genommen.': 'KSK retiré.',
  'Iron-Man-Anzug wird angelegt …': 'L’armure d’Iron Man se met en place…', 'Anzug aus.': 'Armure retirée.', 'Scharfschützengewehr! Z = Zoom, Tippen/Klick schießt (ein Treffer reicht).': 'Fusil de précision ! Z = zoom, toucher/clic tire (un tir suffit).', 'Sturmgewehr! Es schießt viel schneller als die Pistole.': 'Fusil d’assaut ! Il tire beaucoup plus vite que le pistolet.',
  'Klirr! Die Scheibe ist kaputt.': 'Clac ! La vitre est brisée.', 'Geschafft! Du hast einen Schlagstock – er macht mehr Schaden (Q).': 'Réussi ! Tu as une matraque – elle fait plus de dégâts (Q).', 'Das geht nur im Online-Spiel.': 'Ça ne marche qu’en jeu en ligne.', 'Die Waffenkammer ist leer – komm später wieder.': 'L’armurerie est vide – reviens plus tard.',
  'Waffenkammer offen! Schnapp dir den Schlagstock-Ruhm: überlebe 6 Minuten – die Polizei steht vor der Tür!': 'Armurerie ouverte ! Tiens 6 minutes – la police est à la porte !', 'Du sitzt im SWAT-Wagen! 6 Minuten Polizeijagd – die SWAT-Wagen fliegen auch.': 'Tu es dans le fourgon SWAT ! 6 minutes de chasse – les fourgons SWAT volent aussi.',
  'Geldautomaten knacken geht nur im Online-Spiel.': 'Forcer un distributeur ne marche qu’en jeu en ligne.', 'Der Automat war leer.': 'Le distributeur était vide.', 'Die Bank kann nur im Online-Spiel ausgeraubt werden.': 'La banque ne peut être braquée qu’en jeu en ligne.', 'Der Tresor ist offen! Lauf zu Fuß nach draußen zu den Fluchtautos!': 'Le coffre est ouvert ! Cours dehors jusqu’aux voitures de fuite !',
  'Ein Polizist schlägt dich!': 'Un policier te frappe !', 'Mit über 300 km/h eingeschlagen – das war tödlich! Das Auto explodiert.': 'Impact à plus de 300 km/h – mortel ! La voiture explose.', 'Du hast den Unfall nicht überlebt – das Auto explodiert.': 'Tu n’as pas survécu à l’accident – la voiture explose.', 'Schwerer Aufprall – das Auto explodiert!': 'Violent impact – la voiture explose !', 'Das brennende Auto ist explodiert!': 'La voiture en feu a explosé !',
  // Orte / Aktionen
  'Armee-Gelände': 'Base militaire', 'Tresor öffnen': 'Ouvrir le coffre', 'Geldautomat knacken': 'Forcer le distributeur', 'Zur Theke': 'Au comptoir', 'Waffenkammer aufbrechen': 'Forcer l’armurerie', 'SWAT-Wagen klauen': 'Voler le fourgon SWAT', 'Ankleidezimmer: Polizei-Dienst': 'Vestiaire : service de police',
  'Schutzweste nehmen': 'Prendre le gilet', 'Sturmgewehr nehmen': 'Prendre le fusil d’assaut', 'Scharfschützengewehr nehmen': 'Prendre le fusil de précision', 'Panzer holen (Schlüsselbrett)': 'Prendre un char (tableau de clés)', 'Hubschrauber holen (Schlüsselbrett)': 'Prendre un hélicoptère (tableau de clés)',
  'Waffenauto holen (Schlüsselbrett)': 'Prendre une voiture armée (tableau de clés)', 'Zaun überklettern': 'Escalader la clôture', 'Panzer klauen': 'Voler un char', 'Hubschrauber klauen': 'Voler un hélicoptère', 'Waffenauto klauen': 'Voler une voiture armée', 'Waffenladen öffnen': 'Ouvrir l’armurerie', 'Ankleidezimmer: Sanitäter-Dienst': 'Vestiaire : service de secours',
  // Strecken-Beschreibungen
  'Breiter Oval-Kurs mit sanften Kurven – ideal zum Einstieg.': 'Grand ovale aux virages doux – idéal pour débuter.', 'Viele S-Kurven hintereinander. Früh abbremsen und die Kurve vorausschauen.': 'Beaucoup de virages en S à la suite. Freine tôt et anticipe le virage.', 'Enge Spitzkehren und lange Gerade. Wer bremst, gewinnt.': 'Épingles serrées et longue ligne droite. Celui qui freine gagne.',
  'Rechte Winkel zwischen Häuserblocks – kurze Geraden, harte Ecken.': 'Angles droits entre les pâtés de maisons – lignes droites courtes, coins durs.', Wüstenschleife: 'Boucle du désert', 'Weite Bögen und eine lange Zielgerade, Staub und Felsen am Rand.': 'Larges courbes et longue ligne d’arrivée, poussière et rochers au bord.',
  'Verschlungene Strecke bei Nacht mit Leuchtstreifen am Rand.': 'Circuit sinueux de nuit avec bandes lumineuses sur les bords.', 'Rund 9 km mit zwei kilometerlangen Geraden – hier zeigt sich, was ein Auto kann.': 'Environ 9 km avec deux lignes droites d’un kilomètre – ici on voit ce qu’une voiture vaut.',
  'Über 10 km, Geraden von 5 km Länge mit sanften Bögen. Für Höchstgeschwindigkeit.': 'Plus de 10 km, lignes droites de 5 km avec des courbes douces. Pour la vitesse maximale.', 'Rund 8 km: eine lange Gerade, dann Berg-Kurven bis zur Haarnadel.': 'Environ 8 km : une longue ligne droite, puis des virages de montagne jusqu’à l’épingle.',
  'Die Königsstrecke: rund 15 km, 6-km-Gerade, Bögen und lange Kurven.': 'Le circuit roi : environ 15 km, ligne droite de 6 km, courbes et longs virages.', 'Extrabreite Fahrbahn (48 m) mit weiten, langen Bögen – zum Quer-Driften, ohne anzuecken.': 'Chaussée extra-large (48 m) avec de grandes courbes – pour driffer en travers sans toucher.',
  'Unendlich großes Feld zum Driften-Üben: kein Ziel, keine Wände, nur Asphalt mit Übungskreisen.': 'Champ infini pour s’entraîner au drift : pas d’arrivée, pas de murs, seulement de l’asphalte avec des cercles d’entraînement.',
  'Riesige runde Asphaltfläche, die Mitte ist komplett Straße, ohne Barrieren: Kreise driften, quer durchfahren, Runden sammeln.': 'Immense surface d’asphalte ronde, le centre est entièrement route, sans barrières : drifter en cercles, traverser, collectionner des tours.',
  'Große offene Stadt mit Häuserblöcken, Gassen, Tunneln, fünf Brücken und Wäldchen zum Verstecken. Mit Stadtkarte, Namen-Verstecken und Polizeijagd (Bandit gegen Polizei, auch mit Bots). Frei herumfahren, kein Ziel.': 'Grande ville ouverte avec pâtés de maisons, ruelles, tunnels, cinq ponts et bosquets pour se cacher. Avec carte, noms cachés et chasse policière (bandit contre police, aussi avec des bots). Conduis librement, pas d’arrivée.',
  'Looping (ab 100 km/h), Hügel, Schanzen mit Landerampen und eine riesige Sprungrampe auf offener Fläche. Kein Ziel.': 'Looping (dès 100 km/h), collines, tremplins avec rampes d’atterrissage et une énorme rampe de saut en terrain ouvert. Pas d’arrivée.', 'Eigene Fläche': 'Surface perso',
  // Autobahn-Spiel
  'Weiche den langsameren Autos aus.': 'Évite les voitures plus lentes.', 'Pfeil hoch/runter oder W/S · am iPad obere/untere Hälfte antippen': 'Flèche haut/bas ou W/S · sur iPad, touche la moitié haute/basse', '▲ Spur hoch': '▲ Voie du haut', '▼ Spur runter': '▼ Voie du bas',
  // Admin-Bau
  'Anweisung kopiert – in die KI einfügen, das JSON-Ergebnis unten einfügen.': 'Instruction copiée – colle-la dans l’IA, puis colle le résultat JSON ci-dessous.', 'Kopieren nicht möglich – markiere den Text unten von Hand.': 'Copie impossible – sélectionne le texte ci-dessous à la main.',
  'Bauplan (JSON)': 'Plan de construction (JSON)', '＋ Neues Auto per KI-Bauplan (Admin)': '＋ Nouvelle voiture par plan IA (admin)', 'Neues Auto (Admin)': 'Nouvelle voiture (admin)', 'Beschreibe das Auto und kopiere die Anweisung für die KI.': 'Décris la voiture et copie l’instruction pour l’IA.',
  'Füge die Antwort der KI (JSON) unten ein – das Auto erscheint sofort.': 'Colle la réponse de l’IA (JSON) ci-dessous – la voiture apparaît tout de suite.', 'Stelle Fliegen, Tempo und Preis ein und speichere.': 'Règle le vol, la vitesse et le prix, puis enregistre.', 'Anweisung kopieren': 'Copier l’instruction', 'Beispiel einfügen': 'Insérer un exemple',
  Name: 'Nom', 'Preis (Coins)': 'Prix (pièces)', Grundfarbe: 'Couleur de base', 'Höchstgeschw. km/h': 'Vit. max km/h', Lenkung: 'Direction', Bremsen: 'Freins', Motorrad: 'Moto',
}

/** Sätze mit eingebauten Zahlen/Namen. */
export const PATTERNS: Array<[RegExp, (...m: string[]) => string]> = [
  [/^(.+) fährt zur Bank …$/, (_, n) => `${n} se rend à la banque …`],
  [/^(.+) überfällt die Bank!$/, (_, n) => `${n} braque la banque !`],
  [/^(.+) hat die Bank ausgeraubt und flüchtet!$/, (_, n) => `${n} a braqué la banque et prend la fuite !`],
  [/^(.+) klaut (einen Panzer|einen Armeehubschrauber)!$/, (_, n, k) => `${n} vole ${k === 'einen Panzer' ? 'un char' : 'un hélicoptère militaire'} !`],
  [/^(.+) rückt als Feuerwehrmann zum Brand aus!$/, (_, n) => `${n} part au feu en pompier !`],
  [/^(.+) hat den Brand gelöscht\.$/, (_, n) => `${n} a éteint l’incendie.`],
  [/^(.+) fährt als Arzt zu einem Verletzten\.$/, (_, n) => `${n} se rend chez un blessé en tant que médecin.`],
  [/^(.+) hat einen Patienten gerettet\.$/, (_, n) => `${n} a sauvé un patient.`],
  [/^(.+) greift dich an!$/, (_, n) => `${n} t’attaque !`],
  [/^(.+) wurde ausgeschaltet\.$/, (_, n) => `${n} a été éliminé.`],
  [/^Fahndungsstufe: (★+)$/, (_, s) => `Niveau de recherche : ${s}`],
  [/^Die Polizei sucht weniger: (★+)$/, (_, s) => `La police te recherche moins : ${s}`],
  [/^Fahndungsstufe (\d+) von (\d+)$/, (_, a, b) => `Niveau de recherche ${a} sur ${b}`],
  [/^(.+) getötet – die Polizei sucht dich!$/, (_, n) => `${n} a été tué – la police te recherche !`],
  [/^Polizei-Bot (\d+)$/, (_, n) => `Bot de police ${n}`],
  [/^Panzer (\d+)$/, (_, n) => `Char ${n}`],
  [/^Kampfheli (\d+)$/, (_, n) => `Hélico de combat ${n}`],
  [/^Schlagstock auf (.+)!$/, (_, n) => `Coup de matraque sur ${n} !`],
  [/^Schlag auf (.+)!$/, (_, n) => `Coup sur ${n} !`],
  [/^Das Auto ist voll \((\d+)\/(\d+)\)\.$/, (_, a, b) => `La voiture est pleine (${a}/${b}).`],
  [/^Du fährst bei (.+) mit \((\d+)\/(\d+)\)\. X = aussteigen\.$/, (_, n, a, b) => `Tu voyages avec ${n} (${a}/${b}). X = descendre.`],
  [/^(.+) liegt weit weg! Flieg mit dem Rettungshubschrauber hin \(E hoch, R runter\) und lande neben ihm\.$/, (_, n) => `${n} est très loin ! Vole jusqu’à lui en hélicoptère de secours (E monter, R descendre) et pose-toi à côté.`],
  [/^(.+) braucht Hilfe! Fahr mit dem Krankenwagen hin \(blaue Linie\)\.$/, (_, n) => `${n} a besoin d’aide ! Rends-toi sur place en ambulance (ligne bleue).`],
  [/^Einsatz abgeschlossen: \+(\d+) Coins$/, (_, n) => `Intervention terminée : +${n} pièces`],
  [/^Einsatz beendet: \+(\d+) Coins$/, (_, n) => `Intervention terminée : +${n} pièces`],
  [/^Spawn-Limit erreicht \((\d+)\)\. Lerne Vokabeln in einem Shop \(S auf der Karte\) für bis zu 5\.$/, (_, n) => `Limite d’apparitions atteinte (${n}). Apprends du vocabulaire dans une boutique (S sur la carte) pour en avoir jusqu’à 5.`],
  [/^Du hast kein Auto Nr\. (\d+)\.$/, (_, n) => `Tu n’as pas de voiture n° ${n}.`],
  [/^Der Automat ist noch leer – warte (\d+) s\.$/, (_, n) => `Le distributeur est encore vide – attends ${n} s.`],
  [/^Geldautomat geknackt: \+(\d+) Coins!$/, (_, n) => `Distributeur forcé : +${n} pièces !`],
  [/^Crash nach (\d+) m( – neuer Rekord!)?$/, (_, n, r) => `Accident après ${n} m${r ? ' – nouveau record !' : ''}`],
  [/^Schaden (\d+) Prozent$/, (_, n) => `Dégâts ${n} pour cent`],
  [/^Höhe (\d+) m$/, (_, n) => `Altitude ${n} m`],
  [/^FLUG ([\d.]+) s$/, (_, n) => `VOL ${n} s`],
  [/^Laden (\d+) s$/, (_, n) => `Recharge ${n} s`],
  [/^Serie \+([\d.,]+)$/, (_, n) => `Série +${n}`],
  [/^Bank ruht noch (\d+) Min$/, (_, n) => `Banque fermée encore ${n} min`],
  [/^Werkstatt: noch (\d+) s$/, (_, n) => `Garage : encore ${n} s`],
  [/^Reparieren \(R\) in (\d+) s$/, (_, n) => `Réparer (R) dans ${n} s`],
  [/^Falsch – richtig: (.+)$/, (_, a) => `Faux – juste : ${a}`],
  [/^(\d+) Vok\.$/, (_, n) => `${n} mots`],
  [/^Du hast (\d+) richtige Vokabeln gesammelt\. Beantworte unten Vokabeln, um mehr zu sammeln\.$/, (_, n) => `Tu as collecté ${n} mots justes. Réponds ci-dessous à des mots pour en collecter plus.`],
  [/^Du hast$/, () => 'Tu as'],
  [/^richtige Vokabeln gesammelt\. Beantworte unten Vokabeln, um mehr zu sammeln\.$/, () => 'mots justes collectés. Réponds ci-dessous à des mots pour en collecter plus.'],
  [/^Dazu (\d+) Polizei-Bots\.$/, (_, n) => `Plus ${n} bots de police.`],
  [/^🚓 Du bist Polizei: ramme (.+)!$/, (_, n) => `🚓 Tu es la police : percute ${n} !`],
  [/^„(.+)“ löschen\?(.*)$/, (_, n, x) => `Supprimer « ${n} » ?${x ? ' (Admin : circuit d’un autre utilisateur)' : ''}`],
  [/^Strecke (.+)$/, (_, n) => `Circuit ${n}`],
  [/^„(.+)“ ist im Autohaus\.$/, (_, n) => `« ${n} » est à la concession.`],
  [/^(.+) steht jetzt in deiner Garage\.$/, (_, n) => `${n} est maintenant dans ton garage.`],
  [/^(.+) ist jetzt auf Stufe (\d+)\.$/, (_, n, l) => `${n} est maintenant au niveau ${l}.`],
  [/^Verbessern · ([\d.,]+) Coins$/, (_, n) => `Améliorer · ${n} pièces`],
  [/^Verbessern · ([\d.,]+)$/, (_, n) => `Améliorer · ${n}`],
  [/^Kaufen · ([\d.,]+) Coins$/, (_, n) => `Acheter · ${n} pièces`],
  [/^Verkaufen · ca\. ([\d.,]+) Coins$/, (_, n) => `Vendre · env. ${n} pièces`],
  [/^Einsatz abgeschlossen: \+(\d+) Coins$/, (_, n) => `Intervention terminée : +${n} pièces`],
  [/^Teleport zu (.+)!$/, (_, n) => `Téléportation vers ${n} !`],
  [/^Iron Man von (.+) nehmen$/, (_, n) => `Retirer Iron Man à ${n}`],
  [/^(.+) Iron Man geben$/, (_, n) => `Donner Iron Man à ${n}`],
  [/^Farbe (.+)$/, (_, c) => `Couleur ${c}`],
  [/^Meine Garage \((\d+)\)$/, (_, n) => `Mon garage (${n})`],
]

const ATTRS = ['aria-label', 'title', 'placeholder'] as const

export function translate(s: string): string | null {
  const core = s.trim()
  if (!core) return null
  const lead = s.slice(0, s.length - s.trimStart().length), trail = s.slice(s.trimEnd().length)
  const hit = FR[core]
  if (hit !== undefined) return lead + hit + trail
  for (const [re, fn] of PATTERNS) { const m = re.exec(core); if (m) return lead + fn(...(m as unknown as string[])) + trail }
  return null
}

// ---- DOM-Übersetzer (läuft nur im Französisch-Modus) ----
const LS_KEY = 'vt-race-lang'
let lang: RaceLang = 'de'
const subs = new Set<() => void>()
const origText = new WeakMap<Text, string>(), lastText = new WeakMap<Text, string>()
const touched = new Set<Text>()
const origAttr = new WeakMap<Element, Record<string, string>>(), touchedEl = new Set<Element>()
let obs: MutationObserver | null = null
const pending = new Set<Node>()
let raf = 0

function doText(n: Text): void {
  const cur = n.nodeValue ?? ''
  if (lastText.get(n) === cur) return
  const t = translate(cur)
  origText.set(n, cur)
  if (t !== null && t !== cur) { n.nodeValue = t; lastText.set(n, t); touched.add(n) } else lastText.delete(n)
}
function doEl(e: Element): void {
  for (const a of ATTRS) {
    const v = e.getAttribute(a); if (!v) continue
    const o = origAttr.get(e) ?? {}
    if (o[a] !== undefined && translate(o[a]) === v) continue // schon übersetzt
    const t = translate(v)
    if (t !== null && t !== v) { o[a] = v; origAttr.set(e, o); e.setAttribute(a, t); touchedEl.add(e) }
  }
}
function walk(root: Node): void {
  if (root.nodeType === 3) { doText(root as Text); return }
  if (root.nodeType !== 1) return
  const el = root as Element
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(el.tagName)) return
  doEl(el)
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) { if (!['SCRIPT', 'STYLE', 'TEXTAREA'].includes((n.parentElement?.tagName ?? ''))) doText(n as Text) } else doEl(n as Element)
  }
}
function flush(): void {
  raf = 0
  for (const n of pending) if (n.isConnected) walk(n)
  pending.clear()
  for (const n of touched) if (!n.isConnected) touched.delete(n)
}
function start(): void {
  if (obs || typeof document === 'undefined') return
  walk(document.body)
  obs = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => pending.add(n))
      else pending.add(m.target)
    }
    if (!raf) raf = requestAnimationFrame(flush)
  })
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
}
function stop(): void {
  obs?.disconnect(); obs = null; pending.clear()
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  for (const n of touched) { const o = origText.get(n); if (o !== undefined && n.nodeValue === lastText.get(n)) n.nodeValue = o }
  touched.clear()
  for (const e of touchedEl) { const o = origAttr.get(e); if (o) for (const a of Object.keys(o)) e.setAttribute(a, o[a]) }
  touchedEl.clear()
}

export function getLang(): RaceLang { return lang }
export function setLang(l: RaceLang): void {
  if (l === lang) return
  lang = l
  try { localStorage.setItem(LS_KEY, l) } catch { /* ignorieren */ }
  if (l === 'fr') start(); else stop()
  subs.forEach((f) => f())
}
export function subscribeLang(f: () => void): () => void { subs.add(f); return () => { subs.delete(f) } }
/** Beim ersten Einbinden die gemerkte Sprache wiederherstellen. */
export function initLang(): void {
  if (obs || lang === 'fr') return
  let saved: string | null = null
  try { saved = localStorage.getItem(LS_KEY) } catch { /* ignorieren */ }
  if (saved === 'fr') { lang = 'fr'; start(); subs.forEach((f) => f()) }
}
