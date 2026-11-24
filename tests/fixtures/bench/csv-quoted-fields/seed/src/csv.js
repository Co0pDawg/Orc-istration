// Splits one CSV line into its fields. Fields are separated by commas; quoting is not supported yet.
export function parseLine(line) {
  return line.split(',');
}
