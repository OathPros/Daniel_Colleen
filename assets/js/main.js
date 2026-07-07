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

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || "";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    submittedAtClient.value = new Date().toISOString();

    const payload = Object.fromEntries(new FormData(form).entries());

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
