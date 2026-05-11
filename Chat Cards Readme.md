# Chat Cards — Project Summary

---

## Website Blurb

**Chat Cards** is an interactive digital conversation game built to help parents move past "how was your day?" and into real, meaningful dialogue with their kids. It presents 100 shuffled, age-appropriate prompts across 9 categories — from imaginative scenarios and silly hypotheticals to questions about feelings, kindness, and future dreams — designed to work equally well with a 6-year-old and a 10-year-old. The interface is fully self-contained as a single React artifact with randomized card-draw animations, category filtering, and a clean dark UI that kids actually want to interact with. Built entirely in a Claude conversation as a zero-dependency React component — no build tools, no backend, no setup required.

[**Try it live →**](https://claude.ai/public/artifacts/352a5098-ba40-40a6-a138-cc5a7fb32589)

---

## Detailed Breakdown

### What It Is
- A single-file interactive React card game designed for parent-child conversation time
- 100 open-ended, age-appropriate questions spanning 9 categories
- Built as a Claude artifact — runs entirely in-browser with no external dependencies

### The Problem It Solves
- Generic daily check-ins ("how was school?") produce one-word answers and missed connection opportunities
- Parents need structured but natural prompts that meet kids where they are developmentally
- Questions are calibrated for a mixed-age household (6 and 10), accessible to the younger child while still engaging for the older one

### Categories (9)
- ✨ **Imagine** — superpower scenarios, magic doors, talking animals
- ⭐ **Favorites** — best memories, favorite sounds, funniest moments
- 🤔 **Would You Rather** — fun dilemmas (pet dragon vs. pet unicorn)
- 💛 **Feelings** — pride, bravery, gratitude, coping strategies
- 🎨 **Create** — invent a sport, design a playground, name a star
- 📸 **Remember** — favorite trips, birthdays, acts of kindness
- 🚀 **Dream** — future goals, bucket list items, skills to learn
- 💜 **Kindness** — empathy prompts, helping others, being a good friend
- 😂 **Silly** — weird laws, talking pets, candy rain

### Features
- **Randomized card-draw animations** — 8 distinct transition styles (slide, flip X/Y, zoom spin, float, fan, pop squish) randomly selected per draw
- **Shuffle / reshuffle** with dedicated spin animation
- **Category filtering** — dropdown to focus on a single category or play all
- **Card counter** — tracks position in the current deck
- **Back navigation** — revisit previous cards
- **Button lockout during animations** — prevents state corruption from rapid clicks
- **Initial entrance animation** on load

### Tech Stack
- **React** (functional components, hooks: useState, useCallback, useEffect, useRef)
- **Web Animations API** — all transitions use native `element.animate()`, no CSS keyframe sheets or animation libraries
- **Inline styles only** — zero CSS files, zero class names
- **No external dependencies** — no Framer Motion, no GSAP, no styled-components

### Notable Implementation Details
- All 8 animation types define paired `exit` and `enter` keyframe arrays; a random animation is selected per transition and executed sequentially via `onfinish` chaining
- Fisher-Yates shuffle for deck randomization
- Card content updates happen between exit/enter phases so the user never sees a content flash
- `willChange: "transform, opacity"` hint on the card element for GPU-accelerated compositing
- Perspective-based 3D transforms for flip animations (`perspective(800px) rotateY/X`)
- Fully responsive — max-width constrained but fluid within viewport

### Author
**Eddie** — Senior Consultant, CrossCountry Consulting. 7+ years Salesforce (Revenue Cloud / CPQ). Builds tools and apps on the side for family, productivity, and fun.
