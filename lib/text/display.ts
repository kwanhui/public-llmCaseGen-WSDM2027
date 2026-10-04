// Display rules shared by the instructor and student pages, so an instructor
// reads the words the students see. The stored text is not changed.

// "Gather & inspect the financials" is shown as "Gather and inspect the
// financials". The student page's phase stepper applies the same rule.
export function andForAmpersand(text: string): string {
  return text.replace(/\s*&\s*/g, " and ");
}

// Discipline names in sentence case ("Social work"), for labels. The pack
// labels stay as they are, since they also reach the model's prompt; lower
// case inside a sentence is the caller's job.
export function disciplineName(label: string): string {
  const t = label.trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
