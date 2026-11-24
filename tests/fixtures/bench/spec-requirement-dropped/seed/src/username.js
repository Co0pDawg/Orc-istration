// Checks a proposed username and returns the list of problems (empty when it is valid).
export function validateUsername(name) {
  const problems = [];
  if (name.length < 3) problems.push('too short');
  if (name.length > 20) problems.push('too long');
  return problems;
}
