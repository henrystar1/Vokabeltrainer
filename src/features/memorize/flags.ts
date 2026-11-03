/** Flaggen lernen. Bilder kommen von flagcdn.com (kleine PNG-Dateien, ISO-Ländercode). */
export type Region = 'europa' | 'asien' | 'afrika' | 'amerika' | 'ozeanien'
export type Rng = () => number

export interface Country { code: string; name: string; region: Region }

export const REGIONS: Array<{ id: Region; name: string }> = [
  { id: 'europa', name: 'Europa' },
  { id: 'asien', name: 'Asien' },
  { id: 'afrika', name: 'Afrika' },
  { id: 'amerika', name: 'Amerika' },
  { id: 'ozeanien', name: 'Ozeanien' },
]

const c = (region: Region, list: string): Country[] =>
  list.split(';').map((s) => { const [code, name] = s.split('='); return { code, name, region } })

export const COUNTRIES: Country[] = [
  ...c('europa', 'de=Deutschland;at=Österreich;ch=Schweiz;fr=Frankreich;it=Italien;es=Spanien;pt=Portugal;gb=Vereinigtes Königreich;ie=Irland;nl=Niederlande;be=Belgien;lu=Luxemburg;dk=Dänemark;se=Schweden;no=Norwegen;fi=Finnland;is=Island;pl=Polen;cz=Tschechien;sk=Slowakei;hu=Ungarn;si=Slowenien;hr=Kroatien;rs=Serbien;ba=Bosnien und Herzegowina;me=Montenegro;mk=Nordmazedonien;al=Albanien;gr=Griechenland;bg=Bulgarien;ro=Rumänien;md=Moldau;ua=Ukraine;by=Belarus;lt=Litauen;lv=Lettland;ee=Estland;mt=Malta;cy=Zypern;li=Liechtenstein;mc=Monaco;ad=Andorra;sm=San Marino'),
  ...c('asien', 'tr=Türkei;ru=Russland;cn=China;jp=Japan;kr=Südkorea;kp=Nordkorea;in=Indien;pk=Pakistan;bd=Bangladesch;lk=Sri Lanka;np=Nepal;th=Thailand;vn=Vietnam;kh=Kambodscha;la=Laos;mm=Myanmar;my=Malaysia;sg=Singapur;id=Indonesien;ph=Philippinen;mn=Mongolei;kz=Kasachstan;uz=Usbekistan;af=Afghanistan;ir=Iran;iq=Irak;sy=Syrien;lb=Libanon;il=Israel;jo=Jordanien;sa=Saudi-Arabien;ae=Vereinigte Arabische Emirate;qa=Katar;ye=Jemen;om=Oman;ge=Georgien;am=Armenien;az=Aserbaidschan'),
  ...c('afrika', 'eg=Ägypten;ma=Marokko;dz=Algerien;tn=Tunesien;ly=Libyen;ng=Nigeria;gh=Ghana;sn=Senegal;ci=Elfenbeinküste;cm=Kamerun;et=Äthiopien;ke=Kenia;tz=Tansania;ug=Uganda;rw=Ruanda;sd=Sudan;za=Südafrika;na=Namibia;bw=Botswana;zw=Simbabwe;zm=Sambia;ao=Angola;mz=Mosambik;mg=Madagaskar;cd=Demokratische Republik Kongo;so=Somalia'),
  ...c('amerika', 'us=Vereinigte Staaten;ca=Kanada;mx=Mexiko;cu=Kuba;jm=Jamaika;do=Dominikanische Republik;ht=Haiti;gt=Guatemala;cr=Costa Rica;pa=Panama;co=Kolumbien;ve=Venezuela;ec=Ecuador;pe=Peru;bo=Bolivien;br=Brasilien;py=Paraguay;uy=Uruguay;ar=Argentinien;cl=Chile'),
  ...c('ozeanien', 'au=Australien;nz=Neuseeland;fj=Fidschi;pg=Papua-Neuguinea;ws=Samoa;to=Tonga'),
]

export const flagUrl = (code: string, width: 160 | 320 = 320): string => `https://flagcdn.com/w${width}/${code}.png`

export interface FlagQuestion {
  country: Country
  /** vier Antworten (inklusive der richtigen), Reihenfolge gemischt */
  options: Country[]
  /** 'name': Flagge zeigen, Land wählen. 'flag': Land nennen, Flagge wählen. */
  mode: 'name' | 'flag'
}

function shuffle<T>(a: readonly T[], r: Rng): T[] {
  const x = [...a]
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]] }
  return x
}

/** Pool nach Regionen; leere Auswahl = alle. */
export const poolFor = (regions: readonly Region[]): Country[] => (regions.length === 0 ? COUNTRIES : COUNTRIES.filter((x) => regions.includes(x.region)))

/** Falsche Antworten stammen bevorzugt aus derselben Region, sonst aus allen. */
export function makeQuestions(pool: readonly Country[], count: number, mode: 'name' | 'flag', r: Rng = Math.random): FlagQuestion[] {
  const chosen = shuffle(pool, r).slice(0, Math.min(count, pool.length))
  return chosen.map((country) => {
    const near = pool.filter((x) => x.code !== country.code && x.region === country.region)
    const rest = pool.filter((x) => x.code !== country.code && x.region !== country.region)
    const wrong = [...shuffle(near, r), ...shuffle(rest, r)].slice(0, 3)
    const extra = wrong.length < 3 ? shuffle(COUNTRIES.filter((x) => x.code !== country.code && !wrong.includes(x)), r).slice(0, 3 - wrong.length) : []
    return { country, mode, options: shuffle([country, ...wrong, ...extra], r) }
  })
}
