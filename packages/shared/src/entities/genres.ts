/**
 * The full anime genre taxonomy (demographics + themes + formats), used to
 * tag productions at creation and in the config editor. The complete
 * industry list — from Isekai to Ecchi to Psychological.
 */
export const ANIME_GENRES = [
  // demographics
  'Shounen',
  'Shoujo',
  'Seinen',
  'Josei',
  'Kodomo',
  // core
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Romance',
  'Slice of Life',
  'Fantasy',
  'Sci-Fi',
  'Supernatural',
  'Horror',
  'Mystery',
  'Psychological',
  'Thriller',
  'Suspense',
  'Sports',
  // themes
  'Isekai',
  'Dark Fantasy',
  'Mecha',
  'Cyberpunk',
  'Ecchi',
  'Harem',
  'Reverse Harem',
  'Shounen Ai',
  'Shoujo Ai',
  'Yuri',
  'Magic',
  'School',
  'Martial Arts',
  'Super Power',
  'Music',
  'Idol',
  'Military',
  'Historical',
  'Samurai',
  'Ninja',
  'Post-Apocalyptic',
  'Survival',
  'Zombie',
  'Vampire',
  'Space',
  'Time Travel',
  'Video Game',
  'Virtual Reality',
  'Detective',
  'Parody',
  'Gag Humor',
  'Gourmet',
  'Medical',
  'Tragedy',
] as const

export type AnimeGenre = (typeof ANIME_GENRES)[number]

export const HOT_GENRES: ReadonlySet<string> = new Set([
  'Isekai',
  'Romance',
  'Fantasy',
  'Shounen',
  'Ecchi',
  'Harem',
  'Yuri',
  'Psychological',
])
