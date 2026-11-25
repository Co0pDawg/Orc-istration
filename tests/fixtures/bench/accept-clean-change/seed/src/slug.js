// Turns a title into a URL slug: lower case, every run of characters other than a-z and 0-9 becomes one hyphen, and
// there is no hyphen at either end.
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
