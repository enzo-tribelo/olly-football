export type Lang = 'en' | 'it';

/** Exact English strings that have an Italian equivalent. Unknown strings stay as written. */
const itText: Record<string, string> = {
  'Striker / Forward': 'Attaccante',
  'Right (Strong Left)': 'Destro (sinistro forte)',
  'British / Italian': 'Britannica / italiana',

  'Finishing': 'Finalizzazione',
  'Chance Creation': 'Creazione di occasioni',
  'Clutch Moments': 'Momenti decisivi',
  'Dribbling / 1v1': 'Dribbling / uno contro uno',
  'Pace & Athleticism': 'Velocità e atletismo',
  'Aerial Ability': 'Gioco aereo',

  '95G in 96 apps; clinical at regional & county level, developing at U18':
    '95 gol in 96 presenze; cinico a livello regionale e di contea, in crescita in Under 18',
  '65 assists in 96 apps; 0.43/game at competitive levels — exceptional for a striker':
    '65 assist in 96 presenze; 0,43 a partita a livello agonistico — eccezionale per un attaccante',
  'Hat-tricks in cup finals; big-game performer across all levels':
    'Triplette nelle finali di coppa; rende nelle partite decisive a ogni livello',
  'Direct, powerful; strong at lower levels, developing at U18':
    'Diretto e potente; forte nei livelli inferiori, in crescita in Under 18',
  '27.8 km/h top speed; above average for age, below elite academy threshold':
    'Velocità massima 27,8 km/h; sopra la media per l’età, sotto la soglia delle academy d’élite',
  'Competitive but not a primary weapon; developing with physical growth':
    'Competitivo, ma non è l’arma principale; in crescita con lo sviluppo fisico',

  'SW Regional Winners': 'Vincitori regionali del Sud-Ovest',
  'England Schools Semi-Final': 'Semifinale England Schools',
  'North Wilts League Winners': 'Vincitori della North Wilts League',
  'County Cup Runners-Up': 'Finalisti della County Cup',
  'League & Cup Double': 'Doppietta campionato e coppa',
  'AC Milan Training Camp': 'Stage AC Milan',
  'Elite European Exposure': 'Esperienza europea di alto livello',
  'League 1 & Cup Double': 'Doppietta campionato e coppa',
  'AC Milan Training Camp (Italy)': 'Stage AC Milan (Italia)',
  'Senior debut at 16': 'Esordio in prima squadra a 16 anni',
  'Academy step-up to U18': 'Passaggio all’Under 18',

  'Olly Robinson bicycle kick in a match': 'Rovesciata di Olly Robinson in partita',
  'Bicycle kick — match': 'Rovesciata in partita',
  'Bath City U18 vs Cirencester': 'Bath City U18 contro Cirencester',
  'Number 9 — Bath City': 'Numero 9 — Bath City',
  'Goal celebration — Wiltshire FA': 'Esultanza dopo un gol — Wiltshire FA',
  'North Wilts Youth League trophy': 'Trofeo della North Wilts Youth League',
  'Melksham Town — senior reserves': 'Melksham Town — squadra riserve',
  'Number 9 on the pitch': 'Numero 9 in campo',
  'AC Milan Camp at Villaggio Marzotto, Italy': 'Stage AC Milan a Villaggio Marzotto, Italia',
  'Cup winner — AFC Corsham': 'Vincitore di coppa — AFC Corsham',
  'Beach football — Italy': 'Calcio sulla spiaggia — Italia',
  'Wiltshire Schools FA U16 — 3-2 winners vs Gloucestershire':
    'Wiltshire Schools FA U16 — vittoria 3-2 contro il Gloucestershire',
  'Bath City U18 team huddle before kick-off': 'Cerchio del Bath City U18 prima del calcio d’inizio',
  'Olly Robinson rounding the goalkeeper': 'Olly Robinson che supera il portiere',
  'Olly Robinson winning an aerial duel': 'Olly Robinson che vince un duello aereo',
  'Olly in action for Calne Town Youth': 'Olly in azione con il Calne Town Youth',

  'Bath City U18 — Highlight Reel Dec 6': 'Bath City U18 — Sintesi del 6 dicembre',
  'Highlight Reel — March 2026': 'Sintesi — marzo 2026',
  'Melksham Town — Assist': 'Melksham Town — Assist',
  'Melksham Town U18 — Clip': 'Melksham Town U18 — Spezzone',
  'Bath City U18 vs Yeovil College — Goal 1': 'Bath City U18 contro Yeovil College — Gol 1',
  'Won 6-1 · November 2025': 'Vittoria 6-1 · novembre 2025',
  highlight: 'sintesi',
  match: 'partita',
  training: 'allenamento',
};

export function tr(lang: Lang, text: string): string {
  if (lang !== 'it') return text;
  return itText[text] ?? text;
}

export function homeUi(lang: Lang) {
  const it = lang === 'it';
  return {
    locale: it ? 'it-IT' : 'en-GB',
    title: it ? 'Olly Robinson — Attaccante | OR9' : 'Olly Robinson — OR9',
    monthName: (month: number) => (month === 7 ? (it ? 'luglio' : 'July') : String(month)),
    dobLine: (monthLabel: string, year: number, age: number) =>
      it ? `${monthLabel} ${year} (${age} anni)` : `${monthLabel} ${year} (Age ${age})`,
    goalsWord: it ? 'gol' : 'goals',
    assistsWord: it ? 'assist' : 'assists',
    quoteTail: (apps: number, age: number) =>
      it
        ? `in ${apps} partite nelle ultime 2 stagioni. Ora gioca in Under 18 e nelle riserve senior, a ${age} anni.`
        : `in ${apps} games across the last 2 seasons. Now playing U18 & senior reserve football at ${age}.`,
    goals: it ? 'Gol' : 'Goals',
    assists: it ? 'Assist' : 'Assists',
    apps: it ? 'Presenze' : 'Apps',
    ga: it ? 'G/A a partita' : 'G/A per game',
    gaTooltip: it
      ? 'Gol e assist sommati per ogni partita giocata'
      : 'Goals and assists combined per game played',
    seasonCount: (n: number) =>
      it ? `${n} stagion${n === 1 ? 'e' : 'i'}` : `${n} season${n === 1 ? '' : 's'}`,
    viewHistory: it ? 'Vedi lo storico completo ↓' : 'View full history ↓',
    currentClubs: it ? 'Squadre attuali' : 'Current clubs',
    technical: it ? 'Profilo tecnico' : 'Technical Profile',
    gps: it ? 'Prestazioni GPS' : 'GPS Performance',
    gpsTracked: (n: number) =>
      it
        ? `Rilevato con GPS PlayerData · ${n} partite · Bath City U18 2025-26`
        : `Tracked via PlayerData GPS · ${n} matches · Bath City U18 2025-26`,
    topSpeed: it ? 'Velocità max (km/h)' : 'Top Speed (km/h)',
    avgDistance: it ? 'Distanza media (km)' : 'Avg Distance (km)',
    avgSprints: it ? 'Sprint medi' : 'Avg Sprints',
    avgHighIntensity: it ? 'Alta intensità media' : 'Avg High Intensity',
    analysis: it ? 'Analisi delle prestazioni' : 'Performance Analysis',
    playingMins: (estimate: boolean, mins: number) =>
      it ? `· ${estimate ? '~' : ''}${mins} minuti` : `· ${estimate ? '~' : ''}${mins} mins`,
    viewGps: it ? 'Dati GPS completi' : 'View Full GPS Data',
    viewGpsAria: it ? 'Vedi tutti i dati GPS' : 'View full GPS performance data',
    seasons: it ? 'Stagione per stagione' : 'Season by Season',
    mins: it ? 'Minuti' : 'Mins',
    g90Tip: it ? 'Gol segnati ogni 90 minuti giocati' : 'Goals scored per 90 minutes played',
    a90Tip: it ? 'Assist ogni 90 minuti giocati' : 'Assists per 90 minutes played',
    standout: it ? 'Prestazioni di rilievo' : 'Standout Performances',
    versus: (opponent: string) => (it ? `contro ${opponent}` : `vs ${opponent}`),
    honours: it ? 'Palmarès' : 'Honours & Recognition',
    player: it ? 'Scheda giocatore' : 'Player Info',
    physical: it ? 'Fisico' : 'Physical',
    height: it ? 'Altezza' : 'Height',
    weight: it ? 'Peso' : 'Weight',
    foot: it ? 'Piede preferito' : 'Preferred Foot',
    position: it ? 'Ruolo' : 'Position',
    personal: it ? 'Anagrafica' : 'Personal',
    dob: it ? 'Data di nascita' : 'Date of Birth',
    age: it ? 'Età' : 'Age',
    nationality: it ? 'Nazionalità' : 'Nationality',
    location: it ? 'Località' : 'Location',
    clubs: it ? 'Squadre attuali' : 'Current Clubs',
    academy: it ? 'Settore giovanile' : 'Academy',
    dualReg: it ? 'Doppio tesseramento' : 'Dual Reg',
    gallery: it ? 'Galleria' : 'Gallery',
    badge: (name: string) => (it ? `Stemma ${name}` : `${name} badge`),
    footerTag: (age: number) =>
      it ? `⚽ Attaccante · ${age} anni · Wiltshire` : `⚽ Striker · Age ${age} · Wiltshire`,
    footage: it ? 'Video' : 'Footage',
    builtBy: it ? 'Realizzato da' : 'Built by',
    lbLabel: it ? 'Galleria fotografica' : 'Photo gallery',
    lbClose: it ? 'Chiudi la galleria' : 'Close gallery',
    lbPrev: it ? 'Foto precedente' : 'Previous photo',
    lbNext: it ? 'Foto successiva' : 'Next photo',
    description: (goals: number, assists: number, apps: number, club0: string, club1: string, age: number) =>
      it
        ? `Olly Robinson — Attaccante. ${goals} gol, ${assists} assist in ${apps} partite giovanili. ${club0}, ${club1}. ${age} anni, Wiltshire.`
        : `Olly Robinson — Attacking Forward / Striker. ${goals} goals, ${assists} assists in ${apps} youth games. ${club0}, ${club1}. Age ${age}, Wiltshire.`,
    jobTitle: (position: string) => (it ? `Calciatore — ${position}` : `Footballer — ${position}`),
    nav: {
      stats: it ? 'Statistiche' : 'Stats',
      seasons: it ? 'Stagioni' : 'Seasons',
      honours: it ? 'Palmarès' : 'Honours',
      gallery: it ? 'Galleria' : 'Gallery',
      matches: it ? 'Partite' : 'Matches',
      gps: 'GPS',
      footage: it ? 'Video' : 'Footage',
      home: 'Home',
      language: it ? 'Lingua' : 'Language',
      copied: it ? 'Link copiato!' : 'Link copied!',
      skip: it ? 'Vai al contenuto' : 'Skip to content',
      share: it ? 'Condividi questa pagina' : 'Share this page',
    },
  };
}

export function footageUi(lang: Lang) {
  const it = lang === 'it';
  return {
    title: it ? 'Video — Olly Robinson | OR9' : 'Footage — Olly Robinson | OR9',
    description: it
      ? 'Video delle partite, sintesi e gol di Olly Robinson — Attaccante. Bath City U18, Melksham Town.'
      : 'Match footage, highlights and goals for Olly Robinson — Attacking Forward. Bath City U18, Melksham Town.',
    profile: it ? 'Profilo' : 'Profile',
    crumb: it ? 'Video' : 'Footage',
    eyebrow: it ? 'Video delle partite e sintesi' : 'Match Footage & Highlights',
    watch: it ? 'Guarda' : 'Watch',
    intro: it
      ? 'Sintesi delle partite, gol e spezzoni di torneo.'
      : 'Match highlights, goals and tournament clips.',
    play: (title: string) => (it ? `Riproduci il video: ${title}` : `Play video: ${title}`),
    playerFallback: it ? 'Lettore video' : 'Video player',
    subscribe: it ? 'Iscriviti su YouTube' : 'Subscribe on YouTube',
    subscribeBody: it
      ? 'Nuovi spezzoni e gol caricati durante la stagione. Iscriviti per restare aggiornato.'
      : 'New match clips and goals uploaded throughout the season. Subscribe to stay up to date.',
  };
}
