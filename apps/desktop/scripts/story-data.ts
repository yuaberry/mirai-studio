/**
 * Story data for the generator — the two episodes, written as real scripts.
 *
 * Each scene is { loc, time, lines: [{ who, text, move, type }] }: the
 * engine turns every scene into shots (establishing + dialogue beats + a
 * reaction), so the runtime math (8 s per shot) comes out right.
 *
 * `who` matches a character id below; empty = narration (no voice).
 * `move` is the storyboard camera movement the shot carries (STATIC/PAN/
 * TILT/DOLLY_IN/DOLLY_OUT/TRACKING/CRANE/HANDHELD) — the free camera-motion
 * engine renders exactly it.
 */

export type Move =
  | 'STATIC'
  | 'PAN'
  | 'TILT'
  | 'DOLLY_IN'
  | 'DOLLY_OUT'
  | 'TRACKING'
  | 'CRANE'
  | 'HANDHELD'
  | 'ZOOM_IN'
  | 'ZOOM_OUT'

export interface StoryCharacter {
  id: string
  name: string
  role: string
  /** Explicit age — the app's maturity guard REQUIRES it for 18+ content. */
  age?: number
  appearance: string
  personality: string
  voice: string
  bio: string
}

export interface StoryLine {
  who: string
  text: string
  move: Move
}

export interface StoryScene {
  loc: string
  time: 'DAY' | 'NIGHT' | 'DAWN' | 'DUSK'
  lines: StoryLine[]
}

export interface Story {
  id: string
  title: string
  projectName: string
  description: string
  genre: string
  contentRating: string
  targetMinutes: number
  premise: string
  themes: string
  tone: string
  characters: StoryCharacter[]
  locations: Array<{ name: string; description: string }>
  scenes: StoryScene[]
  /** Beat pools the engine interleaves to reach the target runtime. */
  beats: Record<string, StoryLine[]>
  /** The art direction string the frame prompts inherit. */
  artDirection: string
}

// ---------------------------------------------------------------- anime 1

const nagatoroCharacters: StoryCharacter[] = [
  {
    id: 'rui',
    name: 'Rui Toma',
    role: 'PROTAGONIST',
    appearance: 'Rapaz de 17 anos, cabelo preto bagunçado e olhos amendoados escuros, óculos redondos, uniforme escolar branco e azul sempre folgado.',
    personality: 'Tímido, sério no desenho, cora com facilidade, secreta e obcecado por mangá.',
    voice: 'pt-BR-AntonioNeural',
    bio: 'Sonha em publicar um mangá próprio e passa os intervalos rabiscando no caderno.',
  },
  {
    id: 'hina',
    name: 'Hina Semura',
    role: 'DEUTERAGONIST',
    appearance: 'Garota de 16 anos, cabelo castanho claro com franja chançada, olhos âmbar provocantes, uniforme com saia mais curta que o regulamento.',
    personality: 'Provocativa, energética, inteligente, esconde carinho atrás de brincadeiras.',
    voice: 'pt-BR-FranciscaNeural',
    bio: 'Do ano de baixo, descobriu o caderno de mangá do senpai e nunca mais o deixou em paz.',
  },
  {
    id: 'mika',
    name: 'Mika Aoba',
    role: 'SUPPORTING',
    appearance: 'Cabelo preto com marias-chiquinhas, olhos verdes vivos, sempre com um lanche na mão.',
    personality: 'Alegre, faladeira, fofoqueira de bom coração.',
    voice: 'pt-BR-ThalitaMultilingualNeural',
    bio: 'Melhor amiga da Hina e motim permanente do clube de arte.',
  },
  {
    id: 'goto',
    name: 'Goto Kenta',
    role: 'SUPPORTING',
    appearance: 'Rapaz alto e relaxado, cabelo louro escuro preso num coque frouxo, camisa desabotoada sobre o uniforme.',
    personality: 'Presidente preguiçoso do clube, sarcástico, protege os dois em silêncio.',
    voice: 'pt-BR-AntonioNeural',
    bio: 'Formando-se este ano e obcecado em deixar o clube de arte com um legado.',
  },
]

// 40 cenas × 4 shots ≈ 172 shots × 8 s ≈ 22,9 min
const nagatoroScenes: StoryScene[] = [
  {
    loc: 'Sala do Clube de Arte',
    time: 'DAY',
    lines: [
      { who: 'hina', text: 'Senpai! Eu vi você desenhando escondido no intervalo. Deixa eu ver esse mangá!', move: 'DOLLY_IN' },
      { who: 'rui', text: 'Não olha! Ainda está uma porcaria... o traço do olho direito está torto.', move: 'STATIC' },
      { who: 'hina', text: 'Torto? Eu acho fofo. Igual o dono.', move: 'PAN' },
      { who: '', text: 'Hina sorri por cima do caderno. Rui esconde o rosto entre as mãos.', move: 'STATIC' },
    ],
  },
  {
    loc: 'Corredor da Escola',
    time: 'DAY',
    lines: [
      { who: 'mika', text: 'Conta tudo! O senpai desenhou o quê? Alguma cena de romance proibido?', move: 'PAN' },
      { who: 'hina', text: 'Melhor: um herói tímido que não sabe se declarar. Coincidência, né?', move: 'PAN' },
      { who: 'rui', text: 'Isso... isso é confidencial de produção!', move: 'DOLLY_OUT' },
      { who: '', text: 'Rui foge pelo corredor com o caderno no peito, sotto voce.', move: 'TRACKING' },
    ],
  },
  {
    loc: 'Sala do Clube de Arte',
    time: 'DUSK',
    lines: [
      { who: 'goto', text: 'Escutem. O festival cultural chegou, e o clube de arte vai publicar uma antologia.', move: 'STATIC' },
      { who: 'mika', text: 'Uma antologia?! Com o mangá do senpai dentro?', move: 'ZOOM_IN' },
      { who: 'rui', text: 'Eu... publ? Diante de gente de verdade?', move: 'STATIC' },
      { who: 'goto', text: 'Gente de verdade vai rir de você, Toma. Faz parte do ofício.', move: 'TILT' },
    ],
  },
]

/** Tecido conectivo: piscinas de diálogo por situação (o beat factory). */
const nagatoroBeats = {
  clube: [
    { who: 'hina', text: 'Senpai, você rabiscou outra página inteira no intervalo. Vício.', move: 'PAN' as Move },
    { who: 'rui', text: 'Estava... pensando em voz alta. No papel. É diferente.', move: 'STATIC' as Move },
    { who: 'mika', text: 'Os dois rindo juntos já contam como cena de romance, sabia?', move: 'PAN' as Move },
    { who: 'goto', text: 'Clube de arte fechado em dez minutos. Abram o olho.', move: 'STATIC' as Move },
  ],
  provocacao: [
    { who: 'hina', text: 'Deixa eu ver o caderno... Estou com vontade de julgar cada linha.', move: 'DOLLY_IN' as Move },
    { who: 'rui', text: 'A sua avaliação é sempre “fofo”. Não é crítica!', move: 'STATIC' as Move },
    { who: 'hina', text: 'É a melhor crítica que existe. Confia.', move: 'PAN' as Move },
    { who: '', text: 'Hina debruça no caderno, os cotovelos roçando o braço dele.', move: 'STATIC' as Move },
  ],
  bloco: [
    { who: 'rui', text: 'Não sai. A cena do festival não sai... parece forçada.', move: 'STATIC' as Move },
    { who: 'hina', text: 'Então desenha o que você sentiu. O medo conta como enredo.', move: 'DOLLY_IN' as Move },
    { who: 'mika', text: 'Traiçã! A Hina deu conselho sério! Alguém filma!', move: 'ZOOM_IN' as Move },
    { who: '', text: 'O lápis de Rui volta a andar. Sozinho. Como se obedecesse a ela.', move: 'TILT' as Move },
  ],
  festival: [
    { who: 'mika', text: 'A barraca do ouriço está lotada! Votar no clube antes de comer?', move: 'PAN' as Move },
    { who: 'goto', text: 'Prioridades, Aoba. Primeiro a antologia, depois a gordura.', move: 'STATIC' as Move },
    { who: 'hina', text: 'Senpai, a fila para a sala do clube tá enorme. Sua cara vai ficar vermelha hoje.', move: 'TRACKING' as Move },
    { who: '', text: 'O corredor lateja de gente, música e luz de papel.', move: 'CRANE' as Move },
  ],
  chuva: [
    { who: 'rui', text: 'Esqueceu o guarda-chuva de novo, não foi?', move: 'STATIC' as Move },
    { who: 'hina', text: 'E se eu quisesse molhar? Você ia segurar o meu guarda-chuva.', move: 'PAN' as Move },
    { who: 'rui', text: 'Sob o meu, a chuva é bem menor. Fica perto.', move: 'STATIC' as Move },
    { who: '', text: 'Os dois dividem o guarda-chuva e andam devagar pela avenida molhada.', move: 'TRACKING' as Move },
  ],
  confissao: [
    { who: 'rui', text: 'Hina. Eu fiz o mangá... e a heroína é você. Sempre foi.', move: 'DOLLY_IN' as Move },
    { who: 'hina', text: 'Senpai... Você demorou. Muito. Mas chegou.', move: 'STATIC' as Move },
    { who: 'rui', text: 'Se você continuar me provocando... eu vou melhorar nisso. Prometo.', move: 'STATIC' as Move },
    { who: '', text: 'Ela ri com os olhos brilhando e encosta a cabeça no ombro dele.', move: 'STATIC' as Move },
  ],
}

const nagatoroKeyScenes: StoryScene[] = [
  ...nagatoroScenes,
  {
    loc: 'Apartamento de Rui',
    time: 'NIGHT',
    lines: [
      { who: 'rui', text: 'A heroína precisa dizer o que sente... mas ela tem medo de estragar tudo.', move: 'STATIC' },
      { who: 'rui', text: 'Estou escrevendo ela covarde porque eu sou covarde.', move: 'DOLLY_IN' },
      { who: '', text: 'A tela do computador reflete o rosto cansado dele.', move: 'STATIC' },
      { who: 'rui', text: 'Amanhã eu pergunto para a Hina. De persona para persona.', move: 'TILT' },
    ],
  },
  {
    loc: 'Sala do Clube de Arte',
    time: 'DUSK',
    lines: [
      { who: 'hina', text: 'Senpai. Todo dia você foge quando eu encosto. Por quê?', move: 'DOLLY_IN' },
      { who: 'rui', text: 'Porque... quando você encosta, eu esqueço o que ia dizer.', move: 'STATIC' },
      { who: 'hina', text: 'Então não fala. Só... fica. Um minuto.', move: 'STATIC' },
      { who: '', text: 'O relógio da sala bate cinco badaladas. Ninguém sai.', move: 'TILT' },
    ],
  },
  {
    loc: 'Avenida Molhada',
    time: 'NIGHT',
    lines: [
      ...nagatoroBeats.chuva,
    ],
  },
  {
    loc: 'Pátio da Escola',
    time: 'DUSK',
    lines: [
      ...nagatoroBeats.confissao,
    ],
  },
]

// ---------------------------------------------------------------- anime 2 (+18)

const hentaiCharacters: StoryCharacter[] = [
  {
    id: 'ayane',
    name: 'Ayane Midorikawa',
    role: 'PROTAGONIST',
    age: 21,
    appearance: 'Mulher de 21 anos, cabelo preto lustroso até a cintura com mechas azuladas, olhos violeta, corpo esguio e curvas acentuadas, blusa branca sem sutiã e saia lápis.',
    personality: 'Provocativa, dominante na brincadeira, devastadoramente carinhosa quando baixa a guarda.',
    voice: 'pt-BR-FranciscaNeural',
    bio: 'Aluna de seminário de ilustração; descobriu os desenhos secretos do senpai e transformou aquilo em jogo.',
  },
  {
    id: 'soma',
    name: 'Soma Kudou',
    role: 'PROTAGONIST',
    age: 23,
    appearance: 'Rapaz de 23 anos, magro, cabelo preto caindo sobre os olhos cinzentos, pulôver folgado e óculos de aro fino.',
    personality: 'Reservado, talentoso, completamente perdido quando provocado.',
    voice: 'pt-BR-AntonioNeural',
    bio: 'Mestrando em belas-artes que desenha nus artísticos que nunca teve coragem de mostrar.',
  },
  {
    id: 'natsu',
    name: 'Natsu Amamiya',
    role: 'SUPPORTING',
    age: 22,
    appearance: 'Mulher de 22 anos, cabelo curto castanho, óculos de sol na cabeça, corpo atlético e sorriso de cúmplice.',
    personality: 'Extrovertida, sem filtro, organiza a “exposição sexy” do seminário.',
    voice: 'pt-BR-ThalitaMultilingualNeural',
    bio: 'Colega de turma da Ayane e presidente do seminário de artes.',
  },
]

const hentaiScenes: StoryScene[] = [
  {
    loc: 'Seminário de Ilustração — Sala 2',
    time: 'DUSK',
    lines: [
      { who: 'natsu', text: 'A exposição do seminário tem tema: “o corpo humano, sem censura”. Soma, você desenha nu artístico, né?', move: 'PAN' },
      { who: 'soma', text: 'Eu... esses são estudos privados. Não são... não são pública.', move: 'STATIC' },
      { who: 'ayane', text: 'Privados? Senpai, eu vi a pasta no seu notebook. Tinha o meu nome escrito.', move: 'DOLLY_IN' },
      { who: '', text: 'Soma congela. Ayane se aproxima por trás da cadeira e lê a tela por cima do ombro.', move: 'TRACKING' },
    ],
  },
]

/** Piscinas de diálogo — do provocativo ao explícito. */
const hentaiBeats = {
  provocacao: [
    { who: 'ayane', text: 'Senpai, você desenhou o meu pescoço com essa precisão... e nem ao menos me olhou hoje.', move: 'DOLLY_IN' as Move },
    { who: 'soma', text: 'Desenhar é... é onde eu consigo olhar. Ao vivo eu travo.', move: 'STATIC' as Move },
    { who: 'ayane', text: 'Que romântico. Então hoje você vai olhar ao vivo. Combina?', move: 'PAN' as Move },
    { who: '', text: 'Ela gira a cadeira dele. Os olhos cinzentos encontram os violetas.', move: 'STATIC' as Move },
  ],
  estudo: [
    { who: 'natsu', text: 'A exposição precisa de três estudos do Seminário. Sugiro o Soma como modelo.', move: 'PAN' as Move },
    { who: 'soma', text: 'Modelo?! Eu sou ilustrador, não... não sou objeto!', move: 'STATIC' as Move },
    { who: 'ayane', text: 'Objeto não. Referência. E eu assino a ficha.', move: 'ZOOM_IN' as Move },
    { who: '', text: 'Ayane segura a mão dele sobre a mesa, interlçando os dedos.', move: 'STATIC' as Move },
  ],
  tensao: [
    { who: 'ayane', text: 'A sua mão está tremendo. E você nem tentou se afastar.', move: 'DOLLY_IN' as Move },
    { who: 'soma', text: 'Eu... eu não sei mais onde é a linha da provocação.', move: 'STATIC' as Move },
    { who: 'ayane', text: 'A linha? Nós dois já passamos dela quando você escreveu meu nome no desenho.', move: 'STATIC' as Move },
    { who: '', text: 'A luz baixa do seminário pinta os dois de âmbar.', move: 'TILT' as Move },
  ],
  apartamento: [
    { who: 'ayane', text: 'Bem-vindo ao meu estúdio, senpai. Lugar de decisões.', move: 'DOLLY_IN' as Move },
    { who: 'soma', text: 'Ayane... Eu não vim aqui pelo seminário.', move: 'STATIC' as Move },
    { who: 'ayane', text: 'Eu sei. Você veio porque eu mandei. E porque você quis.', move: 'PAN' as Move },
    { who: '', text: 'A porta fecha atrás deles. A cidade acende lá fora.', move: 'STATIC' as Move },
  ],
  climaxo: [
    { who: 'ayane', text: 'Agora eu sou o seu estudo. Pode tocar... pode olhar. Eu autorizo.', move: 'DOLLY_IN' as Move },
    { who: 'soma', text: 'Você é... você é muito mais bonita que o meu desenho.', move: 'STATIC' as Move },
    { who: 'ayane', text: 'Então desenha de novo. Com as duas mãos. Depois... me beija.', move: 'STATIC' as Move },
    { who: '', text: 'O traço do lápis para. Só resta o som da respiração dos dois.', move: 'STATIC' as Move },
  ],
  pos: [
    { who: 'soma', text: 'Eu levei anos para aprender o seu contorno. E hoje eu conheci o resto.', move: 'DOLLY_IN' as Move },
    { who: 'ayane', text: 'Senpai... deita aqui. A noite ainda é longa, e o seminário que espere.', move: 'STATIC' as Move },
    { who: 'soma', text: 'Amanhã você vai me provocar por isso, não vai?', move: 'PAN' as Move },
    { who: '', text: 'Ela ri baixinho contra o peito dele, satisfeita.', move: 'STATIC' as Move },
  ],
}

const hentaiKeyScenes: StoryScene[] = [
  ...hentaiScenes,
  {
    loc: 'Seminário de Ilustração — Sala 2',
    time: 'NIGHT',
    lines: [...hentaiBeats.tensao],
  },
  {
    loc: 'Apartamento de Ayane',
    time: 'NIGHT',
    lines: [...hentaiBeats.apartamento],
  },
  {
    loc: 'Apartamento de Ayane',
    time: 'NIGHT',
    lines: [...hentaiBeats.climaxo],
  },
  {
    loc: 'Apartamento de Ayane',
    time: 'DAWN',
    lines: [...hentaiBeats.pos],
  },
]

/** The two generation jobs. */
export const STORIES: Record<string, Story> = {
  nagatoro: {
    id: 'nagatoro',
    title: 'A Arte de Te Provocar',
    projectName: 'A Arte de Te Provocar — E01',
    description:
      'Uma comédia romântica de clube de arte inspirada no clima de Nagatoro-san: a caloura do ano de baixo vive provocando o senpai tímodo que sonha publicar mangá.',
    genre: 'Comédia romântica, Escola, Slice of Life',
    contentRating: '13+',
    targetMinutes: 23,
    premise:
      'Hina Semura descobre o caderno de mangá secreto de Rui Toma e passa a provocá-lo sem piedade — mas cada provocação esconde um carinho que nenhum dos dois sabe nomear. Com o festival cultural se aproximando, o clube de arte precisa publicar uma antologia, e o senpai precisa decidir se continua escondido ou finalmente se mostra.',
    themes: 'Coragem, vulnerabilidade, o cuidado escondido nas brincadeiras, primeiro amor.',
    tone: 'Leve, provocador, quente em momentos pontuais, com final emocionante.',
    characters: nagatoroCharacters,
    locations: [
      { name: 'Sala do Clube de Arte', description: 'Sala ampla com cavaletes, luz do poente e cheiro de tinta.' },
      { name: 'Corredor da Escola', description: 'Corredor de janelas altas, sakuras ao fundo.' },
      { name: 'Pátio da Escola', description: 'Pátio amplo com a sakura centenária e barracas do festival.' },
    ],
    scenes: nagatoroKeyScenes,
    beats: nagatoroBeats,
    artDirection:
      'anime japonês moderno de televisão, traço limpo, cores quentes, iluminação suave de poente, olhos expressivos, estilo Nagatoro-san / Doga Kobo, alta qualidade, 1344x768',
  },
  hentai: {
    id: 'hentai',
    title: 'Depois do Clube',
    projectName: 'Depois do Clube — E01',
    description:
      'Um anime adulto (+18) de seminário de ilustração: a caloura provocadora transforma os desenhos secretos do senpai em um jogo de tensão que escala de brincadeira a explícito.',
    genre: 'Adulto, Romance, Seminário de Arte',
    contentRating: '18+',
    targetMinutes: 19,
    premise:
      'Ayane encontra a pasta de estudos de nus secreta de Soma — e o nome dela está nos desenhos. O que começa como provocação no seminário vira um jogo de tensão que termina no apartamento dela, com o seminário inteiro como plateia involuntária.',
    themes: 'Desejo, vulnerabilidade, o jogo entre dominar e se entregar, confession após a entrega.',
    tone: 'Sensual, provocativo, explícito nos atos finais, emocional no meio.',
    characters: hentaiCharacters,
    locations: [
      { name: 'Seminário de Ilustração — Sala 2', description: 'Sala noturna com cavaletes, lampiões quentes e cheiro de tinta.' },
      { name: 'Apartamento de Ayane', description: 'Apartamento bagunçado e quente, livros de arte, luz baixa âmbar.' },
      { name: 'Telhado da Universidade', description: 'Telhado à noite, vento, luzes da cidade.' },
    ],
    scenes: hentaiKeyScenes,
    beats: hentaiBeats,
    artDirection:
      'anime japonês adulto moderno, traço limpo e delicado, pele quente, iluminação baixa e sensual, alta qualidade, 1344x768',
  },
}