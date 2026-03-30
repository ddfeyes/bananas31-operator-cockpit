const STORAGE_KEY = 'bananas31-operator-cockpit';

const VALID_INTERVALS = new Set(['1m', '5m', '30m', '1h', '4h', '1d']);
const VALID_FOCUS_MODES = new Set(['all', 'basis', 'leverage', 'funding']);

export function readStoredCockpitPrefs(storage = globalThis?.localStorage) {
  if (!storage) {
    return { interval: '4h', focusMode: 'all' };
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return { interval: '4h', focusMode: 'all' };
    }

    const parsed = JSON.parse(raw);
    return {
      interval: VALID_INTERVALS.has(parsed.interval) ? parsed.interval : '4h',
      focusMode: VALID_FOCUS_MODES.has(parsed.focusMode) ? parsed.focusMode : 'all'
    };
  } catch {
    return { interval: '4h', focusMode: 'all' };
  }
}

export function writeStoredCockpitPrefs(
  storage = globalThis?.localStorage,
  prefs = { interval: '4h', focusMode: 'all' }
) {
  if (!storage) {
    return;
  }

  const payload = {
    interval: VALID_INTERVALS.has(prefs.interval) ? prefs.interval : '4h',
    focusMode: VALID_FOCUS_MODES.has(prefs.focusMode) ? prefs.focusMode : 'all'
  };

  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function resolveReplayNeighbor(events, currentEventId, direction = 1) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const currentIndex = events.findIndex((event) => event.id === currentEventId);
  if (currentIndex === -1) {
    return direction >= 0 ? events[0] : events[events.length - 1];
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= events.length) {
    return events[currentIndex];
  }

  return events[nextIndex];
}

export function matchHotkeyAction(eventLike) {
  const target = eventLike?.target;
  const tagName = target?.tagName?.toLowerCase();
  if (
    eventLike?.defaultPrevented ||
    eventLike?.metaKey ||
    eventLike?.ctrlKey ||
    eventLike?.altKey ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    target?.isContentEditable
  ) {
    return null;
  }

  switch ((eventLike?.key || '').toLowerCase()) {
    case '1':
      return { type: 'interval', value: '1m' };
    case '2':
      return { type: 'interval', value: '5m' };
    case '3':
      return { type: 'interval', value: '30m' };
    case '4':
      return { type: 'interval', value: '1h' };
    case '5':
      return { type: 'interval', value: '4h' };
    case '6':
      return { type: 'interval', value: '1d' };
    case 'a':
      return { type: 'focus', value: 'all' };
    case 'c':
      return { type: 'focus', value: 'basis' };
    case 'l':
      return { type: 'focus', value: 'leverage' };
    case 'f':
      return { type: 'focus', value: 'funding' };
    case 'j':
      return { type: 'replay', value: 'next' };
    case 'k':
      return { type: 'replay', value: 'prev' };
    case 'escape':
      return { type: 'live-reset' };
    default:
      return null;
  }
}
