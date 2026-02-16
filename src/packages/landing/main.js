// ========================================
// Tide Commander - Landing Page JS
// ========================================

(function () {
  'use strict';

  // ----------------------------------------
  // 1. Scroll Reveal (Intersection Observer)
  // ----------------------------------------
  const revealElements = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    revealElements.forEach((el) => revealObserver.observe(el));
  } else {
    // Fallback: show everything immediately
    revealElements.forEach((el) => el.classList.add('revealed'));
  }

  // ----------------------------------------
  // 2. Nav Scroll Effect
  // ----------------------------------------
  const nav = document.getElementById('nav');
  let lastScrollY = 0;

  function onScroll() {
    const scrollY = window.scrollY;
    if (scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    lastScrollY = scrollY;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // Initial check

  // ----------------------------------------
  // 3. Active Nav Link Highlighting
  // ----------------------------------------
  const sections = document.querySelectorAll('section[id]');
  const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

  if ('IntersectionObserver' in window && sections.length > 0) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('id');
            navAnchors.forEach((a) => {
              a.classList.toggle('active', a.getAttribute('href') === '#' + id);
            });
          }
        });
      },
      { threshold: 0.3, rootMargin: '-80px 0px -50% 0px' }
    );

    sections.forEach((section) => sectionObserver.observe(section));
  }

  // ----------------------------------------
  // 4. Mobile Hamburger Menu
  // ----------------------------------------
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });

    // Close on link click
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (
        navLinks.classList.contains('open') &&
        !navLinks.contains(e.target) &&
        !hamburger.contains(e.target)
      ) {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      }
    });
  }

  // ----------------------------------------
  // 5. Smooth Scroll for Anchor Links
  // ----------------------------------------
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ----------------------------------------
  // 6. Copy Buttons
  // ----------------------------------------
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;

      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 2000);
        })
        .catch(() => {
          // Fallback for older browsers
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 2000);
        });
    });
  });

  // ----------------------------------------
  // 7. View Mode Tabs
  // ----------------------------------------
  const viewTabs = document.querySelectorAll('.view-tab');
  const viewPanes = document.querySelectorAll('.view-pane');

  viewTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const viewId = tab.getAttribute('data-view');

      // Update tabs
      viewTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Update panes
      viewPanes.forEach((pane) => {
        pane.classList.remove('active');
        if (pane.id === 'view-' + viewId) {
          pane.classList.add('active');
        }
      });
    });
  });

  // ----------------------------------------
  // 8. Image Lightbox (Click to Expand)
  // ----------------------------------------
  (function initLightbox() {
    // Create overlay elements
    var overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';

    var inner = document.createElement('div');
    inner.className = 'lightbox-inner';

    var img = document.createElement('img');
    img.className = 'lightbox-img';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.setAttribute('aria-label', 'Close image');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    inner.appendChild(img);
    inner.appendChild(closeBtn);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    function openLightbox(src, alt) {
      img.src = src;
      img.alt = alt || '';
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    // Close handlers
    closeBtn.addEventListener('click', closeLightbox);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        closeLightbox();
      }
    });

    // Attach to all expandable images
    document.querySelectorAll('.expandable-img').forEach(function (el) {
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openLightbox(el.src, el.alt);
      });
    });
  })();

  // ----------------------------------------
  // 9. YouTube Lazy Load (Click to Play)
  // ----------------------------------------
  const videoContainer = document.getElementById('video-container');
  const videoPlayBtn = document.getElementById('video-play');

  if (videoContainer && videoPlayBtn) {
    function loadVideo() {
      const iframe = document.createElement('iframe');
      iframe.src =
        'https://www.youtube-nocookie.com/embed/r1Op_xfhqOM?autoplay=1&rel=0';
      iframe.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.loading = 'lazy';

      // Remove thumbnail and play button
      const thumb = videoContainer.querySelector('.video-thumb');
      if (thumb) thumb.remove();
      videoPlayBtn.remove();

      videoContainer.appendChild(iframe);
      videoContainer.style.cursor = 'default';
    }

    videoPlayBtn.addEventListener('click', loadVideo);
    videoContainer.addEventListener('click', (e) => {
      if (e.target !== videoPlayBtn && !videoPlayBtn.contains(e.target)) {
        loadVideo();
      }
    });
  }
})();
