/** Französische Substantive mit eindeutigem Geschlecht (ohne Elision: kein l’ + Vokal). */
export interface Noun { fr: string; de: string; g: 'le' | 'la' }

const m = (fr: string, de: string): Noun => ({ fr, de, g: 'le' })
const f = (fr: string, de: string): Noun => ({ fr, de, g: 'la' })

export const NOUNS: Noun[] = [
  m('livre', 'Buch'), m('stylo', 'Kugelschreiber'), m('cahier', 'Heft'), m('sac', 'Tasche'), m('professeur', 'Lehrer'),
  m('garçon', 'Junge'), m('chat', 'Katze'), m('chien', 'Hund'), m('pain', 'Brot'), m('fromage', 'Käse'),
  m('vin', 'Wein'), m('café', 'Kaffee'), m('jardin', 'Garten'), m('village', 'Dorf'), m('pays', 'Land'),
  m('voyage', 'Reise'), m('train', 'Zug'), m('avion', 'Flugzeug'), m('vélo', 'Fahrrad'), m('soleil', 'Sonne'),
  m('ciel', 'Himmel'), m('matin', 'Morgen'), m('soir', 'Abend'), m('jour', 'Tag'), m('mois', 'Monat'),
  m('temps', 'Zeit, Wetter'), m('travail', 'Arbeit'), m('bureau', 'Büro'), m('magasin', 'Geschäft'), m('marché', 'Markt'),
  m('musée', 'Museum'), m('théâtre', 'Theater'), m('cinéma', 'Kino'), m('restaurant', 'Restaurant'), m('lit', 'Bett'),
  m('mur', 'Wand'), m('toit', 'Dach'), m('gâteau', 'Kuchen'), m('repas', 'Mahlzeit'), m('frère', 'Bruder'),
  m('père', 'Vater'), m('fils', 'Sohn'), m('oncle', 'Onkel'), m('mari', 'Ehemann'), m('copain', 'Freund'),
  m('pantalon', 'Hose'), m('manteau', 'Mantel'), m('pull', 'Pullover'), m('chapeau', 'Hut'), m('nez', 'Nase'),
  m('doigt', 'Finger'), m('dos', 'Rücken'), m('bras', 'Arm'), m('pied', 'Fuß'), m('visage', 'Gesicht'),
  m('sport', 'Sport'), m('film', 'Film'), m('journal', 'Zeitung'), m('téléphone', 'Telefon'), m('ordinateur', 'Computer'),
  m('prix', 'Preis'), m('argent', 'Geld'), m('billet', 'Fahrkarte'), m('chemin', 'Weg'), m('pont', 'Brücke'),
  m('fleuve', 'Fluss'), m('lac', 'See'), m('poisson', 'Fisch'), m('oiseau', 'Vogel'), m('cheval', 'Pferd'),
  f('table', 'Tisch'), f('chaise', 'Stuhl'), f('porte', 'Tür'), f('fenêtre', 'Fenster'), f('maison', 'Haus'),
  f('voiture', 'Auto'), f('école', 'Schule'), f('classe', 'Klasse'), f('ville', 'Stadt'), f('rue', 'Straße'),
  f('route', 'Landstraße'), f('gare', 'Bahnhof'), f('plage', 'Strand'), f('montagne', 'Berg'), f('forêt', 'Wald'),
  f('rivière', 'Fluss (klein)'), f('mer', 'Meer'), f('lune', 'Mond'), f('étoile', 'Stern'), f('pluie', 'Regen'),
  f('neige', 'Schnee'), f('fleur', 'Blume'), f('plante', 'Pflanze'), f('pomme', 'Apfel'), f('banane', 'Banane'),
  f('poire', 'Birne'), f('fraise', 'Erdbeere'), f('tomate', 'Tomate'), f('salade', 'Salat'), f('soupe', 'Suppe'),
  f('viande', 'Fleisch'), f('glace', 'Eis'), f('tarte', 'Kuchen, Torte'), f('boisson', 'Getränk'), f('bière', 'Bier'),
  f('cuisine', 'Küche'), f('chambre', 'Zimmer'), f('salle', 'Saal'), f('tête', 'Kopf'), f('main', 'Hand'),
  f('jambe', 'Bein'), f('bouche', 'Mund'), f('dent', 'Zahn'), f('langue', 'Sprache, Zunge'), f('nuit', 'Nacht'),
  f('semaine', 'Woche'), f('année', 'Jahr'), f('heure', 'Stunde'), f('minute', 'Minute'), f('famille', 'Familie'),
  f('mère', 'Mutter'), f('sœur', 'Schwester'), f('fille', 'Mädchen, Tochter'), f('tante', 'Tante'), f('femme', 'Frau'),
  f('robe', 'Kleid'), f('jupe', 'Rock'), f('chemise', 'Hemd'), f('chaussure', 'Schuh'), f('veste', 'Jacke'),
  f('valise', 'Koffer'), f('clé', 'Schlüssel'), f('lettre', 'Brief'), f('carte', 'Karte'), f('photo', 'Foto'),
  f('musique', 'Musik'), f('radio', 'Radio'), f('télévision', 'Fernsehen'), f('fête', 'Fest'), f('vie', 'Leben'),
  f('peur', 'Angst'), f('chance', 'Glück'), f('idée', 'Idee'), f('question', 'Frage'), f('réponse', 'Antwort'),
  f('leçon', 'Lektion'), f('histoire', 'Geschichte'), f('vache', 'Kuh'), f('souris', 'Maus'),
]
