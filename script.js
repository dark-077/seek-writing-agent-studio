const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const jumpButtons = document.querySelectorAll('[data-target]');
const chips = document.querySelectorAll('.chip');
const stepIndicator = document.querySelector('#stepIndicator');
const prevStep = document.querySelector('#prevStep');
const nextStep = document.querySelector('#nextStep');
const printButtons = document.querySelectorAll('#printCard, #printCardInline');
const copyLink = document.querySelector('#copyLink');
const publicLink = document.querySelector('#publicLink');
const steps = Array.from(pages).map(page => page.id);
let currentStep = steps.indexOf(document.querySelector('.active-page')?.id || steps[0]);

function updateStepIndicator() {
  const activePage = pages[currentStep];
  if (!stepIndicator || !activePage) return;
  stepIndicator.textContent = `Step ${currentStep + 1} / ${steps.length} · ${activePage.dataset.title}`;
}

function showPage(target) {
  const nextIndex = steps.indexOf(target);
  if (nextIndex === -1) return;
  currentStep = nextIndex;
  pages.forEach(page => page.classList.toggle('active-page', page.id === target));
  navItems.forEach(item => item.classList.toggle('active', item.dataset.target === target));
  updateStepIndicator();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

jumpButtons.forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.target;
    if (target) showPage(target);
  });
});

prevStep?.addEventListener('click', () => {
  const target = steps[Math.max(0, currentStep - 1)];
  showPage(target);
});

nextStep?.addEventListener('click', () => {
  const target = steps[Math.min(steps.length - 1, currentStep + 1)];
  showPage(target);
});

printButtons.forEach(button => {
  button.addEventListener('click', () => window.print());
});

copyLink?.addEventListener('click', async () => {
  const text = publicLink?.textContent?.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copyLink.textContent = '已复制';
  setTimeout(() => { copyLink.textContent = '复制链接'; }, 1400);
});

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('active');
  });
});

const clueCards = document.querySelectorAll('.clue-card');
clueCards.forEach(card => {
  card.addEventListener('click', () => {
    card.classList.toggle('selected');
  });
});

updateStepIndicator();
