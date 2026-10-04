// A seeded example variant has a public link and no instructor of the
// visitor's own, so the student page names the instructor who set the example
// rather than "your instructor".
export function instructorWord(seeded: boolean, capital = false): string {
  const phrase = seeded ? "the instructor who set this example" : "your instructor";
  return capital ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
}
