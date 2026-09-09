const CORE_NUMBER = /^(0|[1-9]\d*)$/;
const IDENTIFIER = /^[0-9A-Za-z-]+$/;

/**
 * @param {string | undefined} value
 * @param {boolean} numericLeadingZeroAllowed
 */
function validIdentifiers(value, numericLeadingZeroAllowed) {
  if (value === undefined) return true;
  const identifiers = value.split('.');
  return identifiers.every(
    (identifier) =>
      identifier.length > 0 &&
      IDENTIFIER.test(identifier) &&
      (numericLeadingZeroAllowed ||
        !/^\d+$/.test(identifier) ||
        CORE_NUMBER.test(identifier)),
  );
}

/** @param {string} value */
export function isSemanticVersion(value) {
  const plus = value.indexOf('+');
  if (plus !== -1 && value.indexOf('+', plus + 1) !== -1) return false;
  const build = plus === -1 ? undefined : value.slice(plus + 1);
  const withoutBuild = plus === -1 ? value : value.slice(0, plus);
  const dash = withoutBuild.indexOf('-');
  const prerelease = dash === -1 ? undefined : withoutBuild.slice(dash + 1);
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const parts = core.split('.');
  return (
    parts.length === 3 &&
    parts.every((part) => CORE_NUMBER.test(part)) &&
    validIdentifiers(prerelease, false) &&
    validIdentifiers(build, true)
  );
}
