// Daniel & Colleen wedding site
// Lightweight helpers for the static GitHub Pages version.

document.documentElement.classList.add("js");

// Keep old bookmarks working without leaving the implementation's .html suffix
// visible in the address bar. Internal navigation already uses clean URLs.
if (window.location.pathname.endsWith(".html")) {
  const cleanPath = window.location.pathname === "/index.html"
    ? "/"
    : window.location.pathname.slice(0, -5);
  window.history.replaceState(null, "", `${cleanPath}${window.location.search}${window.location.hash}`);
}

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
  const current = window.location.pathname.split('/').pop() || '';
  document.querySelectorAll('.nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === current) {
      link.setAttribute('aria-current', 'page');
    }
  });
})();

(function () {
  const hero = document.querySelector("[data-hero]");
  if (!hero) return;

  const images = window.WEDDING_IMAGE_MANIFEST?.collections?.["home/hero"];
  if (!Array.isArray(images) || images.length === 0) {
    // Temporary migration compatibility: keep the embedded legacy slideshow until
    // managed photography is placed in assets/images/home/hero.
    console.info("[images] No managed home/hero images; using the temporary legacy slideshow.");
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const firstLoader = new Image();
  firstLoader.fetchPriority = "high";
  firstLoader.src = images[0].src;

  function activateManagedHero() {
    const tint = hero.querySelector(".hero-tint");
    hero.replaceChildren();
    hero.dataset.heroMode = "managed";

    const slides = images.map((entry, index) => {
      const slide = document.createElement("div");
      slide.className = `slide managed-slide${index === 0 ? " is-active" : ""}`;
      slide.style.setProperty("--hero-position", entry.position || "center");
      slide.setAttribute("aria-hidden", "true");
      if (index === 0) slide.style.backgroundImage = `url("${entry.src}")`;
      hero.append(slide);
      return slide;
    });
    if (tint) hero.append(tint);

    if (images.length === 1 || reducedMotion) return;

    const progress = document.createElement("div");
    progress.className = "photo-progress";
    progress.setAttribute("aria-hidden", "true");
    const indicators = images.map(() => progress.appendChild(document.createElement("span")));
    indicators[0].classList.add("is-active");
    hero.append(progress);

    let current = 0;
    const load = (index) => {
      const slide = slides[index];
      if (slide.dataset.loaded) return;
      const loader = new Image();
      loader.decoding = "async";
      loader.onload = () => {
        slide.style.backgroundImage = `url("${images[index].src}")`;
        slide.dataset.loaded = "true";
      };
      loader.src = images[index].src;
    };
    slides[0].dataset.loaded = "true";
    load(1);
    window.setInterval(() => {
      const next = (current + 1) % slides.length;
      load(next);
      slides[current].classList.remove("is-active");
      indicators[current].classList.remove("is-active");
      slides[next].classList.add("is-active");
      indicators[next].classList.add("is-active");
      current = next;
      load((current + 1) % slides.length);
    }, 9000);
  }

  if (firstLoader.complete) activateManagedHero();
  else firstLoader.addEventListener("load", activateManagedHero, { once: true });
})();


(function () {
  const gallery = document.querySelector("[data-gallery]");
  const lightbox = document.querySelector("[data-gallery-lightbox]");
  if (!gallery || !lightbox) return;

  const managedImages = window.WEDDING_IMAGE_MANIFEST?.collections?.["home/moments"];
  if (Array.isArray(managedImages) && managedImages.length > 0) {
    gallery.replaceChildren(...managedImages.map((entry, index) => {
      const item = document.createElement("button");
      const description = entry.alt || entry.caption || `Daniel and Colleen memory ${index + 1}`;
      item.className = "gallery-item managed-gallery-item";
      item.type = "button";
      item.setAttribute("aria-label", `Open photo: ${description}`);
      item.style.backgroundImage = `url("${entry.src}")`;
      item.style.backgroundPosition = entry.position || "center";
      item.dataset.fullImage = entry.src;
      return item;
    }));
    gallery.dataset.galleryMode = "managed";
  }

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
    image.style.backgroundImage = item.dataset.fullImage
      ? `url("${item.dataset.fullImage}")`
      : window.getComputedStyle(item).backgroundImage;
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
