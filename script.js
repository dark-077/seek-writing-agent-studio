const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const jumpButtons = document.querySelectorAll('[data-target]');
const chips = document.querySelectorAll('.chip');

function showPage(target) {
  pages.forEach(page => page.classList.toggle('active-page', page.id === target));
  navItems.forEach(item => item.classList.toggle('active', item.dataset.target === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

jumpButtons.forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.target;
    if (target) showPage(target);
  });
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
