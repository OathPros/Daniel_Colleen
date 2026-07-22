// Daniel & Colleen wedding site
// Lightweight helpers for the static GitHub Pages version.

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

  const endpoint = "https://YOUR-WORKER-SUBDOMAIN.workers.dev/rsvp";
  const submittedPartiesKey = "daniel-colleen-submitted-rsvp-parties";

  const rsvpParties = [
    { id: "darrow-mustang", members: ["Darrow O'Lykos", "Virginia au Augustus"] },
    { id: "sevro-victra", members: ["Sevro au Barca", "Victra au Julii"] },
    { id: "cassius-lysander", members: ["Cassius au Bellona", "Lysander au Lune"] },
    { id: "eo-ragnar", members: ["Eo of Lykos", "Ragnar Volarus"] },
    { id: "holiday-trigg", members: ["Holiday ti Nakamura", "Trigg ti Nakamura"] },
    { id: "quicksilver-matteo", members: ["Quicksilver", "Matteo"] },
    { id: "roque-tactus", members: ["Roque au Fabii", "Tactus au Rath"] },
    { id: "lorn-arcos", members: ["Lorn au Arcos", "Aja au Grimmus"] },
    { id: "kavax-daxo", members: ["Kavax au Telemanus", "Daxo au Telemanus"] },
    { id: "pax-sophocles", members: ["Pax au Telemanus", "Sophocles"] },
    { id: "fitchner-orion", members: ["Fitchner au Barca", "Orion xe Aquarii"] },
    { id: "theodora-alexandar", members: ["Theodora", "Alexandar au Arcos"] },
    { id: "samwise-rosie", members: ["Samwise Gamgee", "Rosie Cotton"] },
    { id: "frodo-bilbo", members: ["Frodo Baggins", "Bilbo Baggins"] },
    { id: "aragorn-arwen", members: ["Aragorn", "Arwen Undómiel"] },
    { id: "faramir-eowyn", members: ["Faramir", "Éowyn"] },
    { id: "merry-pippin", members: ["Meriadoc Brandybuck", "Peregrin Took"] },
    { id: "legolas-gimli", members: ["Legolas Greenleaf", "Gimli son of Glóin"] },
    { id: "gandalf-galadriel", members: ["Gandalf the Grey", "Galadriel"] },
    { id: "elrond-celeborn", members: ["Elrond", "Celeborn"] },
    { id: "theoden-eomer", members: ["Théoden", "Éomer"] },
    { id: "boromir-denethor", members: ["Boromir", "Denethor II"] },
    { id: "isildur-elendil", members: ["Isildur", "Elendil"] },
    { id: "treebeard-radagast", members: ["Treebeard", "Radagast the Brown"] },
    { id: "bryce-hunt", members: ["Bryce Quinlan", "Hunt Athalar"] },
    { id: "rhysand-feyre", members: ["Rhysand", "Feyre Archeron"] },
    { id: "kaz-inej", members: ["Kaz Brekker", "Inej Ghafa"] },
    { id: "alina-mal", members: ["Alina Starkov", "Malyen Oretsev"] },
    { id: "elizabeth-darcy", members: ["Elizabeth Bennet", "Fitzwilliam Darcy"] },
    { id: "hermione-ron", members: ["Hermione Granger", "Ron Weasley"] }
  ];

  const status = document.getElementById("rsvp-status");
  const submitButton = document.getElementById("rsvp-submit");
  const submittedAtClient = document.getElementById("submittedAtClient");
  const guestSearch = document.getElementById("guest-search");
  const loadPartyButton = document.getElementById("load-party");
  const partyNote = document.getElementById("party-note");
  const selectedInviteesInput = document.getElementById("selectedInvitees");
  const selectedPartyInput = document.getElementById("selectedParty");
  const selectedInvitees = [];
  let selectedPartyId = "";

  function getSubmittedParties() {
    try { return JSON.parse(window.localStorage.getItem(submittedPartiesKey)) || []; }
    catch { return []; }
  }

  function saveSubmittedParty(partyId) {
    const parties = new Set(getSubmittedParties());
    parties.add(partyId);
    window.localStorage.setItem(submittedPartiesKey, JSON.stringify([...parties]));
  }

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || "";
  }

  function getAvailableParties() {
    const submitted = new Set(getSubmittedParties());
    return rsvpParties.filter((party) => !submitted.has(party.id));
  }

  function renderGuestOptions() {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a guest name";

    guestSearch.replaceChildren(placeholder);
    getAvailableParties().forEach((party) => {
      party.members.forEach((name) => {
        const option = document.createElement("option");
        option.value = party.id;
        option.textContent = `${name} — party of ${party.members.length}`;
        guestSearch.append(option);
      });
    });
  }

  function findPartyByGuest(partyId) {
    return getAvailableParties().find((party) => party.id === partyId);
  }

  function updateSelectedInvitees() {
    selectedInviteesInput.value = selectedInvitees.join(", ");
    selectedPartyInput.value = selectedPartyId;
  }

  function clearParty() {
    selectedInvitees.splice(0, selectedInvitees.length);
    selectedPartyId = "";
    partyNote.textContent = "";
    updateSelectedInvitees();
  }

  function loadParty() {
    const party = findPartyByGuest(guestSearch.value);
    if (!party) {
      setStatus("Please choose a name from the approved RSVP list.", "error");
      guestSearch.focus();
      return;
    }
    clearParty();
    selectedPartyId = party.id;
    selectedInvitees.push(...party.members);
    partyNote.textContent = `Loaded ${party.members.length} guest${party.members.length === 1 ? "" : "s"}: ${party.members.join(", ")}.`;
    guestSearch.value = "";
    updateSelectedInvitees();
    setStatus("", "");
  }

  loadPartyButton.addEventListener("click", loadParty);
  guestSearch.addEventListener("change", () => { if (guestSearch.value) loadParty(); });
  renderGuestOptions();
  updateSelectedInvitees();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    updateSelectedInvitees();
    if (!selectedInvitees.length) {
      setStatus("Please choose a guest from the approved RSVP list before submitting.", "error");
      guestSearch.focus();
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    submittedAtClient.value = new Date().toISOString();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.selectedInvitees = selectedInvitees;
    payload.selectedParty = selectedPartyId;

    submitButton.disabled = true;
    setStatus("Submitting your RSVP...", "pending");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "The RSVP could not be submitted.");

      if (selectedPartyId) saveSubmittedParty(selectedPartyId);
      form.reset();
      clearParty();
      renderGuestOptions();
      setStatus("Thank you — your RSVP has been received. This party has been removed from the RSVP list on this device.", "success");
    } catch (error) {
      console.error(error);
      setStatus("Sorry, the RSVP could not be submitted. Please try again or contact us directly.", "error");
    } finally {
      submitButton.disabled = false;
    }
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
