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

  const status = document.getElementById("rsvp-status");
  const submitButton = document.getElementById("rsvp-submit");
  const submittedAtClient = document.getElementById("submittedAtClient");
  const inviteeSelect = document.getElementById("invitee-select");
  const addInviteeButton = document.getElementById("add-invitee");
  const inviteeTabs = document.getElementById("invitee-tabs");
  const inviteeFields = document.getElementById("invitee-fields");
  const selectedInviteesInput = document.getElementById("selectedInvitees");
  const selectedInvitees = [];

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || "";
  }

  function safeId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function updateSelectedInvitees() {
    selectedInviteesInput.value = selectedInvitees.join(", ");
  }

  function activateInvitee(name) {
    inviteeTabs.querySelectorAll(".invitee-tab").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.invitee === name));
    });

    inviteeFields.querySelectorAll(".invitee-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.invitee === name);
    });
  }

  function removeInvitee(name) {
    const index = selectedInvitees.indexOf(name);
    if (index !== -1) selectedInvitees.splice(index, 1);

    inviteeTabs.querySelector(`[data-invitee="${CSS.escape(name)}"]`)?.remove();
    inviteeFields.querySelector(`[data-invitee="${CSS.escape(name)}"]`)?.remove();

    const option = Array.from(inviteeSelect.options).find((item) => item.value === name);
    if (option) option.hidden = false;

    updateSelectedInvitees();
    if (selectedInvitees.length) activateInvitee(selectedInvitees[Math.max(0, index - 1)]);
  }

  function addInvitee(name) {
    if (!name || selectedInvitees.includes(name)) return;

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
      <div class="invitee-card-header">
        <h3>${name}</h3>
        <button type="button" class="remove-invitee" data-remove-invitee="${name}">Remove</button>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label for="attendance-${id}">Will ${name} attend?</label>
          <select id="attendance-${id}" name="invitees[${name}][attendance]" required>
            <option value="">Select one</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div class="form-row">
          <label for="dietary-${id}">Dietary notes</label>
          <textarea id="dietary-${id}" name="invitees[${name}][dietary]" rows="3" maxlength="500" placeholder="Optional. Please include allergies or dietary restrictions."></textarea>
        </div>
        <div class="form-row">
          <label for="song-${id}">Song request</label>
          <input id="song-${id}" name="invitees[${name}][song]" type="text" maxlength="160" placeholder="Optional" />
        </div>
        <div class="form-row">
          <label for="message-${id}">Message</label>
          <textarea id="message-${id}" name="invitees[${name}][message]" rows="4" maxlength="800" placeholder="Optional"></textarea>
        </div>
      </div>
    `;

    card.querySelector(".remove-invitee").addEventListener("click", () => removeInvitee(name));
    inviteeTabs.append(tab);
    inviteeFields.append(card);

    const option = Array.from(inviteeSelect.options).find((item) => item.value === name);
    if (option) option.hidden = true;
    inviteeSelect.value = "";

    updateSelectedInvitees();
    activateInvitee(name);
  }

  addInviteeButton.addEventListener("click", () => {
    addInvitee(inviteeSelect.value);
  });

  inviteeSelect.addEventListener("change", () => {
    if (inviteeSelect.value) addInvitee(inviteeSelect.value);
  });

  updateSelectedInvitees();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    updateSelectedInvitees();

    if (!selectedInvitees.length) {
      setStatus("Please add at least one invited guest before submitting.", "error");
      inviteeSelect.focus();
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const summary = selectedInvitees.map((name) => {
      const id = safeId(name);
      const attendance = document.getElementById(`attendance-${id}`).value;
      return `${name}: ${attendance === "yes" ? "attending" : "not attending"}`;
    }).join("\n");

    if (!window.confirm(`Please confirm your RSVP selections:\n\n${summary}\n\nSubmit this RSVP?`)) {
      return;
    }

    submittedAtClient.value = new Date().toISOString();

    const payload = Object.fromEntries(new FormData(form).entries());
    payload.selectedInvitees = selectedInvitees;

    submitButton.disabled = true;
    setStatus("Submitting your RSVP...", "pending");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "The RSVP could not be submitted.");
      }

      form.reset();
      selectedInvitees.splice(0, selectedInvitees.length);
      inviteeTabs.replaceChildren();
      inviteeFields.replaceChildren();
      Array.from(inviteeSelect.options).forEach((option) => { option.hidden = false; });
      updateSelectedInvitees();
      setStatus("Thank you — your RSVP has been received.", "success");
    } catch (error) {
      console.error(error);
      setStatus(
        "Sorry, the RSVP could not be submitted. Please try again or contact us directly.",
        "error"
      );
    } finally {
      submitButton.disabled = false;
    }
  });
})();
