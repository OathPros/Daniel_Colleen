import { meaningfulQuery, matchesName, narrowsQuery } from "./rsvp-search.js";

const form = document.getElementById("rsvp-form");
const $ = id => document.getElementById(id);
const steps = [...form.querySelectorAll("[data-step]")];
const contactKeys = ["contactEmail", "addressLine1", "addressLine2", "city", "provinceState", "postalCode", "country", "message"];
const dinnerNames = { beef: "Beef", chicken: "Chicken", vegetarian: "Vegetarian" };
const guidance = "Try your name as it appears on your invitation, or contact Daniel or Colleen.";
let step = "search", party = null, busy = false, lookupVersion = 0;
let searchVersion = 0, searchTimer, searchAbort, names = [], activeOption = -1;
let rateUntil = 0, lockedControls = [];
const cache = new Map();
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
function status(message = "", state = "") {
  $("rsvp-status").textContent = message;
  $("rsvp-status").dataset.state = state;
}
function clearErrors() {
  $("rsvp-errors").hidden = true;
  $("rsvp-error-list").replaceChildren();
  form.querySelectorAll(".field-error").forEach(el => el.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach(el => {
    el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby");
  });
}
function focusAt(element) {
  const headerHeight = document.querySelector(".topbar")?.getBoundingClientRect().height || 0;
  element.style.scrollMarginTop = `${headerHeight + 20}px`;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "start", behavior: "instant" });
}
function showStep(next, focus = true) {
  step = next; clearErrors(); status();
  steps.forEach(section => { section.hidden = section.dataset.step !== next; });
  $("rsvp-workflow-header").hidden = next === "success";
  $("rsvp").classList.toggle("rsvp-success", next === "success");
  const index = ["confirm", "guests", "contact", "review"].indexOf(next);
  $("rsvp-progress").hidden = index < 0;
  $("rsvp-progress").textContent = index < 0 ? "" : `Step ${index + 1} of 4 · ${["Your invitation", "Your guests", "Contact details", "Review"][index]}`;
  if (focus) focusAt($(`${next}-title`));
}
function lock(value) {
  busy = value;
  // Keep the live status outside the busy region so progress is announced now.
  steps.forEach(section => section.setAttribute("aria-busy", String(value && section.dataset.step === step)));
  if (value) lockedControls = [...form.querySelectorAll("button, input, select, textarea")];
  lockedControls.forEach(el => {
    if (value) { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; }
    else { el.disabled = el.dataset.wasDisabled === "true"; delete el.dataset.wasDisabled; }
  });
  if (!value) lockedControls = [];
}
function clearParty() {
  party = null;
  $("invitee-responses").replaceChildren(); $("invitation-names").replaceChildren();
  $("review-guests").replaceChildren(); $("review-contact").replaceChildren();
  contactKeys.forEach(key => { $(key).value = ""; });
}
function terminal(next) {
  clearParty(); closeSuggestions(); cache.clear(); $("guest-search").value = "";
  showStep(next);
}
async function post(path, body, signal) {
  let response, result;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30000);
  const cancel = () => timeout.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    response = await fetch(`/api/rsvp/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, website: $("website").value }), signal: timeout.signal, cache: "no-store"
    });
    result = await response.json().catch(() => null);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Search replaced", "AbortError");
    if (timeout.signal.aborted) throw new Error("This is taking longer than expected. Please try again; your changes are still here.");
    throw new Error("We couldn't connect. Please try again; your changes are still here.");
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", cancel);
  }
  if (!response.ok || !result) {
    const error = new Error(result?.message || "We couldn't connect. Please try again; your changes are still here.");
    error.code = result?.code; error.fields = result?.fields;
    if (response.status === 429) rateUntil = Date.now() + 60000;
    throw error;
  }
  return result;
}

// One protected action at a time; a fresh widget gives each request its own token.
let scriptReady;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptReady) scriptReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => { clearTimeout(timer); script.remove(); scriptReady = null; reject(new Error("The security check couldn't load. Please check your connection or browser blocker, then try again.")); };
    const timer = setTimeout(fail, 15000);
    window.rsvpTurnstileReady = () => { clearTimeout(timer); resolve(); };
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=rsvpTurnstileReady";
    script.async = true; script.onerror = fail; document.head.append(script);
  });
  return scriptReady;
}
async function verifyAt(container) {
  status("Opening a quick security check…", "pending");
  await loadTurnstile();
  const widget = $("security-widget");
  $(container).append(widget); widget.hidden = false;
  return new Promise((resolve, reject) => {
    let widgetId, settled = false;
    const finish = (error, token) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (widgetId != null) window.turnstile.remove(widgetId);
      widget.hidden = true;
      error ? reject(new Error(error)) : resolve(token);
    };
    const timer = setTimeout(() => finish("The security check timed out. Please try again."), 120000);
    try {
      widgetId = window.turnstile.render(widget, {
        sitekey: widget.dataset.sitekey, theme: "light", appearance: "interaction-only", execution: "execute",
        size: window.innerWidth < 400 ? "compact" : "flexible", retry: "never", "refresh-expired": "manual",
        callback: token => finish(null, token),
        "error-callback": () => { finish("The security check couldn't finish. Please try again."); return true; },
        "expired-callback": () => finish("The security check expired. Please try again."),
        "timeout-callback": () => finish("The security check timed out. Please try again."),
        "before-interactive-callback": () => status("Please complete the check below. We'll continue automatically.", "pending")
      });
      window.turnstile.execute(widgetId);
    } catch { finish("The security check couldn't start. Please try again."); }
  });
}

function closeSuggestions() {
  $("guest-suggestions").hidden = true;
  $("guest-search").setAttribute("aria-expanded", "false");
  $("guest-search").removeAttribute("aria-activedescendant"); activeOption = -1;
}
function renderSuggestions(result) {
  names = result.names; activeOption = -1;
  const list = $("guest-suggestions"); list.replaceChildren();
  names.forEach((name, index) => {
    const option = node("li", name);
    option.id = `suggestion-${index}`; option.role = "option";
    option.setAttribute("aria-selected", "false");
    option.addEventListener("pointerdown", event => event.preventDefault());
    option.addEventListener("click", () => lookup(name)); list.append(option);
  });
  list.hidden = !names.length;
  $("guest-search").setAttribute("aria-expanded", String(names.length > 0));
  $("guest-search").removeAttribute("aria-activedescendant");
  $("search-help").textContent = result.hasMore ? "Keep typing to narrow your search." : names.length ? "Choose your name to find your invitation." : `No names found. ${guidance}`;
  status(names.length ? "Matching names are ready. Choose your name below." : `No names found. ${guidance}`);
}
async function suggestions(version, query) {
  if (version !== searchVersion || step !== "search" || busy) return;
  $("retry-search").hidden = true;
  const stored = cache.get(query) || [...cache].find(([key, result]) => !result.hasMore && narrowsQuery(key, query))?.[1];
  if (stored) { renderSuggestions({ names: stored.names.filter(name => matchesName(name, query)), hasMore: stored.hasMore }); return; }
  if (Date.now() < rateUntil) { status("Please wait a minute before trying again.", "error"); $("retry-search").hidden = false; return; }
  status("Looking for matching names…", "pending");
  searchAbort = new AbortController();
  try {
    const result = await post("suggest", { name: query }, searchAbort.signal);
    if (version !== searchVersion || step !== "search" || busy) return;
    cache.set(query, result);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    renderSuggestions(result);
  } catch (error) {
    if (version !== searchVersion || error.name === "AbortError") return;
    closeSuggestions(); status(error.message, "error"); $("retry-search").hidden = false;
  }
}
function searchChanged() {
  if (busy) return;
  clearTimeout(searchTimer); searchAbort?.abort(); ++searchVersion;
  closeSuggestions(); names = []; status(); $("retry-search").hidden = true;
  const query = $("guest-search").value.trim();
  if (!meaningfulQuery(query)) { $("search-help").textContent = "Enter at least two letters. You can also try your surname."; return; }
  const version = searchVersion;
  // Complete cached sets narrow immediately; network queries wait for typing.
  const cached = cache.has(query) || [...cache].some(([key, result]) => !result.hasMore && narrowsQuery(key, query));
  if (cached) suggestions(version, query);
  else searchTimer = setTimeout(() => suggestions(version, query), 375);
}
$("guest-search").addEventListener("input", searchChanged);
$("retry-search").addEventListener("click", () => suggestions(searchVersion, $("guest-search").value.trim()));
$("guest-search").addEventListener("keydown", event => {
  if (event.key === "Escape") { closeSuggestions(); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!$("guest-suggestions").hidden && activeOption >= 0) lookup(names[activeOption]);
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key) || !names.length || busy) return;
  event.preventDefault();
  $("guest-suggestions").hidden = false; $("guest-search").setAttribute("aria-expanded", "true");
  activeOption = (activeOption + (event.key === "ArrowDown" ? 1 : activeOption < 0 ? 0 : -1) + names.length) % names.length;
  [...$("guest-suggestions").children].forEach((option, index) => option.setAttribute("aria-selected", String(index === activeOption)));
  const option = $(`suggestion-${activeOption}`);
  $("guest-search").setAttribute("aria-activedescendant", option.id); option.scrollIntoView({ block: "nearest" });
});
$("guest-search").addEventListener("blur", () => closeSuggestions());

async function lookup(name) {
  if (busy || step !== "search") return;
  const version = ++lookupVersion;
  ++searchVersion; clearTimeout(searchTimer); searchAbort?.abort(); closeSuggestions(); clearParty();
  $("guest-search").value = name; $("retry-search").hidden = true; lock(true);
  try {
    const turnstileToken = await verifyAt("lookup-security");
    status("Opening your invitation…", "pending");
    const result = await post("lookup", { name, turnstileToken });
    if (version !== lookupVersion) return;
    if (result.state === "already_submitted") { terminal("closed"); return; }
    if (result.state !== "unanswered" || !result.party?.guests?.length) throw new Error("We couldn't open that invitation. Please try again.");
    party = result.party; renderParty(); showStep("confirm");
  } catch (error) {
    if (version !== lookupVersion) return;
    clearParty(); showStep("search"); status(error.message, "error");
    // Retry keeps explicit selection, including after a challenge/network failure.
    renderSuggestions({ names: [name], hasMore: false }); status(error.message, "error");
  } finally { lock(false); }
}

function renderParty() {
  party.guests.forEach(guest => {
    $("invitation-names").append(node("li", guest.name));
    const card = node("section", null, "invitee-response"); card.dataset.guestId = guest.id;
    card.setAttribute("role", "group");
    const guestName = node("h3", guest.name, "invitee-name"); guestName.id = `invitee-name-${guest.id}`;
    card.setAttribute("aria-labelledby", guestName.id); card.append(guestName);
    const question = node("p", "Are you able to attend our wedding?", "attendance-question");
    question.id = `attendance-question-${guest.id}`; card.append(question);
    const attendance = node("div", null, "attendance-options");
    attendance.setAttribute("role", "group"); attendance.setAttribute("aria-labelledby", question.id);
    for (const [value, text] of [["yes", "Yes, gladly"], ["no", "No, with regrets"]]) {
      const label = node("label"), radio = node("input"); radio.type = "radio";
      radio.name = `attendance-${guest.id}`; radio.id = value === "yes" ? radio.name : `${radio.name}-no`;
      radio.value = value; radio.required = true;
      label.append(radio, node("span", text)); attendance.append(label);
    }
    card.append(attendance);
    const meal = node("div", null, "guest-meal"); meal.hidden = true;
    const dinner = node("select"); dinner.id = `dinner-${guest.id}`; dinner.disabled = true;
    for (const [value, text] of [["", "Choose a dinner"], ...Object.entries(dinnerNames)]) {
      const option = node("option", text); option.value = value; dinner.append(option);
    }
    const dietary = node("input"); dietary.id = `dietary-${guest.id}`; dietary.maxLength = 500; dietary.disabled = true;
    for (const [input, title] of [[dinner, "Select your meal preference"], [dietary, "Any dietary restrictions or allergies? (optional)"]]) {
      const row = node("div", null, "form-row"), label = node("label", title); label.htmlFor = input.id;
      row.append(label, input); meal.append(row);
    }
    attendance.addEventListener("change", () => {
      const yes = card.querySelector("input:checked")?.value === "yes";
      meal.hidden = !yes; dinner.disabled = !yes; dietary.disabled = !yes; dinner.required = yes;
      clearErrors(); updateCount();
    });
    card.append(meal); $("invitee-responses").append(card);
  });
  updateCount();
}
function updateCount() {
  const answered = $("invitee-responses").querySelectorAll('input[type="radio"]:checked').length;
  $("answered-count").textContent = party.guests.length > 1 ? `${answered} of ${party.guests.length} guests answered` : "";
}
function draft() {
  return { partyId: party.publicId, ...Object.fromEntries(contactKeys.map(key => [key, $(key).value.trim()])),
    guests: party.guests.map(guest => {
      const attending = form.querySelector(`input[name="attendance-${guest.id}"]:checked`)?.value;
      return { id: guest.id, attending, ...(attending === "yes" ? {
        dinnerChoice: $(`dinner-${guest.id}`).value, dietaryRestrictions: $(`dietary-${guest.id}`).value.trim()
      } : {}) };
    }) };
}
function errorsFor(which) {
  const errors = {};
  if (which === "guests") party.guests.forEach(guest => {
    const attending = form.querySelector(`input[name="attendance-${guest.id}"]:checked`)?.value;
    if (!attending) errors[`attendance-${guest.id}`] = `Choose Yes or No for ${guest.name}.`;
    if (attending === "yes" && !$(`dinner-${guest.id}`).value) errors[`dinner-${guest.id}`] = `Choose dinner for ${guest.name}.`;
    if (attending === "yes" && $(`dietary-${guest.id}`).value.length > 500) errors[`dietary-${guest.id}`] = "Please use 500 characters or fewer.";
  });
  if (which === "contact") contactKeys.forEach(key => {
    const input = $(key), label = input.labels[0].textContent;
    if (input.required && !input.value.trim()) errors[key] = key === "contactEmail" ? "Please enter the best email to reach you." : `Please enter ${label.toLowerCase()}.`;
    else if (input.value.length > input.maxLength) errors[key] = `Please use ${input.maxLength} characters or fewer.`;
    else if (key === "contactEmail" && (!input.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim()))) errors[key] = "Please enter a valid email address.";
  });
  return errors;
}
function showErrors(errors) {
  clearErrors();
  Object.entries(errors).forEach(([id, message]) => {
    const input = $(id); if (!input) return;
    const error = node("p", message, "field-error"); error.id = `error-${id}`;
    const controls = input.type === "radio" ? [...form.querySelectorAll(`input[name="${input.name}"]`)] : [input];
    controls.forEach(control => { control.setAttribute("aria-invalid", "true"); control.setAttribute("aria-describedby", error.id); });
    (input.type === "radio" ? input.closest(".attendance-options") : input).after(error);
    const link = node("a", message); link.href = `#${id}`;
    link.addEventListener("click", event => { event.preventDefault(); focusAt(input); });
    const item = node("li"); item.append(link); $("rsvp-error-list").append(item);
  });
  $("rsvp-errors").hidden = false; focusAt($("rsvp-errors"));
}
function validate(which) {
  const errors = errorsFor(which);
  if (!Object.keys(errors).length) { clearErrors(); return true; }
  if (step !== which) showStep(which, false);
  showErrors(errors); return false;
}
function review() {
  const data = draft(); $("review-guests").replaceChildren(); $("review-contact").replaceChildren();
  data.guests.forEach((guest, index) => {
    const card = node("div", null, "rsvp-review-card"); card.append(node("h4", party.guests[index].name));
    card.append(node("p", guest.attending === "yes" ? `Attending · ${dinnerNames[guest.dinnerChoice]}` : "Unable to attend"));
    if (guest.dietaryRestrictions) card.append(node("p", `Dietary restrictions / allergies: ${guest.dietaryRestrictions}`));
    $("review-guests").append(card);
  });
  $("review-contact").append(node("p", data.contactEmail), node("p", [data.addressLine1, data.addressLine2, data.city,
    data.provinceState, data.postalCode, data.country].filter(Boolean).join("\n"), "rsvp-address"));
  if (data.message) $("review-contact").append(node("p", `Your note: ${data.message}`));
  showStep("review");
}
form.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => {
  if (!busy && party) showStep(button.dataset.go);
}));
$("search-again").addEventListener("click", () => {
  if (busy) return;
  ++lookupVersion; clearParty(); $("guest-search").value = ""; names = []; closeSuggestions(); showStep("search");
});
$("guests-continue").addEventListener("click", () => { if (!busy && party && validate("guests")) showStep("contact"); });
$("contact-continue").addEventListener("click", () => { if (!busy && party && validate("contact")) review(); });
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !party || step !== "review" || !validate("guests") || !validate("contact")) return;
  const body = draft(); // Snapshot before locking; retries take a fresh snapshot.
  lock(true);
  try {
    const turnstileToken = await verifyAt("submit-security");
    status("Saving your RSVP…", "pending");
    const result = await post("submit", { ...body, turnstileToken });
    if (result.state !== "submitted") throw new Error("We couldn't confirm that your RSVP was saved. Please try again.");
    terminal("success");
  } catch (error) {
    if (error.code === "already_submitted") terminal("closed");
    else if (error.fields && Object.keys(error.fields).some(key => $(key))) {
      const target = Object.keys(error.fields).some(key => /^(attendance|dinner|dietary)-/.test(key)) ? "guests" : "contact";
      showStep(target, false); showErrors(error.fields);
    } else status(error.message, "error");
  } finally { lock(false); }
});
// bfcache must not restore an old editable response or sensitive draft.
window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
showStep("search", false);
