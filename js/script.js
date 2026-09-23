(function () {
  'use strict';

  document.documentElement.classList.add('js');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Set these to enable the WhatsApp button and error fallbacks.
  // whatsapp: digits only with country code, e.g. '2348012345678'
  var SITE_CONFIG = { whatsapp: '', email: '' };

  if (SITE_CONFIG.whatsapp) {
    var wa = document.createElement('a');
    wa.className = 'wa-float';
    wa.href = 'https://wa.me/' + SITE_CONFIG.whatsapp + '?text=' + encodeURIComponent('Hello Amana, I would like to find out more.');
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.7 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>Chat with us';
    document.body.appendChild(wa);
  }

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Mobile nav toggle ---------- */
  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('primary-nav');

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      navToggle.classList.toggle('active', isOpen);
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Sticky header shrink ---------- */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScrollHeader = function () {
      header.classList.toggle('scrolled', window.scrollY > 12);
    };
    onScrollHeader();
    window.addEventListener('scroll', onScrollHeader, { passive: true });
  }

  /* ---------- Back to top ---------- */
  var backToTop = document.getElementById('backToTop');
  if (backToTop) {
    window.addEventListener('scroll', function () {
      backToTop.classList.toggle('visible', window.scrollY > 600);
    }, { passive: true });
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Animated stat counters ---------- */
  var counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window && counters.length) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        counterObserver.unobserve(entry.target);
        var el = entry.target;
        var target = parseInt(el.getAttribute('data-count'), 10);
        var suffix = el.getAttribute('data-suffix') || '';
        var duration = 1100;
        var start = null;
        function step(ts) {
          if (start === null) start = ts;
          var progress = Math.min((ts - start) / duration, 1);
          var eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(eased * target) + suffix;
          if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { counterObserver.observe(el); });
  }

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var question = item.querySelector('.faq-question');
    question.addEventListener('click', function () {
      var wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function (openItem) {
        openItem.classList.remove('open');
        openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('open');
        question.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll('.reveal, .reveal-stagger, .hero-figure');
  if ('IntersectionObserver' in window && revealEls.length) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in-view'); });
  }

  /* ---------- Split headlines into words ---------- */
  function splitWords(el) {
    var i = 0;
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span');
            w.className = 'w';
            w.setAttribute('aria-hidden', 'true');
            var inner = document.createElement('span');
            inner.className = 'wi';
            inner.style.setProperty('--i', i++);
            inner.textContent = p;
            w.appendChild(inner);
            frag.appendChild(w);
          });
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1) {
          walk(ch);
        }
      });
    }
    walk(el);
  }

  var splitEls = document.querySelectorAll('h1, .section-head h2, .final-cta h2, .split h2, .trust-statement h2');
  splitEls.forEach(splitWords);
  if ('IntersectionObserver' in window) {
    var splitObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('split-in');
          splitObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.35 });
    splitEls.forEach(function (el) { splitObserver.observe(el); });
  } else {
    splitEls.forEach(function (el) { el.classList.add('split-in'); });
  }

  /* ---------- Scroll progress + header hide ---------- */
  var progressBar = document.createElement('div');
  progressBar.className = 'scroll-progress';
  document.body.appendChild(progressBar);
  var lastY = 0;
  function onScrollMotion() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var y = window.scrollY;
    progressBar.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
    if (header) {
      var menuOpen = nav && nav.classList.contains('open');
      if (y > lastY && y > 320 && !menuOpen) header.classList.add('hide');
      else if (y < lastY) header.classList.remove('hide');
    }
    lastY = y;
  }
  window.addEventListener('scroll', onScrollMotion, { passive: true });
  onScrollMotion();

  /* ---------- Parallax ---------- */
  if (!reduceMotion) {
    var heroImg = document.querySelector('.hero-media img');
    var figImgs = Array.prototype.slice.call(document.querySelectorAll('.hero-figure img'));
    var parTick = false;
    var runParallax = function () {
      if (heroImg) heroImg.style.translate = '0 ' + Math.min(window.scrollY * 0.18, 40) + 'px';
      figImgs.forEach(function (img) {
        var r = img.parentNode.getBoundingClientRect();
        var off = (r.top + r.height / 2 - window.innerHeight / 2) * -0.07;
        img.style.translate = '0 ' + Math.max(-40, Math.min(40, off)) + 'px';
      });
      parTick = false;
    };
    window.addEventListener('scroll', function () {
      if (!parTick) { parTick = true; requestAnimationFrame(runParallax); }
    }, { passive: true });
    runParallax();
  }

  /* ---------- Magnetic buttons and card hover ---------- */
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.btn-primary, .btn-outline').forEach(function (b) {
      b.addEventListener('mousemove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.translate = ((e.clientX - r.left - r.width / 2) * 0.2) + 'px ' + ((e.clientY - r.top - r.height / 2) * 0.32) + 'px';
      });
      b.addEventListener('mouseleave', function () { b.style.translate = ''; });
    });
    document.querySelectorAll('.photo-card').forEach(function (c) {
      c.addEventListener('mousemove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5) * 2);
        c.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5) * 2);
      });
      c.addEventListener('mouseleave', function () {
        c.style.setProperty('--mx', 0);
        c.style.setProperty('--my', 0);
      });
    });
  }

  /* ---------- Lead modal ---------- */
  var modalOverlay = document.getElementById('modalOverlay');
  var modalTitle = document.getElementById('modalTitle');
  var modalSub = document.getElementById('modalSub');
  var modalForm = document.getElementById('modalForm');
  var modalSuccess = document.getElementById('modalSuccess');
  var leadForm = document.getElementById('leadForm');
  var modalClose = document.getElementById('modalClose');
  var modalSuccessClose = document.getElementById('modalSuccessClose');
  var lastFocused = null;
  var currentKind = 'family';
  var currentPlan = '';
  var formError = null;

  var MODAL_CONTENT = {
    family: {
      title: 'Find Your Professional',
      sub: "Tell us about your household and we'll be in touch.",
      needLabel: 'What do you need help with?',
      needOptions: ['Nanny', 'Housekeeper / Cleaner', 'Driver', 'Cook', 'House Manager', 'Companion / Carer', 'Not sure yet']
    },
    professional: {
      title: 'Join the Amana Talent Pool',
      sub: "Tell us about yourself and we'll guide you through the verification and training process.",
      needLabel: 'What role are you applying for?',
      needOptions: ['Nanny', 'Housekeeper / Cleaner', 'Driver', 'Cook', 'House Manager', 'Companion / Carer', 'Other']
    },
    organisation: {
      title: 'Partner With Amana',
      sub: "Tell us about your estate or organisation and we'll set up a staffing plan together.",
      needLabel: 'What type of organisation are you?',
      needOptions: ['Residential Estate', 'Real Estate Developer', 'Corporate', 'Embassy / NGO', 'Other']
    }
  };

  var needField = document.getElementById('needField');
  var needSelect = document.getElementById('needSelect');

  function openModal(kind, plan) {
    var content = MODAL_CONTENT[kind] || MODAL_CONTENT.family;
    currentKind = MODAL_CONTENT[kind] ? kind : 'family';
    currentPlan = plan || '';
    if (formError) formError.hidden = true;
    modalTitle.textContent = content.title;
    modalSub.textContent = plan ? content.sub + ' Selected plan: ' + plan + '.' : content.sub;

    if (needField && needSelect) {
      needField.firstChild.textContent = content.needLabel;
      needSelect.innerHTML = content.needOptions.map(function (opt) {
        return '<option>' + opt + '</option>';
      }).join('');
    }

    modalForm.hidden = false;
    modalSuccess.hidden = true;
    leadForm.reset();

    lastFocused = document.activeElement;
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    var firstInput = leadForm.querySelector('input');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 100);
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('[data-open-modal]').forEach(function (trigger) {
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      openModal(trigger.getAttribute('data-open-modal'), trigger.getAttribute('data-plan'));
    });
  });

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalSuccessClose) modalSuccessClose.addEventListener('click', closeModal);

  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalOverlay.classList.contains('active')) closeModal();
  });

  if (leadForm) {
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'website';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.className = 'hp';
    hp.setAttribute('aria-hidden', 'true');
    leadForm.appendChild(hp);

    var submitBtn = leadForm.querySelector('button[type="submit"]');
    formError = document.createElement('p');
    formError.className = 'form-error';
    formError.setAttribute('role', 'alert');
    formError.hidden = true;
    leadForm.insertBefore(formError, submitBtn);

    leadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!leadForm.checkValidity()) {
        leadForm.reportValidity();
        return;
      }
      formError.hidden = true;
      submitBtn.disabled = true;
      var label = submitBtn.textContent;
      submitBtn.textContent = 'Sending...';

      var data = {};
      new FormData(leadForm).forEach(function (v, k) { data[k] = v; });
      data.kind = currentKind;
      data.plan = currentPlan;
      data.page = window.location.pathname;

      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (!r.ok) throw new Error('failed');
        modalForm.hidden = true;
        modalSuccess.hidden = false;
      }).catch(function () {
        var alt = '';
        if (SITE_CONFIG.whatsapp) alt = ' You can also <a href="https://wa.me/' + SITE_CONFIG.whatsapp + '" target="_blank" rel="noopener">message us on WhatsApp</a>.';
        else if (SITE_CONFIG.email) alt = ' You can also email <a href="mailto:' + SITE_CONFIG.email + '">' + SITE_CONFIG.email + '</a>.';
        formError.innerHTML = 'We could not send your request just now. Please try again in a moment.' + alt;
        formError.hidden = false;
      }).then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      });
    });
  }
})();
