

export function resolvePage(value) {
  return ["home", "pinnacle", "crown", "my-events", "merge", "settings"].includes(value) ? value : "home";
}
