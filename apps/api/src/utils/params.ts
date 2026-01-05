/**
 * Parse a route parameter as an integer.
 * Returns null if the value is undefined, empty, non-numeric, or negative.
 * 
 * @param value - The string value from req.params
 * @returns The parsed integer, or null if invalid
 */
export function parseIntParam(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  
  // Check if it's a valid integer format (no decimals, no leading zeros except "0")
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }
  
  const parsed = parseInt(value, 10);
  
  // Should never be NaN given the regex, but belt and suspenders
  if (isNaN(parsed)) {
    return null;
  }
  
  // Reject negative numbers (invalid for DB IDs)
  if (parsed < 0) {
    return null;
  }
  
  return parsed;
}
