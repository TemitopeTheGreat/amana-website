(function () {
  'use strict';

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
  var revealEls = document.querySelectorAll('.reveal');
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
    leadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!leadForm.checkValidity()) {
        leadForm.reportValidity();
        return;
      }
      modalForm.hidden = true;
      modalSuccess.hidden = false;
    });
  }
})();
