// Site Rescue — start screen: client-side URL validation only.
// No API request is ever fired from here for invalid input, and slice 1
// defines no API at all — the scanner (/api/scan) arrives in Slice 2.

const form = document.getElementById('scan-form');
const input = document.getElementById('url-input');
const errorEl = document.getElementById('url-error');

const MESSAGES = {
  empty: 'Enter a public website URL to scan.',
  unparseable: "That doesn't look like a URL. Try something like https://example.com",
  scheme: 'Only http:// or https:// URLs can be scanned.',
  notPublic: 'Enter a valid public website URL (like example.com).',
};

/**
 * Returns an error message for invalid input, or null when the value is
 * acceptable to submit. Deliberately lightweight: the server re-validates
 * everything (including non-public destinations) as defense in depth.
 */
function validateUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return MESSAGES.empty;

  // Normalize: allow bare domains like "example.com".
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return MESSAGES.unparseable;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return MESSAGES.scheme;
  }

  // A public website URL has a dotted hostname (rejects "abc", "localhost", etc.).
  const host = parsed.hostname;
  if (!host.includes('.') || host.endsWith('.')) return MESSAGES.notPublic;

  return null;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  input.classList.add('input-error');
  input.setAttribute('aria-invalid', 'true');
}

function clearError() {
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
  input.classList.remove('input-error');
  input.removeAttribute('aria-invalid');
}

form.addEventListener('submit', (event) => {
  // Always prevent the default navigation — nothing loads, nothing scans.
  event.preventDefault();

  const message = validateUrl(input.value);
  if (message) {
    showError(message);
    return; // Stay on the start screen; no request of any kind is made.
  }

  clearError();
  // Valid input: the scan call is wired up in Slice 2 (/api/scan) —
  // by design there is nothing to call yet.
});

// Clear the inline error as soon as the user starts fixing the input.
input.addEventListener('input', () => {
  if (input.hasAttribute('aria-invalid')) clearError();
});
