try {
  var theme = localStorage.getItem('ui-theme') === 'light' ? 'light' : 'blast';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'blast' ? 'dark' : 'light';
  document.documentElement.style.background = theme === 'blast' ? '#160a13' : '#f3f0ea';
  document.querySelector('meta[name="theme-color"]').content =
    theme === 'blast' ? '#160a13' : '#f3f0ea';
} catch (_) {
  document.documentElement.dataset.theme = 'blast';
  document.documentElement.style.background = '#160a13';
}
