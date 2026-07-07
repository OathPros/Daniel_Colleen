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
  const guestOptions = document.getElementById("guest-options");
  const loadPartyButton = document.getElementById("load-party");
  const partyNote = document.getElementById("party-note");
  const inviteeTabs = document.getElementById("invitee-tabs");
  const inviteeFields = document.getElementById("invitee-fields");
  const selectedInviteesInput = document.getElementById("selectedInvitees");
  const selectedPartyInput = document.getElementById("selectedParty");
  const preview = document.getElementById("rsvp-preview");
  const previewList = document.getElementById("rsvp-preview-list");
  const editButton = document.getElementById("edit-rsvp");
  const confirmButton = document.getElementById("confirm-rsvp");
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

  function safeId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function getAvailableParties() {
    const submitted = new Set(getSubmittedParties());
    return rsvpParties.filter((party) => !submitted.has(party.id));
  }

  function renderGuestOptions() {
    guestOptions.replaceChildren();
    getAvailableParties().forEach((party) => {
      party.members.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.label = `${name} — party of ${party.members.length}`;
        guestOptions.append(option);
      });
    });
  }

  function findPartyByGuest(name) {
    const normalized = name.trim().toLowerCase();
    return getAvailableParties().find((party) => party.members.some((member) => member.toLowerCase() === normalized));
  }

  function updateSelectedInvitees() {
    selectedInviteesInput.value = selectedInvitees.join(", ");
    selectedPartyInput.value = selectedPartyId;
  }

  function activateInvitee(name) {
    inviteeTabs.querySelectorAll(".invitee-tab").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.invitee === name));
    });
    inviteeFields.querySelectorAll(".invitee-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.invitee === name);
    });
  }

  function clearParty() {
    selectedInvitees.splice(0, selectedInvitees.length);
    selectedPartyId = "";
    inviteeTabs.replaceChildren();
    inviteeFields.replaceChildren();
    partyNote.textContent = "";
    preview.hidden = true;
    updateSelectedInvitees();
  }

  function addInvitee(name) {
    selectedInvitees.push(name);
    const id = safeId(name);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `tab-${id}`;
    tab.className = "invitee-tab";
    tab.dataset.invitee = name;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `panel-${id}`);
    tab.textContent = name;
    tab.addEventListener("click", () => activateInvitee(name));

    const card = document.createElement("section");
    card.id = `panel-${id}`;
    card.className = "invitee-card";
    card.dataset.invitee = name;
    card.setAttribute("role", "tabpanel");
    card.setAttribute("aria-labelledby", `tab-${id}`);
    card.innerHTML = `
      <div class="invitee-card-header"><h3>${escapeHtml(name)}</h3></div>
      <div class="form-grid">
        <div class="form-row">
          <label for="attendance-${id}">Will ${escapeHtml(name)} attend?</label>
          <select id="attendance-${id}" name="invitees[${escapeHtml(name)}][attendance]" required>
            <option value="">Select one</option><option value="yes">Yes, will attend</option><option value="no">No, cannot attend</option>
          </select>
        </div>
        <div class="form-row"><label for="meal-${id}">Meal preference</label><input id="meal-${id}" name="invitees[${escapeHtml(name)}][meal]" type="text" maxlength="120" placeholder="Optional" /></div>
        <div class="form-row"><label for="dietary-${id}">Dietary notes</label><textarea id="dietary-${id}" name="invitees[${escapeHtml(name)}][dietary]" rows="3" maxlength="500" placeholder="Optional. Please include allergies or dietary restrictions."></textarea></div>
        <div class="form-row"><label for="song-${id}">Song request</label><input id="song-${id}" name="invitees[${escapeHtml(name)}][song]" type="text" maxlength="160" placeholder="Optional" /></div>
        <div class="form-row form-row-full"><label for="message-${id}">Message</label><textarea id="message-${id}" name="invitees[${escapeHtml(name)}][message]" rows="4" maxlength="800" placeholder="Optional"></textarea></div>
      </div>`;
    inviteeTabs.append(tab);
    inviteeFields.append(card);
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
    party.members.forEach(addInvitee);
    partyNote.textContent = `Loaded ${party.members.length} guest${party.members.length === 1 ? "" : "s"}: ${party.members.join(", ")}.`;
    guestSearch.value = "";
    updateSelectedInvitees();
    activateInvitee(party.members[0]);
    setStatus("", "");
  }

  function collectGuestChoices() {
    return selectedInvitees.map((name) => {
      const id = safeId(name);
      const attendanceValue = document.getElementById(`attendance-${id}`).value;
      return {
        name,
        attendance: attendanceValue === "yes" ? "Yes, will attend" : "No, cannot attend",
        meal: document.getElementById(`meal-${id}`).value || "—",
        dietary: document.getElementById(`dietary-${id}`).value || "—",
        song: document.getElementById(`song-${id}`).value || "—",
        message: document.getElementById(`message-${id}`).value || "—"
      };
    });
  }

  function showPreview() {
    previewList.innerHTML = collectGuestChoices().map((guest) => `
      <article class="rsvp-preview-card">
        <h3>${escapeHtml(guest.name)}</h3>
        <dl>
          <div><dt>Attending</dt><dd>${escapeHtml(guest.attendance)}</dd></div>
          <div><dt>Meal</dt><dd>${escapeHtml(guest.meal)}</dd></div>
          <div><dt>Dietary notes</dt><dd>${escapeHtml(guest.dietary)}</dd></div>
          <div><dt>Song request</dt><dd>${escapeHtml(guest.song)}</dd></div>
          <div><dt>Message</dt><dd>${escapeHtml(guest.message)}</dd></div>
        </dl>
      </article>`).join("");
    preview.hidden = false;
    preview.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  loadPartyButton.addEventListener("click", loadParty);
  guestSearch.addEventListener("change", () => { if (guestSearch.value) loadParty(); });
  editButton.addEventListener("click", () => { preview.hidden = true; inviteeFields.scrollIntoView({ behavior: "smooth", block: "start" }); });

  renderGuestOptions();
  updateSelectedInvitees();

  form.addEventListener("submit", function (event) {
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
    setStatus("", "");
    showPreview();
  });

  confirmButton.addEventListener("click", async function () {
    submittedAtClient.value = new Date().toISOString();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.selectedInvitees = selectedInvitees;
    payload.selectedParty = selectedPartyId;
    payload.inviteeChoices = collectGuestChoices();

    submitButton.disabled = true;
    confirmButton.disabled = true;
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
      confirmButton.disabled = false;
    }
  });
})();
