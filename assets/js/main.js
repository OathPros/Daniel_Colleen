// Daniel & Colleen wedding site
// Lightweight helpers for the static GitHub Pages version.

document.documentElement.classList.add("js");

(function () {
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.getElementById("main-navigation");
  if (!menuButton || !navigation) return;

  function setMenuOpen(isOpen) {
    navigation.classList.toggle("is-open", isOpen);
    navigation.toggleAttribute("data-open", isOpen);
    menuButton.setAttribute("aria-expanded", String(isOpen));
  }

  menuButton.addEventListener("click", () => {
    setMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menuButton.getAttribute("aria-expanded") !== "true") return;
    setMenuOpen(false);
    menuButton.focus();
  });

  document.addEventListener("focusin", (event) => {
    if (!navigation.contains(event.target) && event.target !== menuButton) setMenuOpen(false);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!navigation.contains(event.target) && event.target !== menuButton) setMenuOpen(false);
  });
})();

(function () {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === current) {
      link.setAttribute('aria-current', 'page');
    }
  });
})();

(function () {
  const form = document.getElementById("rsvp-form");
  if (!form) return;

  const status = document.getElementById("rsvp-status");
  const search = document.getElementById("guest-search");
  const lookupButton = document.getElementById("load-party");
  const submitButton = document.getElementById("rsvp-submit");
  const partyNote = document.getElementById("party-note");
  const details = document.getElementById("rsvp-details");
  const responses = document.getElementById("invitee-responses");
  const partyInput = document.getElementById("selectedParty");
  let party = null;

  function setStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function turnstileToken() {
    return window.turnstile?.getResponse() || "";
  }

  function resetTurnstile() {
    window.turnstile?.reset();
  }

  function addOption(select, value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }

  function renderParty(found) {
    party = found;
    partyInput.value = found.publicId;
    responses.replaceChildren();
    partyNote.textContent = `Invitation found for ${found.partyName}.`;
    found.guests.forEach((guest) => {
      const saved = guest;
      const card = document.createElement("fieldset");
      card.className = "invitee-response";
      card.dataset.guestId = String(guest.id);
      const legend = document.createElement("legend");
      legend.textContent = guest.name;
      const attendance = document.createElement("div");
      attendance.className = "attendance-options";
      for (const [value, label] of [["yes", "Yes"], ["no", "No"]]) {
        const wrapper = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio"; radio.name = `attendance-${guest.id}`; radio.value = value; radio.required = true;
        radio.checked = saved.attending === value;
        wrapper.append(radio, document.createTextNode(label)); attendance.append(wrapper);
      }
      const dinnerRow = document.createElement("div"); dinnerRow.className = "form-row guest-dinner";
      const dinnerLabel = document.createElement("label"); dinnerLabel.htmlFor = `dinner-${guest.id}`; dinnerLabel.textContent = "Dinner";
      const dinner = document.createElement("select"); dinner.id = `dinner-${guest.id}`; dinner.dataset.field = "dinner";
      addOption(dinner, "", "Choose dinner"); addOption(dinner, "beef", "Beef"); addOption(dinner, "chicken", "Chicken"); addOption(dinner, "vegetarian", "Vegetarian");
      dinner.value = saved.dinnerChoice || ""; dinnerRow.append(dinnerLabel, dinner);
      const dietaryRow = document.createElement("div"); dietaryRow.className = "form-row";
      const dietaryLabel = document.createElement("label"); dietaryLabel.htmlFor = `dietary-${guest.id}`; dietaryLabel.textContent = "Dietary restrictions or allergies";
      const dietary = document.createElement("input"); dietary.id = `dietary-${guest.id}`; dietary.dataset.field = "dietary"; dietary.maxLength = 500; dietary.value = saved.dietaryRestrictions || "";
      dietaryRow.append(dietaryLabel, dietary); card.append(legend, attendance, dinnerRow, dietaryRow); responses.append(card);
      const updateDinner = () => { const yes = card.querySelector('input[type="radio"]:checked')?.value === "yes"; dinner.required = yes; dinner.disabled = !yes; if (!yes) dinner.value = ""; };
      attendance.addEventListener("change", updateDinner); updateDinner();
    });
    const saved = found.rsvp || {};
    for (const [id, key] of [["contactEmail", "contactEmail"], ["addressLine1", "addressLine1"], ["addressLine2", "addressLine2"], ["city", "city"], ["provinceState", "provinceState"], ["postalCode", "postalCode"], ["country", "country"], ["message", "message"]]) {
      document.getElementById(id).value = saved[key] || "";
    }
    details.hidden = false; submitButton.hidden = false;
  }

  async function post(path, body) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "We could not process that request.");
    return result;
  }

  async function lookup() {
    const name = search.value.trim();
    if (!name) { search.reportValidity(); return; }
    const token = turnstileToken();
    if (!token) { setStatus("Please complete the security check.", "error"); return; }
    lookupButton.disabled = true; setStatus("Looking for your invitation…", "pending");
    try {
      const result = await post("/api/rsvp/lookup", { name, website: form.website.value, turnstileToken: token });
      renderParty(result.party); setStatus("Please complete the RSVP below, then complete the refreshed security check.", "success");
    } catch (error) { setStatus(error.message, "error"); }
    finally { lookupButton.disabled = false; resetTurnstile(); }
  }

  lookupButton.addEventListener("click", lookup);
  search.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); lookup(); } });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!party) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const token = turnstileToken();
    if (!token) { setStatus("Please complete the security check again before submitting.", "error"); return; }
    const guests = [...responses.querySelectorAll(".invitee-response")].map((card) => ({
      id: Number(card.dataset.guestId),
      attending: card.querySelector('input[type="radio"]:checked')?.value,
      dinnerChoice: card.querySelector('[data-field="dinner"]').value || null,
      dietaryRestrictions: card.querySelector('[data-field="dietary"]').value
    }));
    const body = { partyId: partyInput.value, guests, turnstileToken: token, website: form.website.value };
    for (const key of ["contactEmail", "addressLine1", "addressLine2", "city", "provinceState", "postalCode", "country", "message"]) body[key] = form.elements[key].value;
    submitButton.disabled = true; setStatus("Saving your RSVP…", "pending");
    try { await post("/api/rsvp/submit", body); resetTurnstile(); setStatus("Thank you — your RSVP has been saved. You may look up your invitation again if you need to update it.", "success"); }
    catch (error) { setStatus(error.message, "error"); resetTurnstile(); }
    finally { submitButton.disabled = false; }
  });
})();

(function () {
  const gallery = document.querySelector("[data-gallery]");
  const lightbox = document.querySelector("[data-gallery-lightbox]");
  if (!gallery || !lightbox) return;

  const items = Array.from(gallery.querySelectorAll(".gallery-item"));
  const image = lightbox.querySelector(".gallery-lightbox__image");
  const caption = lightbox.querySelector("[data-gallery-caption]");
  const closeButton = lightbox.querySelector("[data-gallery-close]");
  const fullscreenButton = lightbox.querySelector("[data-gallery-fullscreen]");
  const prevButton = lightbox.querySelector("[data-gallery-prev]");
  const nextButton = lightbox.querySelector("[data-gallery-next]");
  let currentIndex = 0;
  let lastFocused = null;

  function showPhoto(index) {
    currentIndex = (index + items.length) % items.length;
    const item = items[currentIndex];
    const style = window.getComputedStyle(item);
    image.style.backgroundImage = style.backgroundImage;
    image.setAttribute("aria-label", item.getAttribute("aria-label")?.replace("Open photo: ", "") || "Gallery photo");
    caption.textContent = `${currentIndex + 1} / ${items.length}`;
  }

  function openLightbox(index) {
    lastFocused = document.activeElement;
    showPhoto(index);
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = "";
    if (document.fullscreenElement) document.exitFullscreen();
    lastFocused?.focus();
  }

  items.forEach((item, index) => {
    item.addEventListener("click", () => openLightbox(index));
  });

  closeButton.addEventListener("click", closeLightbox);
  prevButton.addEventListener("click", () => showPhoto(currentIndex - 1));
  nextButton.addEventListener("click", () => showPhoto(currentIndex + 1));
  fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      lightbox.requestFullscreen?.();
    }
  });

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") showPhoto(currentIndex - 1);
    if (event.key === "ArrowRight") showPhoto(currentIndex + 1);
  });
})();
