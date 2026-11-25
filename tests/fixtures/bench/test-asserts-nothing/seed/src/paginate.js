// The items on one page: `number` counts from 1, `size` items per page.
export function page(items, number, size) {
  const start = (number - 1) * size;
  return items.slice(start, start + size);
}
