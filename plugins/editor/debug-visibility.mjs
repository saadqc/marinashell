// Keep a user's preference separate from a temporary reveal for a new stop.
export function createDebugVisibility(collapsed = false) {
  let preference = Boolean(collapsed);
  let dismissed = '';
  let stop = '';
  return {
    preference: () => preference,
    updatePreference(value) { preference = Boolean(value); },
    updateStop(value) { stop = value || ''; },
    expanded: () => !preference || Boolean(stop && stop !== dismissed),
    toggle() {
      const expanded = !preference || Boolean(stop && stop !== dismissed);
      preference = expanded;
      dismissed = expanded ? stop : '';
      return preference;
    }
  };
}
