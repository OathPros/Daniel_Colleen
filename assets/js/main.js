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
