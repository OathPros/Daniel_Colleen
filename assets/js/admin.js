const login = document.querySelector("#login"), dashboard = document.querySelector("#dashboard");
const partiesRoot = document.querySelector("#parties"), status = document.querySelector("#status"), logout = document.querySelector("#logout");
const api = async (path, options = {}) => {
  const response = await fetch(`/api/admin/${path}`, { ...options, headers: options.body ? { "content-type": "application/json" } : undefined });
  const data = await response.json().catch(() => ({ message: "Unexpected server response." }));
  if (!response.ok) throw Object.assign(new Error(data.message || "Request failed."), { status: response.status });
  return data;
};
const button = (text, action, className = "button button-secondary") => {
  const element = document.createElement("button"); element.type = "button"; element.className = className; element.textContent = text; element.dataset.action = action; return element;
};
const render = parties => {
  partiesRoot.replaceChildren();
  if (!parties.length) { partiesRoot.textContent = "No invitations yet."; return; }
  parties.forEach(party => {
    const card = document.createElement("article"); card.className = "party-card"; card.dataset.party = party.id;
    const heading = document.createElement("div"); heading.className = "party-heading";
    const title = document.createElement("h2"); title.textContent = party.name; heading.append(title);
    const partyActions = document.createElement("div"); partyActions.className = "party-actions";
    partyActions.append(button("Edit party name", "rename-party"), button("Delete party", "delete-party", "button button-danger")); heading.append(partyActions); card.append(heading);
    const guestsTitle = document.createElement("h3"); guestsTitle.textContent = "Guests"; card.append(guestsTitle);
    const list = document.createElement("ol"); list.className = "guest-list";
    party.guests.forEach((guest, index) => {
      const item = document.createElement("li"); item.className = "guest-row"; item.dataset.guest = guest.id;
      const info = document.createElement("span"); info.textContent = guest.name;
      if (guest.response) { const response = document.createElement("small"); response.className = "guest-response"; response.textContent = guest.response.attending === "yes" ? `Attending · ${guest.response.dinner}` : "Not attending"; info.append(response); }
      const actions = document.createElement("span"); actions.className = "guest-actions";
      actions.append(button("Edit name", "rename-guest"));
      const up = button("Move up", "up"); up.disabled = index === 0; actions.append(up);
      const down = button("Move down", "down"); down.disabled = index === party.guests.length - 1; actions.append(down);
      actions.append(button("Remove", "remove-guest", "button button-danger")); item.append(info, actions); list.append(item);
    });
    card.append(list, button("Add guest", "add-guest"));
    const rsvp = document.createElement("p"); rsvp.innerHTML = `<strong>RSVP:</strong> ${party.submitted ? "Submitted" : "Not submitted"}`; card.append(rsvp); partiesRoot.append(card);
  });
};
async function refresh() { const data = await api("parties"); login.hidden = true; dashboard.hidden = false; logout.hidden = false; render(data.parties); }
const run = async work => { status.textContent = "Working…"; try { await work(); status.textContent = "Saved."; await refresh(); } catch (error) { status.textContent = error.message; if (error.status === 401) { login.hidden = false; dashboard.hidden = true; logout.hidden = true; } } };
login.addEventListener("submit", event => { event.preventDefault(); const data = Object.fromEntries(new FormData(login)); run(async () => { await api("login", { method: "POST", body: JSON.stringify(data) }); login.reset(); }); });
document.querySelector("#create-party").addEventListener("submit", event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); const guests = data.get("guests").split("\n").map(value => value.trim()).filter(Boolean); run(async () => { await api("parties", { method: "POST", body: JSON.stringify({ name: data.get("name"), guests }) }); form.reset(); }); });
logout.addEventListener("click", () => run(async () => { await api("logout", { method: "POST" }); location.reload(); }));
partiesRoot.addEventListener("click", event => {
  const target = event.target.closest("[data-action]"); if (!target) return;
  const card = target.closest("[data-party]"), partyId = Number(card.dataset.party), item = target.closest("[data-guest]");
  const action = target.dataset.action, guestId = Number(item?.dataset.guest);
  if (action === "rename-party") { const current = card.querySelector("h2").textContent, value = prompt("Party name", current); if (value != null) run(() => api(`parties/${partyId}`, { method: "PATCH", body: JSON.stringify({ name: value }) })); }
  if (action === "delete-party" && confirm("Delete this party?\n\nThis will permanently remove the invitation and any RSVP responses associated with it.")) run(() => api(`parties/${partyId}`, { method: "DELETE" }));
  if (action === "add-guest") { const value = prompt("Guest name"); if (value != null) run(() => api(`parties/${partyId}/guests`, { method: "POST", body: JSON.stringify({ name: value }) })); }
  if (action === "rename-guest") { const current = item.firstElementChild.firstChild.textContent, value = prompt("Guest name", current); if (value != null) run(() => api(`guests/${guestId}`, { method: "PATCH", body: JSON.stringify({ name: value }) })); }
  if (action === "remove-guest") { const guestName = item.firstElementChild.firstChild.textContent, answered = item.querySelector(".guest-response"); const warning = `Remove ${guestName} from this invitation?${answered ? "\n\nTheir attendance, meal, and dietary response will also be removed." : ""}`; if (confirm(warning)) run(() => api(`guests/${guestId}`, { method: "DELETE" })); }
  if (action === "up" || action === "down") { const ids = [...card.querySelectorAll("[data-guest]")].map(row => Number(row.dataset.guest)), index = ids.indexOf(guestId), other = action === "up" ? index - 1 : index + 1; [ids[index], ids[other]] = [ids[other], ids[index]]; run(() => api(`parties/${partyId}/guest-order`, { method: "PATCH", body: JSON.stringify({ guestIds: ids }) })); }
});
refresh().catch(error => { if (error.status !== 401) status.textContent = error.message; });
