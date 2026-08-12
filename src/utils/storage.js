export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
