// ============================================
// Mobile Navigation Toggle
// ============================================
const navToggle = document.getElementById("nav-toggle");
const navMenu = document.getElementById("nav-menu");

navToggle.addEventListener("click", () => {
  navMenu.classList.toggle("open");
  navToggle.classList.toggle("active");
});

// Close mobile menu when a link is clicked
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    navMenu.classList.remove("open");
    navToggle.classList.remove("active");
  });
});

// ============================================
// Navbar scroll effect
// ============================================
const navbar = document.getElementById("navbar");

window.addEventListener("scroll", () => {
  if (window.scrollY > 50) {
    navbar.classList.add("scrolled");
  } else {
    navbar.classList.remove("scrolled");
  }
});

// ============================================
// Active nav link on scroll
// ============================================
const sections = document.querySelectorAll("section[id]");

function setActiveNavLink() {
  const scrollY = window.scrollY + 100;

  sections.forEach((section) => {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    const sectionId = section.getAttribute("id");
    const navLink = document.querySelector(`.nav-link[href="#${sectionId}"]`);

    if (navLink && scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
      document.querySelectorAll(".nav-link").forEach((link) => link.classList.remove("active"));
      navLink.classList.add("active");
    }
  });
}

window.addEventListener("scroll", setActiveNavLink);

// ============================================
// Typing Animation
// ============================================
function initTypingAnimation() {
  const typedElement = document.getElementById("typed-text");
  if (!typedElement) return;

  const phrases = [
    "Salesforce Professional",
    "Developer",
    "Problem Solver",
    "Automation Builder",
  ];

  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let pauseEnd = 0;

  function type() {
    const currentPhrase = phrases[phraseIndex];
    const now = Date.now();

    if (now < pauseEnd) {
      requestAnimationFrame(type);
      return;
    }

    if (!isDeleting) {
      typedElement.textContent = currentPhrase.substring(0, charIndex + 1);
      charIndex++;

      if (charIndex === currentPhrase.length) {
        isDeleting = true;
        pauseEnd = now + 2000;
      }
    } else {
      typedElement.textContent = currentPhrase.substring(0, charIndex - 1);
      charIndex--;

      if (charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
      }
    }

    const speed = isDeleting ? 40 : 80;
    setTimeout(() => requestAnimationFrame(type), speed);
  }

  type();
}

initTypingAnimation();

// ============================================
// Back to Top Button
// ============================================
const backToTopBtn = document.getElementById("back-to-top");

window.addEventListener("scroll", () => {
  if (window.scrollY > 400) {
    backToTopBtn.classList.add("visible");
  } else {
    backToTopBtn.classList.remove("visible");
  }
});

backToTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ============================================
// Fade-in on scroll (Intersection Observer)
// ============================================
function initFadeInAnimations() {
  const fadeTargets = document.querySelectorAll(
    ".highlight-card, .sf-card, .project-card, .contact-item, .section-title, .section-subtitle, .skill-category"
  );

  fadeTargets.forEach((el) => el.classList.add("fade-in"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          // Add staggered delay for grid items
          const parent = entry.target.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((child) =>
              child.classList.contains("fade-in")
            );
            const index = siblings.indexOf(entry.target);
            entry.target.style.transitionDelay = `${index * 100}ms`;
          }

          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  fadeTargets.forEach((el) => observer.observe(el));
}

initFadeInAnimations();

// ============================================
// Konami Code Easter Egg
// ============================================
(function initKonamiCode() {
  const sequence = [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
    "b", "a",
  ];
  let position = 0;
  const overlay = document.getElementById("konami-overlay");
  if (!overlay) return;

  document.addEventListener("keydown", (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === sequence[position]) {
      position++;
      if (position === sequence.length) {
        overlay.classList.add("active");
        position = 0;
      }
    } else {
      position = 0;
    }
  });

  overlay.addEventListener("click", () => {
    overlay.classList.remove("active");
  });
})();
