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
<<<<<<< HEAD
// Konami Code Easter Egg: Matrix Rain
// ============================================
(function initKonamiCode() {
  const konamiSequence = [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
    "KeyB", "KeyA", "Enter",
  ];
  let konamiIndex = 0;
  let matrixActive = false;
  let matrixRainId = null;

  document.addEventListener("keydown", function (e) {
    const expected = konamiSequence[konamiIndex];
    if (e.code === expected || e.key === expected) {
      konamiIndex++;
      if (konamiIndex === konamiSequence.length) {
        konamiIndex = 0;
        matrixActive ? stopMatrixRain() : startMatrixRain();
        matrixActive = !matrixActive;
      }
    } else {
      konamiIndex = 0;
    }
  });

  function startMatrixRain() {
    const canvas = document.getElementById("matrixCanvas");
    if (!canvas || matrixRainId) return;
    document.body.classList.add("matrix-active");
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    const ctx = canvas.getContext("2d");

    const chars =
      "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:・.\"=*+-<>¦|";
    const charArr = Array.from(chars);
    const fontSize = 14;
    let columns, drops;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      columns = Math.floor(canvas.width / fontSize);
      const oldDrops = drops || [];
      drops = [];
      for (let i = 0; i < columns; i++) {
        drops[i] = oldDrops[i] !== undefined ? oldDrops[i] : Math.random() * -100;
      }
    }
    resize();
    window._matrixResize = resize;
    window.addEventListener("resize", window._matrixResize);

    let frameCount = 0;
    function draw() {
      frameCount++;
      if (frameCount % 2 !== 0) {
        matrixRainId = requestAnimationFrame(draw);
        return;
      }
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = fontSize + "px Courier New";

      for (let i = 0; i < columns; i++) {
        const ch = charArr[Math.floor(Math.random() * charArr.length)];
        const y = drops[i] * fontSize;

        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(0,255,65,0.6)";
        ctx.fillStyle = "#aaffaa";
        ctx.fillText(ch, i * fontSize, y);

        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0,255,65,0.8)";
        const ch2 = charArr[Math.floor(Math.random() * charArr.length)];
        if (y - fontSize > 0) ctx.fillText(ch2, i * fontSize, y - fontSize);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      matrixRainId = requestAnimationFrame(draw);
    }
    matrixRainId = requestAnimationFrame(draw);
  }

  function stopMatrixRain() {
    if (matrixRainId) {
      cancelAnimationFrame(matrixRainId);
      matrixRainId = null;
    }
    document.body.classList.remove("matrix-active");
    const canvas = document.getElementById("matrixCanvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = "none";
    }
    if (window._matrixResize) {
      window.removeEventListener("resize", window._matrixResize);
      delete window._matrixResize;
    }
  }
=======
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
>>>>>>> 990bbcd1d2e533586c747c41aecdb63a02902986
})();
